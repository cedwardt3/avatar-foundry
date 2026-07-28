import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { eq, count } from "drizzle-orm";
import { getDb } from "@/server/db";
import { characters, datasetImages, trainingRuns } from "@/drizzle/schema";
import { startTrainingRun } from "@/server/jobs/training";

const startRunSchema = z.object({
  characterId: z.number().int().positive(),
  hyperparams: z
    .object({
      steps: z.number().int().positive().max(10000).optional(),
      learningRate: z.number().positive().optional(),
      resolution: z.number().int().positive().optional(),
      networkDim: z.number().int().positive().optional(),
      networkAlpha: z.number().int().positive().optional(),
      batchSize: z.number().int().positive().optional(),
      // Opt-in interim checkpoint anchor probe — see drizzle/schema.ts
      // checkpointProbes. Omit to disable.
      probeIntervalSteps: z.number().int().positive().optional(),
    })
    .optional(),
});

export async function POST(req: NextRequest) {
  const db = await getDb();
  if (!db) return NextResponse.json({ error: "Database unavailable" }, { status: 503 });

  const body = await req.json();
  const parsed = startRunSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const [character] = await db
    .select()
    .from(characters)
    .where(eq(characters.id, parsed.data.characterId))
    .limit(1);
  if (!character) return NextResponse.json({ error: "Character not found" }, { status: 404 });

  const [{ value: datasetCount }] = await db
    .select({ value: count() })
    .from(datasetImages)
    .where(eq(datasetImages.characterId, character.id));

  if (datasetCount === 0) {
    return NextResponse.json(
      { error: "Character has no dataset images. Complete the Dataset stage first." },
      { status: 400 }
    );
  }

  // Create the row first (status: queued) so we have an id to reference
  // in the job's GCS paths, then update it once the VM is actually up.
  const [run] = await db
    .insert(trainingRuns)
    .values({
      characterId: character.id,
      status: "queued",
      hyperparams: parsed.data.hyperparams,
      datasetImageCount: datasetCount,
    })
    .returning();

  try {
    const { instanceName, zone } = await startTrainingRun(character, run);
    const [updated] = await db
      .update(trainingRuns)
      .set({ status: "provisioning", gceInstanceName: instanceName, gceZone: zone, startedAt: new Date() })
      .where(eq(trainingRuns.id, run.id))
      .returning();
    return NextResponse.json(updated, { status: 201 });
  } catch (error) {
    await db
      .update(trainingRuns)
      .set({ status: "failed", errorMessage: error instanceof Error ? error.message : String(error) })
      .where(eq(trainingRuns.id, run.id));
    return NextResponse.json(
      { error: "Failed to provision training VM", detail: String(error) },
      { status: 502 }
    );
  }
}
