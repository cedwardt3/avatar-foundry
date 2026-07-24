import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/server/db";
import { generations, characters } from "@/drizzle/schema";
import { buildPath, readJson } from "@/server/storage";
import { notifyGenerationComplete } from "@/server/notifications";

type JobStatusFile = { generationId: number; status: "running" | "succeeded" | "failed"; message: string };

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = await getDb();
  if (!db) return NextResponse.json({ error: "Database unavailable" }, { status: 503 });

  const [generation] = await db.select().from(generations).where(eq(generations.id, Number(id))).limit(1);
  if (!generation) return NextResponse.json({ error: "Generation not found" }, { status: 404 });

  if (generation.status === "succeeded" || generation.status === "failed") {
    return NextResponse.json(generation);
  }

  const [character] = await db
    .select()
    .from(characters)
    .where(eq(characters.id, generation.characterId))
    .limit(1);
  if (!character) return NextResponse.json({ error: "Character not found" }, { status: 404 });

  const statusPath = buildPath(character.slug, "generations", `${generation.id}.status.json`);
  const statusFile = await readJson<JobStatusFile>(statusPath);

  if (statusFile?.status === "succeeded") {
    const [updated] = await db
      .update(generations)
      .set({
        status: "succeeded",
        outputGcsPath: `gs://${process.env.GCS_BUCKET}/${buildPath(character.slug, "generations", `${generation.id}.png`)}`,
      })
      .where(eq(generations.id, generation.id))
      .returning();
    await notifyGenerationComplete({
      characterName: character.name,
      characterSlug: character.slug,
      generationId: generation.id,
      status: "succeeded",
    });
    return NextResponse.json(updated);
  }

  if (statusFile?.status === "failed") {
    const [updated] = await db
      .update(generations)
      .set({ status: "failed", errorMessage: statusFile.message })
      .where(eq(generations.id, generation.id))
      .returning();
    await notifyGenerationComplete({
      characterName: character.name,
      characterSlug: character.slug,
      generationId: generation.id,
      status: "failed",
      errorMessage: statusFile.message,
    });
    return NextResponse.json(updated);
  }

  return NextResponse.json(generation);
}
