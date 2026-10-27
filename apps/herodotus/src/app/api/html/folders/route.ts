import { handleApi } from "@/lib/http/errors";
import { htmlLibraryHandlers } from "@/lib/html.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function POST(request: Request): Promise<Response> { return handleApi(() => htmlLibraryHandlers.createFolder(request)); }
