import { handleRoute } from "@/lib/http/errors";
import {
  readJsonObject,
  readLegacyInteger,
  readLegacyString,
  type JsonObject,
} from "@/lib/http/request";
import { getValiVault } from "@/lib/vali/runtime";
import type { CategoryPatch } from "@/lib/vali/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface CategoryRouteContext {
  params: Promise<{ id: string }>;
}

export async function PATCH(
  request: Request,
  { params }: CategoryRouteContext,
): Promise<Response> {
  return handleRoute(async () => {
    const body = await readJsonObject(request);
    const { id } = await params;
    return Response.json(getValiVault().categories.update(id, categoryPatch(body)));
  });
}

export async function DELETE(
  _request: Request,
  { params }: CategoryRouteContext,
): Promise<Response> {
  return handleRoute(async () => {
    const { id } = await params;
    getValiVault().categories.delete(id);
    return Response.json({ ok: true });
  });
}

function categoryPatch(body: JsonObject): CategoryPatch {
  const patch: CategoryPatch = {};
  if (Object.hasOwn(body, "name")) patch.name = readLegacyString(body.name);
  if (Object.hasOwn(body, "order")) patch.order = readLegacyInteger(body.order);
  if (Object.hasOwn(body, "content")) patch.content = readLegacyString(body.content);
  return patch;
}
