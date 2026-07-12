import { NextResponse } from "next/server";

import { parseSearchQuery } from "@/lib/http/entry-query";
import { handleApi } from "@/lib/http/errors";
import { searchEntries } from "@/lib/repositories/entries";

export const runtime = "nodejs";

export function GET(request: Request): Promise<Response> {
  return handleApi(() => {
    const { query, ...options } = parseSearchQuery(request);
    return NextResponse.json(searchEntries(query, options));
  });
}
