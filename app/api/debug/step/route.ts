import { NextResponse } from "next/server";
import { getStepDebugRecord } from "../../../../agent/lib/step-debug-store";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const sessionId = searchParams.get("sessionId");
  const turnId = searchParams.get("turnId");
  const stepIndexRaw = searchParams.get("stepIndex");

  if (!sessionId || !turnId || stepIndexRaw === null) {
    return NextResponse.json(
      { error: "sessionId, turnId, and stepIndex query params are required" },
      { status: 400 },
    );
  }

  const stepIndex = Number(stepIndexRaw);
  if (!Number.isInteger(stepIndex) || stepIndex < 0) {
    return NextResponse.json(
      { error: "stepIndex must be a non-negative integer" },
      { status: 400 },
    );
  }

  const record = await getStepDebugRecord(sessionId, turnId, stepIndex);
  if (!record) {
    return NextResponse.json(
      { error: "No debug data captured for this step yet" },
      { status: 404 },
    );
  }

  return NextResponse.json(record);
}
