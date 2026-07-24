import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb } from "@/server/db";
import { characters, trainingRuns, generations } from "@/drizzle/schema";
import { startGenerationJob } from "@/server/jobs/generation";

const startGenerationSchema = z.object({
  characterId: z.number().int().positive(),
  trainingRunId: z.number().int().positive(),
  prompt: z.string().min(1).max(2000),
  negativePrompt: z.string().max(2000).optional(),
  seed: z.number().int().optional(),
  recipeName: z.string().max(128).optional(),
});

export async function POST(req: NextRequest) {
  const db = await getDb();
  if (!db) return NextResponse.json({ error: "Database unavailable" }, { status: 503 });

  const body = await req.json();
  const parsed = startGenerationSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const [character] = await db
    .select()
    .from(characters)
    .where(eq(characters.id, parsed.data.characterId))
    .limit(1);
  if (!character) return NextResponse.json({ error: "Character not found" }, { status: 404 });

  const [trainingRun] = await db
    .select()
    .from(trainingRuns)
    .where(eq(trainingRuns.id, parsed.data.trainingRunId))
    .limit(1);
  if (!trainingRun) return NextResponse.json({ error: "Training run not found" }, { status: 404 });

  if (trainingRun.status !== "succeeded" || !trainingRun.checkpointGcsPath) {
    return NextResponse.json(
      { error: "Training run has not completed successfully — no checkpoint available to generate from." },
      { status: 400 }
    );
  }

  const [generation] = await db
    .insert(generations)
    .values({
      characterId: character.id,
      trainingRunId: trainingRun.id,
      status: "queued",
      prompt: parsed.data.prompt,
      negativePrompt: parsed.data.negativePrompt,
      seed: parsed.data.seed,
      recipeName: parsed.data.recipeName,
    })
    .returning();

  try {
    await startGenerationJob(character, trainingRun, generation);
    const [updated] = await db
      .update(generations)
      .set({ status: "running" })
      .where(eq(generations.id, generation.id))
      .returning();
    return NextResponse.json(updated, { status: 201 });
  } catch (error) {
    await db
      .update(generations)
      .set({ status: "failed", errorMessage: error instanceof Error ? error.message : String(error) })
      .where(eq(generations.id, generation.id));
    return NextResponse.json(
      { error: "Failed to start generation job", detail: String(error) },
      { status: 502 }
    );
  }
}
