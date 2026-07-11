import { handleRoute } from "@/lib/http/errors";
import {
  readJsonObject,
  readLegacyString,
  readStringList,
} from "@/lib/http/request";
import { getValiVault } from "@/lib/vali/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  return handleRoute(() => {
    const categoryId = new URL(request.url).searchParams.get("categoryId") || undefined;
    return Response.json(getValiVault().entries.list(categoryId));
  });
}

export async function POST(request: Request): Promise<Response> {
  return handleRoute(async () => {
    const body = await readJsonObject(request);
    const aliasesValue = Object.hasOwn(body, "aliases") ? body.aliases : [];
    const aliases = readStringList(aliasesValue, "aliases must be a list");
    const title = Object.hasOwn(body, "title") ? readLegacyString(body.title) : "";
    const categoryId = Object.hasOwn(body, "categoryId")
      ? readLegacyString(body.categoryId)
      : "";
    const created = getValiVault().entries.create({ title, aliases, categoryId });
    return Response.json(created, { status: 201 });
  });
}
