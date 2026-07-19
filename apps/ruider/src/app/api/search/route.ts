import { NextResponse } from "next/server";

import { handleApi } from "@/lib/http/errors";
import { searchNotes } from "@/lib/repositories";

export const runtime = "nodejs";

export function GET(request: Request): Promise<Response> {
  return handleApi(() => {
    const searchParams = new URL(request.url).searchParams;
    const query = searchParams.get("q") ?? "";
    return NextResponse.json(searchNotes(query, {
      limit: Number(searchParams.get("limit")),
      offset: Number(searchParams.get("offset")),
    }));
  });
}
