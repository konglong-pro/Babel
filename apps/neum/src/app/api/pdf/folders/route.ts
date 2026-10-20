import { handleApi } from "@/lib/http/errors";
import { pdfLibraryHandlers } from "@/lib/pdf.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function POST(request: Request): Promise<Response> { return handleApi(() => pdfLibraryHandlers.createFolder(request)); }
