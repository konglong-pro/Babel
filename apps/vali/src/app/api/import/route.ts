import { handleRoute } from "@/lib/http/errors";
import {
  readJsonObject,
  readLegacyString,
  readStringList,
} from "@/lib/http/request";
import { getValiVault } from "@/lib/vali/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return handleRoute(async () => {
    const body = await readJsonObject(request);
    const itemsValue = Object.hasOwn(body, "items") ? body.items : [];
    const items = readStringList(itemsValue, "items must be a list");
    const categoryId = Object.hasOwn(body, "categoryId")
      ? readLegacyString(body.categoryId)
      : "";
    const result = getValiVault().entries.importTitles(categoryId, items);
    return Response.json(result, { status: 201 });
  });
}
