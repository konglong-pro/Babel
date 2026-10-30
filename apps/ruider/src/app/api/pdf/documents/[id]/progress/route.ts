import { handleApi } from "@/lib/http/errors";
import { pdfLibraryHandlers } from "@/lib/pdf.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> { const { id } = await context.params; return handleApi(() => pdfLibraryHandlers.patchProgress(request, id)); }
