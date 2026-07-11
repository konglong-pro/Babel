import { handleRoute } from "@/lib/http/errors";
import { readJsonObject } from "@/lib/http/request";
import { ValidationError } from "@/lib/vali/errors";
import { getValiVault } from "@/lib/vali/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ReflectionRouteContext {
  params: Promise<{ date: string }>;
}

export async function GET(
  _request: Request,
  { params }: ReflectionRouteContext,
): Promise<Response> {
  return handleRoute(async () => {
    const { date } = await params;
    return Response.json(getValiVault().reflections.get(date));
  });
}

export async function PATCH(
  request: Request,
  { params }: ReflectionRouteContext,
): Promise<Response> {
  return handleRoute(async () => {
    const body = await readJsonObject(request);
    if (!Object.hasOwn(body, "content")) {
      throw new ValidationError("Reflection content is required");
    }
    if (typeof body.content !== "string") {
      throw new ValidationError("Reflection content must be a string");
    }
    const { date } = await params;
    return Response.json(getValiVault().reflections.save(date, body.content));
  });
}
