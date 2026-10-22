import { handleApi } from "@/lib/http/errors";
import { documentImportHandlers } from "@/lib/document-import.server";

export const runtime = "nodejs";

export function POST(request: Request): Promise<Response> {
  return handleApi(() => documentImportHandlers.saveOriginal(request));
}
