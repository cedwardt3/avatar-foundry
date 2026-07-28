import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb } from "@/server/db";
import { checkpointProbes } from "@/drizzle/schema";

// No automated scorer is wired up yet (no CLIP/VLM model lives in this
// pipeline) — a human reviews the rendered sample images and submits a
// pass/fail here. See drizzle/schema.ts checkpointProbes for context.
const reviewSchema = z.object({
  passed: z.boolean(),
  raterName: z.string().max(128).optional(),
  raterNotes: z.string().optional(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = await getDb();
  if (!db) return NextResponse.json({ error: "Database unavailable" }, { status: 503 });

  const body = await req.json();
  const parsed = reviewSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const [updated] = await db
    .update(checkpointProbes)
    .set({
      status: parsed.data.passed ? "passed" : "failed",
      raterName: parsed.data.raterName,
      raterNotes: parsed.data.raterNotes,
      reviewedAt: new Date(),
    })
    .where(eq(checkpointProbes.id, Number(id)))
    .returning();

  if (!updated) return NextResponse.json({ error: "Checkpoint probe not found" }, { status: 404 });

  return NextResponse.json(updated);
}
