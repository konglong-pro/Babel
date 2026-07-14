import { NextResponse } from "next/server";

import {
  deleteExercise,
  deleteExerciseImageIfUnused,
  getExercise,
  listNoteImagePaths,
  updateExercise,
  type UpdateExerciseInput,
} from "@/lib/repositories";
import { ApiError, handleApi } from "@/lib/http/errors";
import { rollbackNoteImageMutation } from "@/lib/http/note-image-mutation";
import {
  assertPatchHasFields,
  optionalIdArray,
  optionalPositiveInteger,
  optionalString,
  optionalStringArray,
  parsePositiveInteger,
  readNoteMutationRequest,
} from "@/lib/http/request";
import {
  finalizeQuarantinedNoteImages,
  managedImagePathsInMarkdown,
  quarantineNoteImages,
  stageNoteImagesInMarkdown,
  type NoteImageQuarantine,
} from "@/lib/storage";

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
    const id = await routeId(context);
    const current = getExercise(id);
    if (current === null) {
      throw new ApiError(404, "EXERCISE_NOT_FOUND", "Exercise not found.");
    }

    const patch: UpdateExerciseInput = {};
    let replacementImagePath: string | undefined;
    let stagedImagePaths: string[] = [];
    let quarantine: NoteImageQuarantine | undefined;
    let exercise;
    try {
      const { payload: body, uploads } = await readNoteMutationRequest(
        request,
        (payload) => {
          const imagePath = payload.imagePath;
          if (typeof imagePath === "string" && imagePath.trim().length > 0) {
            replacementImagePath = imagePath.trim();
          }
        },
      );
      const folderId = optionalPositiveInteger(body, "folderId");
      const title = optionalString(body, "title");
      const imagePath = optionalString(body, "imagePath");
      const answerMd = optionalString(body, "answerMd", {
        allowEmpty: true,
        trim: false,
      });
      const solutionMd = optionalString(body, "solutionMd", {
        allowEmpty: true,
        trim: false,
      });
      const tags = optionalStringArray(body, "tags");
      const knowledgeIds = optionalIdArray(
        body,
        "knowledgeIds",
        "relatedKnowledgeIds",
      );
      if (folderId !== undefined) patch.folderId = folderId;
      if (title !== undefined) patch.title = title;
      if (imagePath !== undefined) patch.imagePath = imagePath;
      if (answerMd !== undefined) patch.answerMd = answerMd;
      if (solutionMd !== undefined) patch.solutionMd = solutionMd;
      if (tags !== undefined) patch.tags = tags;
      if (knowledgeIds !== undefined) patch.knowledgeIds = knowledgeIds;

      if (uploads.size > 0 && answerMd === undefined && solutionMd === undefined) {
        throw new ApiError(
          400,
          "VALIDATION_ERROR",
          "answerMd or solutionMd is required when adding images.",
          { field: "answerMd" },
        );
      }
      const nextAnswerMd = answerMd ?? current.answerMd;
      const nextSolutionMd = solutionMd ?? current.solutionMd;
      const staged = await stageNoteImagesInMarkdown(
        [nextAnswerMd, nextSolutionMd],
        uploads,
      );
      stagedImagePaths = staged.imagePaths;
      if (answerMd !== undefined) {
        patch.answerMd = staged.markdownSources[0] ?? answerMd;
      }
      if (solutionMd !== undefined) {
        patch.solutionMd = staged.markdownSources[1] ?? solutionMd;
      }
      assertPatchHasFields({
        ...patch,
        knowledgeIds,
        uploads: uploads.size > 0 ? true : undefined,
      });

      const ownedImagePaths = listNoteImagePaths("exercise", id);
      const referencedImagePaths = new Set([
        ...managedImagePathsInMarkdown(staged.markdownSources[0] ?? nextAnswerMd),
        ...managedImagePathsInMarkdown(staged.markdownSources[1] ?? nextSolutionMd),
      ]);
      const removedImagePaths = ownedImagePaths.filter(
        (imagePath) => !referencedImagePaths.has(imagePath),
      );

      quarantine = await quarantineNoteImages(removedImagePaths);
      exercise = updateExercise(
        id,
        patch,
        staged.imagePaths,
        removedImagePaths,
      );
    } catch (error) {
      if (replacementImagePath && replacementImagePath !== current.imagePath) {
        await deleteExerciseImageIfUnused(replacementImagePath).catch((cleanupError) => {
          console.error("Failed to clean up an unused exercise image", cleanupError);
        });
      }
      await rollbackNoteImageMutation(error, quarantine, stagedImagePaths);
    }
    await finalizeQuarantinedNoteImages(quarantine!);

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
    if (getExercise(id) === null) {
      throw new ApiError(404, "EXERCISE_NOT_FOUND", "Exercise not found.");
    }
    const imagePaths = listNoteImagePaths("exercise", id);
    let quarantine: NoteImageQuarantine | undefined;
    try {
      quarantine = await quarantineNoteImages(imagePaths);
      if (!(await deleteExercise(id, imagePaths))) {
        throw new ApiError(404, "EXERCISE_NOT_FOUND", "Exercise not found.");
      }
    } catch (error) {
      await rollbackNoteImageMutation(error, quarantine, []);
    }
    await finalizeQuarantinedNoteImages(quarantine!);

    return new Response(null, { status: 204 });
  });
}
