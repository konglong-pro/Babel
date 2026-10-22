import { NextResponse } from "next/server";
import { assertSameOrigin, parsePositiveInteger } from "@babel-apps/platform/http/request";

import { handleApi } from "@/lib/http/errors";
import { detachReaderUnderlineNote } from "@/lib/repositories";

export const runtime = "nodejs";
type RouteContext = { params: Promise<{ id: string; noteId: string }> };

export function DELETE(request: Request, context: RouteContext): Promise<Response> {
  return handleApi(async () => {
    assertSameOrigin(request);
    const { id, noteId } = await context.params;
    return NextResponse.json(detachReaderUnderlineNote(
      parsePositiveInteger(id, "id"),
      parsePositiveInteger(noteId, "noteId"),
    ));
  });
}
