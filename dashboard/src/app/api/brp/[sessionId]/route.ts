import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getSessionBrpFull } from "@/lib/queries/brp";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  // Require authentication
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { sessionId } = await params;
  const id = parseInt(sessionId);
  if (isNaN(id)) {
    return NextResponse.json({ error: "Invalid session ID" }, { status: 400 });
  }

  // Optional downsampling: caller can pass ?bucket=<ms> (default 200ms)
  const bucket = parseInt(req.nextUrl.searchParams.get("bucket") ?? "200");
  const effectiveBucket = isNaN(bucket) || bucket < 40 ? 200 : bucket;

  try {
    const rows = await getSessionBrpFull(id, effectiveBucket);
    return NextResponse.json(rows, {
      headers: {
        // Cache for 5 minutes — data never changes once imported
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch (err) {
    console.error("[api/brp] error", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
