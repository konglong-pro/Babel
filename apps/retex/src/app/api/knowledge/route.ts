import { NextResponse } from "next/server";

import { createKnowledge, listKnowledge } from "@/lib/repositories";
import { ApiError, handleApi } from "@/lib/http/errors";
import { rollbackNoteImageMutation } from "@/lib/http/note-image-mutation";
import {
  optionalIdArray,
  optionalNullablePositiveInteger,
  optionalString,
  optionalStringArray,
  parsePositiveInteger,
  readNoteMutationRequest,
  requiredPositiveInteger,
  requiredString,
} from "@/lib/http/request";
import { stageNoteImages } from "@/lib/storage/note-images";

export const runtime = "nodejs";

export function GET(request: Request): Promise<Response> {
  return handleApi(() => {
    const folderIdValue = new URL(request.url).searchParams.get("folderId");
    const folderId =
      folderIdValue === null ? undefined : parsePositiveInteger(folderIdValue, "folderId");
    return NextResponse.json(listKnowledge(folderId));
  });
}

export function POST(request: Request): Promise<Response> {
  return handleApi(async () => {
    const { payload, uploads } = await readNoteMutationRequest(request);
    const exerciseIds =
      optionalIdArray(payload, "exerciseIds", "relatedExerciseIds") ?? [];
    const contentMd = optionalString(
      payload,
      "contentMd",
      { allowEmpty: true, trim: false },
    );
    if (contentMd === undefined && uploads.size > 0) {
      throw new ApiError(
        400,
        "VALIDATION_ERROR",
        "contentMd is required when adding images.",
        { field: "contentMd" },
      );
    }
    const staged = await stageNoteImages(contentMd ?? "", uploads);

    let note;
    try {
      note = createKnowledge(
        {
          folderId: requiredPositiveInteger(payload, "folderId"),
          parentId: optionalNullablePositiveInteger(payload, "parentId"),
          title: requiredString(payload, "title"),
          contentMd: staged.contentMd,
          tags: optionalStringArray(payload, "tags") ?? [],
          exerciseIds,
        },
        staged.imagePaths,
      );
    } catch (error) {
      await rollbackNoteImageMutation(error, undefined, staged.imagePaths);
    }

    return NextResponse.json(note, { status: 201 });
  });
}
