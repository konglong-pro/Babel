import { handleRoute } from "@/lib/http/errors";
import { readJsonObject, readLegacyString } from "@/lib/http/request";
import { getValiVault } from "@/lib/vali/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  return handleRoute(() => Response.json(getValiVault().categories.list()));
}

export async function POST(request: Request): Promise<Response> {
  return handleRoute(async () => {
    const body = await readJsonObject(request);
    const name = Object.hasOwn(body, "name") ? readLegacyString(body.name) : "";
    const created = getValiVault().categories.create({ name });
    return Response.json(created, { status: 201 });
  });
}
