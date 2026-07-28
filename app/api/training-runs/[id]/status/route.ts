import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/server/db";
import { trainingRuns, characters, checkpointProbes } from "@/drizzle/schema";
import { buildPath, readJson } from "@/server/storage";
import { isInstanceRunning } from "@/server/jobs/training";
import { readProbeStatus, newProbeEntries } from "@/server/jobs/checkpoint-probe";
import { notifyTrainingRunComplete } from "@/server/notifications";

type JobStatusFile = { runId: number; status: "running" | "succeeded" | "failed"; message: string };

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = await getDb();
  if (!db) return NextResponse.json({ error: "Database unavailable" }, { status: 503 });

  const [run] = await db.select().from(trainingRuns).where(eq(trainingRuns.id, Number(id))).limit(1);
  if (!run) return NextResponse.json({ error: "Training run not found" }, { status: 404 });

  // Terminal states don't need re-checking.
  if (run.status === "succeeded" || run.status === "failed" || run.status === "cancelled") {
    return NextResponse.json(run);
  }

  const [character] = await db.select().from(characters).where(eq(characters.id, run.characterId)).limit(1);
  if (!character) return NextResponse.json({ error: "Character not found" }, { status: 404 });

  // Sync any newly-appeared interim checkpoint probes (see
  // server/jobs/checkpoint-probe.ts) ahead of handling the run's own
  // terminal status below — the whole point is surfacing these while
  // the run is still going, not after.
  const probeStatus = await readProbeStatus(character.slug, run.id);
  if (probeStatus) {
    const existingProbeSteps = await db
      .select({ step: checkpointProbes.checkpointStep })
      .from(checkpointProbes)
      .where(eq(checkpointProbes.trainingRunId, run.id));
    const toInsert = newProbeEntries(probeStatus, new Set(existingProbeSteps.map((p) => p.step)));
    if (toInsert.length > 0) {
      await db.insert(checkpointProbes).values(
        toInsert.map((entry) => ({
          characterId: character.id,
          trainingRunId: run.id,
          checkpointStep: entry.step,
          sampleImageGcsPaths: entry.sampleImageGcsPaths,
          anchorDescription: entry.anchorDescription,
        }))
      );
    }
  }

  // Source of truth for completion is the status file the container writes
  // to GCS right before the VM self-deletes — not the VM's existence,
  // since a preempted spot VM disappearing looks identical to a clean
  // exit unless the status file distinguishes them.
  const statusPath = buildPath(character.slug, "checkpoints", `${run.id}/status.json`);
  const statusFile = await readJson<JobStatusFile>(statusPath);

  if (statusFile?.status === "succeeded") {
    const [updated] = await db
      .update(trainingRuns)
      .set({
        status: "succeeded",
        checkpointGcsPath: `gs://${process.env.GCS_BUCKET}/${buildPath(character.slug, "checkpoints", `${run.id}/lora.safetensors`)}`,
        completedAt: new Date(),
      })
      .where(eq(trainingRuns.id, run.id))
      .returning();
    await notifyTrainingRunComplete({
      characterName: character.name,
      characterSlug: character.slug,
      runId: run.id,
      status: "succeeded",
      estimatedCostUsd: updated.estimatedCostUsd,
    });
    return NextResponse.json(updated);
  }

  if (statusFile?.status === "failed") {
    const [updated] = await db
      .update(trainingRuns)
      .set({ status: "failed", errorMessage: statusFile.message, completedAt: new Date() })
      .where(eq(trainingRuns.id, run.id))
      .returning();
    await notifyTrainingRunComplete({
      characterName: character.name,
      characterSlug: character.slug,
      runId: run.id,
      status: "failed",
      errorMessage: statusFile.message,
    });
    return NextResponse.json(updated);
  }

  // No terminal status file yet. If the instance is also gone, the VM
  // died without writing a status (e.g. spot preemption mid-run, or an
  // uncaught crash before the trap fired) — mark it failed rather than
  // leaving it stuck in "running" forever.
  if (run.gceInstanceName && run.gceZone) {
    const stillRunning = await isInstanceRunning(run.gceInstanceName, run.gceZone);
if (!stillRunning && (run.status === "running" || run.status === "provisioning")) {      const failureMessage = "Instance terminated without reporting a final status (likely spot preemption).";
      const [updated] = await db
        .update(trainingRuns)
        .set({
          status: "failed",
          errorMessage: failureMessage,
          completedAt: new Date(),
        })
        .where(eq(trainingRuns.id, run.id))
        .returning();
      await notifyTrainingRunComplete({
        characterName: character.name,
        characterSlug: character.slug,
        runId: run.id,
        status: "failed",
        errorMessage: failureMessage,
      });
      return NextResponse.json(updated);
    }
  }

  if (statusFile?.status === "running" && run.status === "provisioning") {
    const [updated] = await db
      .update(trainingRuns)
      .set({ status: "running" })
      .where(eq(trainingRuns.id, run.id))
      .returning();
    return NextResponse.json(updated);
  }

  return NextResponse.json(run);
}
