import { handleApi } from "@/lib/http/errors";
import { htmlLibraryHandlers } from "@/lib/html.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> { const { id } = await context.params; return handleApi(() => htmlLibraryHandlers.getDocument(id)); }

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> { const { id } = await context.params; return handleApi(() => htmlLibraryHandlers.moveDocument(request, id)); }

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> { const { id } = await context.params; return handleApi(() => htmlLibraryHandlers.deleteDocument(request, id)); }
