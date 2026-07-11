import { handleRoute } from "@/lib/http/errors";
import { getValiVault } from "@/lib/vali/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  return handleRoute(() => Response.json(getValiVault().reflections.listDates()));
}
