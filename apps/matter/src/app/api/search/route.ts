import { NextResponse } from "next/server";

import { searchArchive } from "@/lib/repositories";
import { handleApi } from "@/lib/http/errors";

export const runtime = "nodejs";

export function GET(request: Request): Promise<Response> {
  return handleApi(() => {
    const searchParams = new URL(request.url).searchParams;
    const query = searchParams.get("q") ?? "";
    return NextResponse.json(searchArchive(query, {
      limit: Number(searchParams.get("limit")),
      knowledgeOffset: Number(searchParams.get("knowledgeOffset")),
      exerciseOffset: Number(searchParams.get("exerciseOffset")),
    }));
  });
}
