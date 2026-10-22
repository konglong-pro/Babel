import { handleApi } from "@/lib/http/errors";
import { documentImportHandlers } from "@/lib/document-import.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(): Promise<Response> {
  return handleApi(() => documentImportHandlers.capability());
}

export function POST(request: Request): Promise<Response> {
  return handleApi(() => documentImportHandlers.convert(request));
}
