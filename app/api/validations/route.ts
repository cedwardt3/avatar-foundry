import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { eq, and, desc } from "drizzle-orm";
import { getDb } from "@/server/db";
import { validations } from "@/drizzle/schema";

const scoreField = z.number().int().min(1).max(5).optional();

const createValidationSchema = z.object({
  subjectType: z.enum(["generation", "training_run", "character"]),
  subjectId: z.number().int().positive(),
  characterId: z.number().int().positive(),
  identityConsistencyScore: scoreField,
  canonAdherenceScore: scoreField,
  driftFlags: z.array(z.string()).optional(),
  raterNotes: z.string().optional(),
  raterName: z.string().max(128).optional(),
});

export async function GET(req: NextRequest) {
  const db = await getDb();
  if (!db) return NextResponse.json({ error: "Database unavailable" }, { status: 503 });

  const { searchParams } = new URL(req.url);
  const characterId = searchParams.get("characterId");
  const subjectType = searchParams.get("subjectType");
  const subjectId = searchParams.get("subjectId");

  const conditions = [];
  if (characterId) conditions.push(eq(validations.characterId, Number(characterId)));
  if (subjectType) {
    const parsed = z.enum(["generation", "training_run", "character"]).safeParse(subjectType);
    if (!parsed.success) return NextResponse.json({ error: "Invalid subjectType" }, { status: 400 });
    conditions.push(eq(validations.subjectType, parsed.data));
  }
  if (subjectId) conditions.push(eq(validations.subjectId, Number(subjectId)));

  const rows = await db
    .select()
    .from(validations)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(validations.createdAt));

  return NextResponse.json(rows);
}

export async function POST(req: NextRequest) {
  const db = await getDb();
  if (!db) return NextResponse.json({ error: "Database unavailable" }, { status: 503 });

  const body = await req.json();
  const parsed = createValidationSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const [row] = await db.insert(validations).values(parsed.data).returning();
  return NextResponse.json(row, { status: 201 });
}
