import { NextResponse } from "next/server";

import { ApiError } from "./errors";
import {
  assertOnlyFields,
  assertPatchHasFields,
  assertSameOrigin,
  optionalNonNegativeInteger,
  optionalNullablePositiveInteger,
  optionalString,
  parsePositiveInteger,
  readJsonObject,
  requiredString,
} from "./request";

type HandleApi = (
  handler: () => Response | Promise<Response>,
) => Promise<Response>;

export type FolderRouteContext = {
  params: Promise<{ id: string }>;
};

export interface FolderCollectionRouteOptions<TFolder> {
  handleApi: HandleApi;
  listFolders: () => readonly TFolder[];
  createFolder: (input: {
    name: string;
    parentId?: number | null;
  }) => TFolder;
}

export interface FolderItemRouteOptions<TFolder> {
  handleApi: HandleApi;
  getFolder: (id: number) => TFolder | null;
  updateFolder: (
    id: number,
    patch: { name?: string; parentId?: number | null; position?: number },
  ) => TFolder;
  deleteFolder: (id: number) => boolean;
}

export function createFolderCollectionRoute<TFolder>(
  options: FolderCollectionRouteOptions<TFolder>,
): {
  GET: () => Promise<Response>;
  POST: (request: Request) => Promise<Response>;
} {
  return {
    GET() {
      return options.handleApi(() => NextResponse.json(options.listFolders()));
    },
    POST(request) {
      return options.handleApi(async () => {
        assertSameOrigin(request);
        const body = await readJsonObject(request);
        assertOnlyFields(body, ["name", "parentId"]);
        const folder = options.createFolder({
          name: requiredString(body, "name"),
          parentId: optionalNullablePositiveInteger(body, "parentId"),
        });
        return NextResponse.json(folder, { status: 201 });
      });
    },
  };
}

export function createFolderItemRoute<TFolder>(
  options: FolderItemRouteOptions<TFolder>,
): {
  GET: (request: Request, context: FolderRouteContext) => Promise<Response>;
  PATCH: (request: Request, context: FolderRouteContext) => Promise<Response>;
  DELETE: (request: Request, context: FolderRouteContext) => Promise<Response>;
} {
  async function routeId(context: FolderRouteContext): Promise<number> {
    const { id } = await context.params;
    return parsePositiveInteger(id, "id");
  }

  return {
    GET(_request, context) {
      return options.handleApi(async () => {
        const folder = options.getFolder(await routeId(context));
        if (!folder) {
          throw new ApiError(404, "FOLDER_NOT_FOUND", "Folder not found.");
        }
        return NextResponse.json(folder);
      });
    },
    PATCH(request, context) {
      return options.handleApi(async () => {
        assertSameOrigin(request);
        const body = await readJsonObject(request);
        assertOnlyFields(body, ["name", "parentId", "position"]);
        const patch: {
          name?: string;
          parentId?: number | null;
          position?: number;
        } = {};
        const name = optionalString(body, "name");
        const parentId = optionalNullablePositiveInteger(body, "parentId");
        const position = optionalNonNegativeInteger(body, "position");
        if (name !== undefined) patch.name = name;
        if (parentId !== undefined) patch.parentId = parentId;
        if (position !== undefined) patch.position = position;
        assertPatchHasFields(patch);
        return NextResponse.json(
          options.updateFolder(await routeId(context), patch),
        );
      });
    },
    DELETE(request, context) {
      return options.handleApi(async () => {
        assertSameOrigin(request);
        if (!options.deleteFolder(await routeId(context))) {
          throw new ApiError(404, "FOLDER_NOT_FOUND", "Folder not found.");
        }
        return new Response(null, { status: 204 });
      });
    },
  };
}
