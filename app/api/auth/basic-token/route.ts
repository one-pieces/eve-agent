import { NextResponse } from "next/server";

export async function GET() {
  const password = process.env.ROUTE_AUTH_PASSWORD;
  if (!password) {
    return NextResponse.json(
      { error: "ROUTE_AUTH_PASSWORD is not configured", ok: false },
      { status: 500 },
    );
  }

  const token = Buffer.from(`admin:${password}`).toString("base64");
  return NextResponse.json({ token: `Basic ${token}`, ok: true });
}
