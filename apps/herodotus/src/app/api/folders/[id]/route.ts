import { NextResponse } from "next/server";

import { ApiError, handleApi } from "@/lib/http/errors";
import {
  assertOnlyFields,
  assertPatchHasFields,
  assertSameOrigin,
  optionalNullablePositiveInteger,
  optionalString,
  parsePositiveInteger,
  readJsonObject,
} from "@/lib/http/request";
import {
  deleteFolder,
  getFolder,
  updateFolder,
  type UpdateFolderInput,
} from "@/lib/repositories";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

async function routeId(context: RouteContext): Promise<number> {
  const { id } = await context.params;
  return parsePositiveInteger(id, "id");
}

export function GET(_request: Request, context: RouteContext): Promise<Response> {
  return handleApi(async () => {
    const folder = getFolder(await routeId(context));
    if (!folder) throw new ApiError(404, "FOLDER_NOT_FOUND", "Folder not found.");
    return NextResponse.json(folder);
  });
}

export function PATCH(request: Request, context: RouteContext): Promise<Response> {
  return handleApi(async () => {
    assertSameOrigin(request);
    const body = await readJsonObject(request);
    assertOnlyFields(body, ["name", "parentId"]);
    const patch: UpdateFolderInput = {};
    const name = optionalString(body, "name");
    const parentId = optionalNullablePositiveInteger(body, "parentId");
    if (name !== undefined) patch.name = name;
    if (parentId !== undefined) patch.parentId = parentId;
    assertPatchHasFields({ ...patch });
    return NextResponse.json(updateFolder(await routeId(context), patch));
  });
}

export function DELETE(request: Request, context: RouteContext): Promise<Response> {
  return handleApi(async () => {
    assertSameOrigin(request);
    if (!deleteFolder(await routeId(context))) {
      throw new ApiError(404, "FOLDER_NOT_FOUND", "Folder not found.");
    }
    return new Response(null, { status: 204 });
  });
}
