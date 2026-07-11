import { handleRoute } from "@/lib/http/errors";
import {
  readJsonObject,
  readLegacyInteger,
  readLegacyString,
  readStringList,
  type JsonObject,
} from "@/lib/http/request";
import { getValiVault } from "@/lib/vali/runtime";
import type { EntryPatch } from "@/lib/vali/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface EntryRouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(
  _request: Request,
  { params }: EntryRouteContext,
): Promise<Response> {
  return handleRoute(async () => {
    const { id } = await params;
    return Response.json(getValiVault().entries.get(id));
  });
}

export async function PATCH(
  request: Request,
  { params }: EntryRouteContext,
): Promise<Response> {
  return handleRoute(async () => {
    const body = await readJsonObject(request);
    const { id } = await params;
    return Response.json(getValiVault().entries.update(id, entryPatch(body)));
  });
}

export async function DELETE(
  _request: Request,
  { params }: EntryRouteContext,
): Promise<Response> {
  return handleRoute(async () => {
    const { id } = await params;
    getValiVault().entries.delete(id);
    return Response.json({ ok: true });
  });
}

function entryPatch(body: JsonObject): EntryPatch {
  const patch: EntryPatch = {};
  if (Object.hasOwn(body, "title")) patch.title = readLegacyString(body.title);
  if (Object.hasOwn(body, "aliases")) {
    patch.aliases = readStringList(body.aliases, "Entry aliases must be a list");
  }
  if (Object.hasOwn(body, "categoryId")) {
    patch.categoryId = readLegacyString(body.categoryId);
  }
  if (Object.hasOwn(body, "order")) patch.order = readLegacyInteger(body.order);
  if (Object.hasOwn(body, "content")) patch.content = readLegacyString(body.content);
  return patch;
}
