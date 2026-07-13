import { NextResponse } from "next/server";

import { ApiError, handleApi } from "@/lib/http/errors";
import { parsePositiveInteger } from "@/lib/http/request";
import { getEntry } from "@/lib/repositories/entries";
import { listEntryBacklinks } from "@/lib/repositories/links";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

export function GET(_request: Request, context: RouteContext): Promise<Response> {
  return handleApi(async () => {
    const { id: rawId } = await context.params;
    const id = parsePositiveInteger(rawId, "id");
    if (!getEntry(id)) {
      throw new ApiError(404, "ENTRY_NOT_FOUND", "Entry not found.");
    }
    return NextResponse.json(listEntryBacklinks(id));
  });
}
