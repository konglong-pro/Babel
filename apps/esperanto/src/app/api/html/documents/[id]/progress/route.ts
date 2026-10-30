import { handleApi } from "@/lib/http/errors";
import { htmlLibraryHandlers } from "@/lib/html.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> { const { id } = await context.params; return handleApi(() => htmlLibraryHandlers.patchProgress(request, id)); }
