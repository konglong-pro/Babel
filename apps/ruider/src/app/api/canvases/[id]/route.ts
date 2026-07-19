import { NextResponse } from "next/server";

import { ApiError, handleApi } from "@/lib/http/errors";
import {
  assertOnlyFields,
  assertPatchHasFields,
  assertSameOrigin,
  optionalString,
  parsePositiveInteger,
  readJsonObject,
} from "@/lib/http/request";
import {
  deleteCanvas,
  getCanvas,
  updateCanvas,
  type UpdateCanvasInput,
} from "@/lib/repositories";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

async function routeId(context: RouteContext): Promise<number> {
  return parsePositiveInteger((await context.params).id, "id");
}

export function GET(_request: Request, context: RouteContext): Promise<Response> {
  return handleApi(async () => {
    const canvas = getCanvas(await routeId(context));
    if (!canvas) throw new ApiError(404, "CANVAS_NOT_FOUND", "Canvas not found.");
    return NextResponse.json(canvas);
  });
}

export function PATCH(request: Request, context: RouteContext): Promise<Response> {
  return handleApi(async () => {
    assertSameOrigin(request);
    const body = await readJsonObject(request);
    assertOnlyFields(body, ["title", "scene"]);
    assertPatchHasFields(body);
    const patch: UpdateCanvasInput = {};
    const title = optionalString(body, "title");
    if (title !== undefined) patch.title = title;
    if (Object.hasOwn(body, "scene")) patch.scene = body.scene;
    const canvas = updateCanvas(await routeId(context), patch);
    if (!canvas) throw new ApiError(404, "CANVAS_NOT_FOUND", "Canvas not found.");
    return NextResponse.json(canvas);
  });
}

export function DELETE(request: Request, context: RouteContext): Promise<Response> {
  return handleApi(async () => {
    assertSameOrigin(request);
    if (!deleteCanvas(await routeId(context))) {
      throw new ApiError(404, "CANVAS_NOT_FOUND", "Canvas not found.");
    }
    return new Response(null, { status: 204 });
  });
}
