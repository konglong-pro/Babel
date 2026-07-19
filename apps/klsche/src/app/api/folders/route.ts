import { createFolderCollectionRoute } from "@babel-apps/platform/http/folder-routes";

import { handleApi } from "@/lib/http/errors";
import { createFolder, listFolders } from "@/lib/repositories";

export const runtime = "nodejs";

const route = createFolderCollectionRoute({
  handleApi,
  listFolders,
  createFolder,
});

export function GET(): Promise<Response> {
  return route.GET();
}

export function POST(request: Request): Promise<Response> {
  return route.POST(request);
}
