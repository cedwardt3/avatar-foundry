import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/server/db";
import { characters } from "@/drizzle/schema";
import { desc } from "drizzle-orm";

const createCharacterSchema = z.object({
  slug: z
    .string()
    .min(2)
    .max(64)
    .regex(/^[a-z0-9_]+$/, "slug must be lowercase letters, numbers, and underscores only"),
  name: z.string().min(1).max(256),
  visualCanon: z
    .object({
      age_range: z.string().optional(),
      build: z.string().optional(),
      hair: z.string().optional(),
      eyes: z.string().optional(),
      distinguishingFeatures: z.array(z.string()).optional(),
      wardrobeAnchors: z.array(z.string()).optional(),
    })
    .optional(),
  behavioralPresence: z.string().optional(),
  signatureAnchors: z.array(z.string()).optional(),
  prohibitedDrift: z.array(z.string()).optional(),
  sourceDataset: z.string().max(256).optional(),
});

export async function GET() {
  const db = await getDb();
  if (!db) return NextResponse.json({ error: "Database unavailable" }, { status: 503 });

  const rows = await db.select().from(characters).orderBy(desc(characters.updatedAt));
  return NextResponse.json(rows);
}

export async function POST(req: NextRequest) {
  const db = await getDb();
  if (!db) return NextResponse.json({ error: "Database unavailable" }, { status: 503 });

  const body = await req.json();
  const parsed = createCharacterSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const [row] = await db.insert(characters).values(parsed.data).returning();
  return NextResponse.json(row, { status: 201 });
}
