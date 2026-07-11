import { NextResponse } from "next/server";

import {
  deleteExercise,
  deleteExerciseImageIfUnused,
  getExercise,
  updateExercise,
  type UpdateExerciseInput,
} from "@/lib/repositories";
import { ApiError, handleApi } from "@/lib/http/errors";
import {
  assertPatchHasFields,
  optionalIdArray,
  optionalPositiveInteger,
  optionalString,
  optionalStringArray,
  parsePositiveInteger,
  readJsonObject,
} from "@/lib/http/request";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }>;
};

async function routeId(context: RouteContext): Promise<number> {
  const { id } = await context.params;
  return parsePositiveInteger(id, "id");
}

export function GET(_request: Request, context: RouteContext): Promise<Response> {
  return handleApi(async () => {
    const exercise = getExercise(await routeId(context));
    if (exercise === null) {
      throw new ApiError(404, "EXERCISE_NOT_FOUND", "Exercise not found.");
    }

    return NextResponse.json(exercise);
  });
}

export function PATCH(request: Request, context: RouteContext): Promise<Response> {
  return handleApi(async () => {
    const body = await readJsonObject(request);
    const patch: UpdateExerciseInput = {};
    const folderId = optionalPositiveInteger(body, "folderId");
    const title = optionalString(body, "title");
    const imagePath = optionalString(body, "imagePath");
    const answerMd = optionalString(body, "answerMd", { allowEmpty: true, trim: false });
    const solutionMd = optionalString(body, "solutionMd", { allowEmpty: true, trim: false });
    const tags = optionalStringArray(body, "tags");
    const knowledgeIds = optionalIdArray(body, "knowledgeIds", "relatedKnowledgeIds");
    if (folderId !== undefined) patch.folderId = folderId;
    if (title !== undefined) patch.title = title;
    if (imagePath !== undefined) patch.imagePath = imagePath;
    if (answerMd !== undefined) patch.answerMd = answerMd;
    if (solutionMd !== undefined) patch.solutionMd = solutionMd;
    if (tags !== undefined) patch.tags = tags;
    if (knowledgeIds !== undefined) patch.knowledgeIds = knowledgeIds;
    assertPatchHasFields({ ...patch, knowledgeIds });

    const id = await routeId(context);
    const current = getExercise(id);
    if (current === null) {
      throw new ApiError(404, "EXERCISE_NOT_FOUND", "Exercise not found.");
    }

    let exercise;
    try {
      exercise = updateExercise(id, patch);
    } catch (error) {
      if (patch.imagePath && patch.imagePath !== current.imagePath) {
        await deleteExerciseImageIfUnused(patch.imagePath).catch((cleanupError) => {
          console.error("Failed to clean up an unused exercise image", cleanupError);
        });
      }
      throw error;
    }

    if (patch.imagePath && patch.imagePath !== current.imagePath) {
      await deleteExerciseImageIfUnused(current.imagePath).catch((cleanupError) => {
        console.error("Failed to clean up a replaced exercise image", cleanupError);
      });
    }

    return NextResponse.json(exercise);
  });
}

export function DELETE(_request: Request, context: RouteContext): Promise<Response> {
  return handleApi(async () => {
    const id = await routeId(context);
    if (!(await deleteExercise(id))) {
      throw new ApiError(404, "EXERCISE_NOT_FOUND", "Exercise not found.");
    }

    return new Response(null, { status: 204 });
  });
}
