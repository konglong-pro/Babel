import { NextResponse } from "next/server";

import { ApiError, handleApi } from "@/lib/http/errors";
import { parsePositiveInteger } from "@/lib/http/request";
import { listDocumentTitles } from "@/lib/repositories";

export const runtime = "nodejs";

export function GET(request: Request): Promise<Response> {
  return handleApi(() => {
    const searchParams = new URL(request.url).searchParams;
    const query = searchParams.get("q") ?? "";
    const rawLimit = searchParams.get("limit");
    const limit = rawLimit === null ? 20 : parsePositiveInteger(rawLimit, "limit");
    if (limit > 100) {
      throw new ApiError(400, "VALIDATION_ERROR", "limit must be at most 100.", {
        field: "limit",
      });
    }
    return NextResponse.json(listDocumentTitles(query, limit));
  });
}
