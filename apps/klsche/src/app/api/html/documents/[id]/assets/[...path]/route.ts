import { handleApi } from "@/lib/http/errors";
import { htmlLibraryHandlers } from "@/lib/html.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string; path: string[] }> }): Promise<Response> { const { id, path } = await context.params; return handleApi(() => htmlLibraryHandlers.asset(request, id, path)); }

export async function HEAD(request: Request, context: { params: Promise<{ id: string; path: string[] }> }): Promise<Response> { const { id, path } = await context.params; return handleApi(() => htmlLibraryHandlers.asset(request, id, path)); }
