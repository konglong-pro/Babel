import {
  createFolderItemRoute,
  type FolderRouteContext,
} from "@babel-apps/platform/http/folder-routes";

import { handleApi } from "@/lib/http/errors";
import { deleteFolder, getFolder, updateFolder } from "@/lib/repositories";

export const runtime = "nodejs";

const route = createFolderItemRoute({
  handleApi,
  getFolder,
  updateFolder,
  deleteFolder,
});

export function GET(request: Request, context: FolderRouteContext): Promise<Response> {
  return route.GET(request, context);
}

export function PATCH(request: Request, context: FolderRouteContext): Promise<Response> {
  return route.PATCH(request, context);
}

export function DELETE(request: Request, context: FolderRouteContext): Promise<Response> {
  return route.DELETE(request, context);
}
