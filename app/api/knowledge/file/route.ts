import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import { join, basename } from "node:path";

const UPLOAD_DIR = join(process.cwd(), "rag", "data", "sample_docs");

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const name = searchParams.get("name");

  if (!name) {
    return NextResponse.json({ error: "Missing name" }, { status: 400 });
  }

  // Prevent path traversal by only allowing the file's basename
  const safeName = basename(name);
  const filePath = join(UPLOAD_DIR, safeName);

  try {
    const buffer = await readFile(filePath);
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${encodeURIComponent(safeName)}"`,
      },
    });
  } catch (err) {
    console.error("Failed to read file:", safeName, err);
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }
}
