import { NextResponse } from "next/server";

import {
  deleteScratch,
  getExercise,
  getScratch,
  upsertScratch,
} from "@/lib/repositories";
import { ApiError, handleApi } from "@/lib/http/errors";
import {
  assertSameOrigin,
  optionalString,
  parsePositiveInteger,
  readJsonObject,
} from "@/lib/http/request";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }>;
};

async function exerciseId(context: RouteContext): Promise<number> {
  const { id } = await context.params;
  return parsePositiveInteger(id, "id");
}

function assertExerciseExists(id: number): void {
  if (getExercise(id) === null) {
    throw new ApiError(404, "EXERCISE_NOT_FOUND", "Exercise not found.");
  }
}

export function GET(_request: Request, context: RouteContext): Promise<Response> {
  return handleApi(async () => {
    const id = await exerciseId(context);
    assertExerciseExists(id);
    return NextResponse.json(getScratch(id));
  });
}

export function PUT(request: Request, context: RouteContext): Promise<Response> {
  return handleApi(async () => {
    assertSameOrigin(request);
    const id = await exerciseId(context);
    const body = await readJsonObject(request);
    const contentMd = optionalString(body, "contentMd", {
      allowEmpty: true,
      trim: false,
    });
    if (contentMd === undefined) {
      throw new ApiError(400, "VALIDATION_ERROR", "contentMd must be a string.", {
        field: "contentMd",
      });
    }

    return NextResponse.json(upsertScratch(id, contentMd));
  });
}

export function DELETE(request: Request, context: RouteContext): Promise<Response> {
  return handleApi(async () => {
    assertSameOrigin(request);
    const id = await exerciseId(context);
    assertExerciseExists(id);
    deleteScratch(id);
    return new Response(null, { status: 204 });
  });
}
