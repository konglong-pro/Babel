import { NextResponse } from "next/server";

import { ApiError, handleApi } from "@/lib/http/errors";
import {
  getReflection,
  listDocumentBacklinksForReflection,
  normalizeReflectionDate,
} from "@/lib/repositories";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ date: string }> };

export function GET(_request: Request, context: RouteContext): Promise<Response> {
  return handleApi(async () => {
    const { date: rawDate } = await context.params;
    const date = normalizeReflectionDate(rawDate);
    if (!getReflection(date)) {
      throw new ApiError(404, "REFLECTION_NOT_FOUND", "Reflection not found.");
    }
    return NextResponse.json(listDocumentBacklinksForReflection(date));
  });
}
