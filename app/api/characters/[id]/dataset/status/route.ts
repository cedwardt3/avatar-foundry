import { NextRequest, NextResponse } from "next/server";
import { eq, count } from "drizzle-orm";
import { getDb } from "@/server/db";
import { characters, datasetImages } from "@/drizzle/schema";
import { buildPath, readJson, readText, listObjects } from "@/server/storage";

type JobStatusFile = { jobId: string; status: "running" | "succeeded" | "failed"; message: string };

const IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp"];

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { searchParams } = new URL(req.url);
  const jobId = searchParams.get("jobId");
  if (!jobId) return NextResponse.json({ error: "jobId query param required" }, { status: 400 });

  const db = await getDb();
  if (!db) return NextResponse.json({ error: "Database unavailable" }, { status: 503 });

  const [character] = await db.select().from(characters).where(eq(characters.id, Number(id))).limit(1);
  if (!character) return NextResponse.json({ error: "Character not found" }, { status: 404 });

  const statusPath = buildPath(character.slug, "dataset", `_jobs/${jobId}/status.json`);
  const statusFile = await readJson<JobStatusFile>(statusPath);

  if (!statusFile) {
    return NextResponse.json({ jobId, status: "running", message: "job not yet reported status" });
  }

  if (statusFile.status !== "succeeded") {
    return NextResponse.json(statusFile);
  }

  // Job succeeded: enumerate what the captioning container wrote to
  // dataset/, and record any images not already in the DB. Idempotent —
  // safe to poll repeatedly after completion.
  const datasetPrefix = buildPath(character.slug, "dataset", "");
  const allObjects = await listObjects(datasetPrefix);
  const imagePaths = allObjects.filter(
    (p) => !p.includes("/_jobs/") && IMAGE_EXTENSIONS.some((ext) => p.toLowerCase().endsWith(ext))
  );

  const existing = await db
    .select({ gcsPath: datasetImages.gcsPath })
    .from(datasetImages)
    .where(eq(datasetImages.characterId, character.id));
  const existingPaths = new Set(existing.map((e) => e.gcsPath));

  const newRows = [];
  for (const imagePath of imagePaths) {
    const gcsUri = `gs://${process.env.GCS_BUCKET}/${imagePath}`;
    if (existingPaths.has(gcsUri)) continue;

    const captionPath = imagePath.replace(/\.(png|jpg|jpeg|webp)$/i, ".txt");
    const caption = await readText(captionPath);

    newRows.push({
      characterId: character.id,
      gcsPath: gcsUri,
      caption: caption ?? undefined,
    });
  }

  if (newRows.length > 0) {
    await db.insert(datasetImages).values(newRows);
  }

  const [{ value: totalCount }] = await db
    .select({ value: count() })
    .from(datasetImages)
    .where(eq(datasetImages.characterId, character.id));

  return NextResponse.json({
    jobId,
    status: "succeeded",
    newImagesRecorded: newRows.length,
    totalDatasetImages: totalCount,
  });
}
