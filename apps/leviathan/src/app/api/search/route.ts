import { NextResponse } from "next/server";

import { handleApi } from "@/lib/http/errors";
import { searchNotes } from "@/lib/repositories";

export const runtime = "nodejs";

export function GET(request: Request): Promise<Response> {
  return handleApi(() => {
    const query = new URL(request.url).searchParams.get("q") ?? "";
    return NextResponse.json(searchNotes(query));
  });
}
