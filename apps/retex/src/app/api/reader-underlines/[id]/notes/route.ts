import { NextResponse } from "next/server";
import { assertOnlyFields, assertSameOrigin, parsePositiveInteger, readJsonObject } from "@babel-apps/platform/http/request";

import { handleApi } from "@/lib/http/errors";
import { attachReaderUnderlineNote } from "@/lib/repositories";

export const runtime = "nodejs";
type RouteContext = { params: Promise<{ id: string }> };

export function POST(request: Request, context: RouteContext): Promise<Response> {
  return handleApi(async () => {
    assertSameOrigin(request);
    const id = parsePositiveInteger((await context.params).id, "id");
    const body = await readJsonObject(request);
    assertOnlyFields(body, ["noteId"]);
    return NextResponse.json(attachReaderUnderlineNote(id, body.noteId));
  });
}
