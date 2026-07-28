import { NextRequest, NextResponse } from "next/server";
import { eq, desc } from "drizzle-orm";
import { getDb } from "@/server/db";
import { checkpointProbes } from "@/drizzle/schema";

export async function GET(req: NextRequest) {
  const db = await getDb();
  if (!db) return NextResponse.json({ error: "Database unavailable" }, { status: 503 });

  const { searchParams } = new URL(req.url);
  const trainingRunId = searchParams.get("trainingRunId");
  if (!trainingRunId) {
    return NextResponse.json({ error: "trainingRunId query param is required" }, { status: 400 });
  }

  const rows = await db
    .select()
    .from(checkpointProbes)
    .where(eq(checkpointProbes.trainingRunId, Number(trainingRunId)))
    .orderBy(desc(checkpointProbes.checkpointStep));

  return NextResponse.json(rows);
}
