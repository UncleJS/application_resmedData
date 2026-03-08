import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getNightBrpFull } from "@/lib/queries/brp";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ date: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { date } = await params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "Invalid date" }, { status: 400 });
  }

  const bucket = parseInt(req.nextUrl.searchParams.get("bucket") ?? "200");
  const effectiveBucket = isNaN(bucket) || bucket < 40 ? 200 : bucket;

  try {
    const rows = await getNightBrpFull(date, effectiveBucket);
    return NextResponse.json(rows, {
      headers: { "Cache-Control": "private, max-age=300" },
    });
  } catch (err) {
    console.error("[api/brp/night] error", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
