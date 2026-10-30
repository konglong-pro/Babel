import { handleApi } from "@/lib/http/errors";
import { documentImportHandlers } from "@/lib/document-import.server";

export const runtime = "nodejs";

export function GET(_request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  return handleApi(async () => documentImportHandlers.readOriginal((await context.params).id));
}
