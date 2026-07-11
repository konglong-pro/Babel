import { handleRoute } from "@/lib/http/errors";
import { getValiVault } from "@/lib/vali/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  return handleRoute(() => {
    const query = new URL(request.url).searchParams.get("q") ?? "";
    return Response.json(getValiVault().entries.search(query));
  });
}
