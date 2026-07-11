import { NextResponse } from "next/server";

import { searchArchive } from "@/lib/repositories";
import { handleApi } from "@/lib/http/errors";

export const runtime = "nodejs";

export function GET(request: Request): Promise<Response> {
  return handleApi(() => {
    const query = new URL(request.url).searchParams.get("q") ?? "";
    return NextResponse.json(searchArchive(query));
  });
}
