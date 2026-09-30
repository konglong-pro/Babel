import { NextResponse } from "next/server";

import { ApiError, handleApi } from "@/lib/http/errors";
import { parsePositiveInteger } from "@/lib/http/request";
import { getKnowledge, listBacklinks } from "@/lib/repositories";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

export function GET(_request: Request, context: RouteContext): Promise<Response> {
  return handleApi(async () => {
    const { id: rawId } = await context.params;
    const id = parsePositiveInteger(rawId, "id");
    if (!getKnowledge(id)) {
      throw new ApiError(404, "KNOWLEDGE_NOT_FOUND", "Knowledge note not found.");
    }
    return NextResponse.json(listBacklinks("knowledge", id));
  });
}
