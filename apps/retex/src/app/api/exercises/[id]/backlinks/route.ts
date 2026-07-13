import { NextResponse } from "next/server";

import { ApiError, handleApi } from "@/lib/http/errors";
import { parsePositiveInteger } from "@/lib/http/request";
import { getExercise, listBacklinks } from "@/lib/repositories";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

export function GET(_request: Request, context: RouteContext): Promise<Response> {
  return handleApi(async () => {
    const { id: rawId } = await context.params;
    const id = parsePositiveInteger(rawId, "id");
    if (!getExercise(id)) {
      throw new ApiError(404, "EXERCISE_NOT_FOUND", "Exercise not found.");
    }
    return NextResponse.json(listBacklinks("exercise", id));
  });
}
