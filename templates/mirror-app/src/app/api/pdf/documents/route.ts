import { handleApi } from "@/lib/http/errors";
import { pdfLibraryHandlers } from "@/lib/pdf.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(): Promise<Response> { return handleApi(() => pdfLibraryHandlers.list()); }
export function POST(request: Request): Promise<Response> { return handleApi(() => pdfLibraryHandlers.importPdf(request)); }
