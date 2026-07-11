import { NextResponse } from "next/server";

import {
  createExercise,
  deleteExerciseImageIfUnused,
  listExercises,
} from "@/lib/repositories";
import { handleApi } from "@/lib/http/errors";
import {
  optionalIdArray,
  optionalString,
  optionalStringArray,
  parsePositiveInteger,
  readJsonObject,
  requiredPositiveInteger,
  requiredString,
} from "@/lib/http/request";

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
    const body = await readJsonObject(request);
    const knowledgeIds =
      optionalIdArray(body, "knowledgeIds", "relatedKnowledgeIds") ?? [];

    const input = {
      folderId: requiredPositiveInteger(body, "folderId"),
      title: requiredString(body, "title"),
      imagePath: requiredString(body, "imagePath"),
      answerMd: optionalString(body, "answerMd", { allowEmpty: true, trim: false }) ?? "",
      solutionMd:
        optionalString(body, "solutionMd", { allowEmpty: true, trim: false }) ?? "",
      tags: optionalStringArray(body, "tags") ?? [],
      knowledgeIds,
    };

    let exercise;
    try {
      exercise = createExercise(input);
    } catch (error) {
      await deleteExerciseImageIfUnused(input.imagePath).catch((cleanupError) => {
        console.error("Failed to clean up an unused exercise image", cleanupError);
      });
      throw error;
    }

    return NextResponse.json(exercise, { status: 201 });
  });
}
