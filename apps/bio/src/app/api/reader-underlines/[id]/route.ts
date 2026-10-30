import { NextResponse } from "next/server";

import { handleApi } from "@/lib/http/errors";
import { assertOnlyFields, assertSameOrigin, parsePositiveInteger, readJsonObject } from "@/lib/http/request";
import { deleteReaderUnderline, recolorReaderUnderline } from "@/lib/repositories/reader-underlines";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

async function routeId(context: RouteContext): Promise<number> {
  return parsePositiveInteger((await context.params).id, "id");
}

export function PATCH(request: Request, context: RouteContext): Promise<Response> {
  return handleApi(async () => {
    assertSameOrigin(request);
    const body = await readJsonObject(request);
    assertOnlyFields(body, ["color"]);
    return NextResponse.json(recolorReaderUnderline(await routeId(context), body.color));
  });
}

export function DELETE(request: Request, context: RouteContext): Promise<Response> {
  return handleApi(async () => {
    assertSameOrigin(request);
    deleteReaderUnderline(await routeId(context));
    return new Response(null, { status: 204 });
  });
}
