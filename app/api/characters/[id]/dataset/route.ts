import { NextRequest, NextResponse } from "next/server";
import { nanoid } from "nanoid";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/server/db";
import { characters, referenceImages } from "@/drizzle/schema";
import { startCaptioningJob } from "@/server/jobs/captioning";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = await getDb();
  if (!db) return NextResponse.json({ error: "Database unavailable" }, { status: 503 });

  const [character] = await db.select().from(characters).where(eq(characters.id, Number(id))).limit(1);
  if (!character) return NextResponse.json({ error: "Character not found" }, { status: 404 });

  const includedRefs = await db
    .select()
    .from(referenceImages)
    .where(and(eq(referenceImages.characterId, character.id), eq(referenceImages.includeInDataset, true)));

  if (includedRefs.length === 0) {
    return NextResponse.json(
      { error: "No reference images marked for inclusion. Mark at least one in the References stage first." },
      { status: 400 }
    );
  }

  const jobId = nanoid(10);

  try {
    const { instanceName, zone } = await startCaptioningJob(character, {
      jobId,
      referenceGcsPaths: includedRefs.map((r) => r.gcsPath),
    });
    return NextResponse.json(
      { jobId, instanceName, zone, referenceCount: includedRefs.length },
      { status: 201 }
    );
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to start captioning job", detail: String(error) },
      { status: 502 }
    );
  }
}
