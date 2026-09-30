import { NextResponse } from "next/server";

import {
  deleteFolder,
  listFolders,
  updateFolder,
  type UpdateFolderInput,
} from "@/lib/repositories";
import { ApiError, handleApi } from "@/lib/http/errors";
import {
  assertPatchHasFields,
  assertSameOrigin,
  optionalNonNegativeInteger,
  optionalNullablePositiveInteger,
  optionalString,
  parsePositiveInteger,
  readJsonObject,
} from "@/lib/http/request";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }>;
};

async function routeId(context: RouteContext): Promise<number> {
  const { id } = await context.params;
  return parsePositiveInteger(id, "id");
}

export function GET(_request: Request, context: RouteContext): Promise<Response> {
  return handleApi(async () => {
    const id = await routeId(context);
    const folder = listFolders().find((item) => item.id === id);
    if (folder === undefined) {
      throw new ApiError(404, "FOLDER_NOT_FOUND", "Folder not found.");
    }

    return NextResponse.json(folder);
  });
}

export function PATCH(request: Request, context: RouteContext): Promise<Response> {
  return handleApi(async () => {
    assertSameOrigin(request);
    const id = await routeId(context);
    const body = await readJsonObject(request);
    const patch: UpdateFolderInput = {};
    const name = optionalString(body, "name");
    const parentId = optionalNullablePositiveInteger(body, "parentId");
    const position = optionalNonNegativeInteger(body, "position");
    if (name !== undefined) patch.name = name;
    if (parentId !== undefined) patch.parentId = parentId;
    if (position !== undefined) patch.position = position;
    assertPatchHasFields({ ...patch });

    return NextResponse.json(updateFolder(id, patch));
  });
}

export function DELETE(request: Request, context: RouteContext): Promise<Response> {
  return handleApi(async () => {
    assertSameOrigin(request);
    const id = await routeId(context);
    if (!deleteFolder(id)) {
      throw new ApiError(404, "FOLDER_NOT_FOUND", "Folder not found.");
    }

    return new Response(null, { status: 204 });
  });
}
