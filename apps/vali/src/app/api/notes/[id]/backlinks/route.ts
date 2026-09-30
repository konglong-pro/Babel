import { NextResponse } from "next/server";

import { ApiError, handleApi } from "@/lib/http/errors";
import { parsePositiveInteger } from "@/lib/http/request";
import { getNote, listDocumentBacklinksForNote } from "@/lib/repositories";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

export function GET(_request: Request, context: RouteContext): Promise<Response> {
  return handleApi(async () => {
    const { id: rawId } = await context.params;
    const id = parsePositiveInteger(rawId, "id");
    if (!getNote(id)) throw new ApiError(404, "NOTE_NOT_FOUND", "Note not found.");
    return NextResponse.json(listDocumentBacklinksForNote(id));
  });
}
