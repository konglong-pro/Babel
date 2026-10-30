import { NextResponse } from "next/server";
import { assertOnlyFields, assertSameOrigin, parsePositiveInteger, readJsonObject } from "@babel-apps/platform/http/request";

import { handleApi } from "@/lib/http/errors";
import { deleteReaderUnderline, updateReaderUnderline } from "@/lib/repositories";

export const runtime = "nodejs";
type RouteContext = { params: Promise<{ id: string }> };

export function PATCH(request: Request, context: RouteContext): Promise<Response> {
  return handleApi(async () => {
    assertSameOrigin(request);
    const id = parsePositiveInteger((await context.params).id, "id");
    const body = await readJsonObject(request);
    assertOnlyFields(body, ["color"]);
    return NextResponse.json(updateReaderUnderline(id, body));
  });
}

export function DELETE(request: Request, context: RouteContext): Promise<Response> {
  return handleApi(async () => {
    assertSameOrigin(request);
    deleteReaderUnderline(parsePositiveInteger((await context.params).id, "id"));
    return new Response(null, { status: 204 });
  });
}
