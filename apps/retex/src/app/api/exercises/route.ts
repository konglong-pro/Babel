import { NextResponse } from "next/server";

import {
  createExercise,
  deleteExerciseImageIfUnused,
  listExercises,
} from "@/lib/repositories";
import { handleApi } from "@/lib/http/errors";
import { rollbackNoteImageMutation } from "@/lib/http/note-image-mutation";
import {
  optionalIdArray,
  optionalString,
  optionalStringArray,
  parsePositiveInteger,
  readNoteMutationRequest,
  requiredPositiveInteger,
  requiredString,
} from "@/lib/http/request";
import { stageNoteImagesInMarkdown } from "@/lib/storage";

export const runtime = "nodejs";

export function GET(request: Request): Promise<Response> {
  return handleApi(() => {
    const folderIdValue = new URL(request.url).searchParams.get("folderId");
    const folderId =
      folderIdValue === null ? undefined : parsePositiveInteger(folderIdValue, "folderId");
    return NextResponse.json(listExercises(folderId));
  });
}

export function POST(request: Request): Promise<Response> {
  return handleApi(async () => {
    const { payload: body, uploads } = await readNoteMutationRequest(request);
    const knowledgeIds =
      optionalIdArray(body, "knowledgeIds", "relatedKnowledgeIds") ?? [];
    const answerMd = optionalString(
      body,
      "answerMd",
      { allowEmpty: true, trim: false },
    ) ?? "";
    const solutionMd = optionalString(
      body,
      "solutionMd",
      { allowEmpty: true, trim: false },
    ) ?? "";

    const input = {
      folderId: requiredPositiveInteger(body, "folderId"),
      title: requiredString(body, "title"),
      imagePath: requiredString(body, "imagePath"),
      tags: optionalStringArray(body, "tags") ?? [],
      knowledgeIds,
    };

    let stagedImagePaths: string[] = [];
    try {
      const staged = await stageNoteImagesInMarkdown([answerMd, solutionMd], uploads);
      stagedImagePaths = staged.imagePaths;
      const exercise = createExercise(
        {
          ...input,
          answerMd: staged.markdownSources[0] ?? answerMd,
          solutionMd: staged.markdownSources[1] ?? solutionMd,
        },
        staged.imagePaths,
      );
      return NextResponse.json(exercise, { status: 201 });
    } catch (error) {
      await deleteExerciseImageIfUnused(input.imagePath).catch((cleanupError) => {
        console.error("Failed to clean up an unused exercise image", cleanupError);
      });
      return rollbackNoteImageMutation(error, undefined, stagedImagePaths);
    }
  });
}
