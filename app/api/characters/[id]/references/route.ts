import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { nanoid } from "nanoid";
import { eq } from "drizzle-orm";
import { getDb } from "@/server/db";
import { characters, referenceImages } from "@/drizzle/schema";
import { buildPath, getSignedUploadUrl } from "@/server/storage";

const requestUploadSchema = z.object({
  contentType: z.enum(["image/png", "image/jpeg", "image/webp"]),
});

const recordUploadSchema = z.object({
  gcsPath: z.string().min(1),
  source: z.enum(["kaggle_synthetic", "generated", "upload"]),
  sourceDatasetRef: z.string().max(256).optional(),
  angle: z.string().max(64).optional(),
  expression: z.string().max(64).optional(),
  lighting: z.string().max(64).optional(),
  notes: z.string().optional(),
});

/**
 * GET returns a signed upload URL (client uploads directly to GCS).
 * POST records a reference image row once the client-side upload succeeds.
 * Split into two steps so large image bytes never pass through this server.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = await getDb();
  if (!db) return NextResponse.json({ error: "Database unavailable" }, { status: 503 });

  const [character] = await db.select().from(characters).where(eq(characters.id, Number(id))).limit(1);
  if (!character) return NextResponse.json({ error: "Character not found" }, { status: 404 });

  const { searchParams } = new URL(req.url);
  const parsed = requestUploadSchema.safeParse({
    contentType: searchParams.get("contentType"),
  });
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const ext = parsed.data.contentType.split("/")[1];
  const filename = `${nanoid(12)}.${ext}`;
  const path = buildPath(character.slug, "references", filename);
  const uploadUrl = await getSignedUploadUrl(path, parsed.data.contentType);

  return NextResponse.json({ uploadUrl, gcsPath: `gs://${process.env.GCS_BUCKET}/${path}` });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = await getDb();
  if (!db) return NextResponse.json({ error: "Database unavailable" }, { status: 503 });

  const [character] = await db.select().from(characters).where(eq(characters.id, Number(id))).limit(1);
  if (!character) return NextResponse.json({ error: "Character not found" }, { status: 404 });

  const body = await req.json();
  const parsed = recordUploadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  // Policy gate: this pipeline only ever trains on synthetic or
  // pipeline-generated imagery, never real people. Enforced here, not
  // just in the UI, since this is the actual write path.
  if (parsed.data.source === "upload") {
    return NextResponse.json(
      {
        error:
          "Manual uploads require sourceDatasetRef confirming synthetic provenance. " +
          "This pipeline does not accept photos of real people.",
      },
      { status: 400 }
    );
  }

  const [row] = await db
    .insert(referenceImages)
    .values({ ...parsed.data, characterId: character.id })
    .returning();

  return NextResponse.json(row, { status: 201 });
}
