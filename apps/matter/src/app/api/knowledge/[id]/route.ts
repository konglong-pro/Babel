import { NextResponse } from "next/server";

import {
  deleteKnowledge,
  getKnowledge,
  listNoteImagePaths,
  updateKnowledge,
  type UpdateKnowledgeInput,
} from "@/lib/repositories";
import { ApiError, handleApi } from "@/lib/http/errors";
import { rollbackNoteImageMutation } from "@/lib/http/note-image-mutation";
import {
  assertPatchHasFields,
  assertSameOrigin,
  optionalIdArray,
  optionalNullablePositiveInteger,
  optionalNonNegativeInteger,
  optionalPositiveInteger,
  optionalString,
  optionalStringArray,
  parsePositiveInteger,
  readNoteMutationRequest,
} from "@/lib/http/request";
import {
  finalizeQuarantinedNoteImages,
  ensureNoteImageStorageRecovered,
  managedImagePathsInMarkdown,
  quarantineNoteImages,
  stageNoteImages,
  withNoteImageMutationLock,
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
    const note = getKnowledge(await routeId(context));
    if (note === null) {
      throw new ApiError(404, "KNOWLEDGE_NOT_FOUND", "Knowledge note not found.");
    }

    return NextResponse.json(note);
  });
}

export function PATCH(request: Request, context: RouteContext): Promise<Response> {
  return handleApi(async () => {
    assertSameOrigin(request);
    await ensureNoteImageStorageRecovered();
    const id = await routeId(context);
    const { payload, uploads } = await readNoteMutationRequest(request);
    const patch: UpdateKnowledgeInput = {};
    const folderId = optionalPositiveInteger(payload, "folderId");
    const parentId = optionalNullablePositiveInteger(payload, "parentId");
    const title = optionalString(payload, "title");
    const contentMd = optionalString(
      payload,
      "contentMd",
      { allowEmpty: true, trim: false },
    );
    const tags = optionalStringArray(payload, "tags");
    const exerciseIds = optionalIdArray(payload, "exerciseIds", "relatedExerciseIds");
    const position = optionalNonNegativeInteger(payload, "position");
    if (folderId !== undefined) patch.folderId = folderId;
    if (parentId !== undefined) patch.parentId = parentId;
    if (title !== undefined) patch.title = title;
    if (tags !== undefined) patch.tags = tags;
    if (exerciseIds !== undefined) patch.exerciseIds = exerciseIds;
    if (position !== undefined) patch.position = position;

    if (contentMd === undefined && uploads.size > 0) {
      throw new ApiError(
        400,
        "VALIDATION_ERROR",
        "contentMd is required when adding images.",
        { field: "contentMd" },
      );
    }
    assertPatchHasFields({ ...patch, contentMd, exerciseIds, uploads: uploads.size || undefined });

    return withNoteImageMutationLock(async () => {
      const staged =
        contentMd === undefined
          ? { contentMd: undefined, imagePaths: [] }
          : await stageNoteImages(contentMd, uploads);
      if (staged.contentMd !== undefined) patch.contentMd = staged.contentMd;

      if (staged.contentMd === undefined) {
        return NextResponse.json(updateKnowledge(id, patch));
      }

      let quarantine: NoteImageQuarantine | undefined;
      let result;
      try {
        const current = getKnowledge(id);
        if (current === null) {
          throw new ApiError(404, "KNOWLEDGE_NOT_FOUND", "Knowledge note not found.");
        }
        const ownedImagePaths = listNoteImagePaths("knowledge", id);
        const nextContentMd = staged.contentMd ?? current.contentMd;
        const referencedImagePaths = managedImagePathsInMarkdown(nextContentMd);
        const removedImagePaths = ownedImagePaths.filter(
          (imagePath) => !referencedImagePaths.has(imagePath),
        );
        quarantine = await quarantineNoteImages(removedImagePaths);
        result = updateKnowledge(id, patch, staged.imagePaths, removedImagePaths);
      } catch (error) {
        await rollbackNoteImageMutation(error, quarantine, staged.imagePaths);
      }
      await finalizeQuarantinedNoteImages(quarantine!);
      return NextResponse.json(result!);
    });
  });
}

export function DELETE(request: Request, context: RouteContext): Promise<Response> {
  return handleApi(async () => {
    assertSameOrigin(request);
    await ensureNoteImageStorageRecovered();
    const id = await routeId(context);
    return withNoteImageMutationLock(async () => {
      if (getKnowledge(id) === null) {
        throw new ApiError(404, "KNOWLEDGE_NOT_FOUND", "Knowledge note not found.");
      }
      const imagePaths = listNoteImagePaths("knowledge", id);
      let quarantine: NoteImageQuarantine | undefined;
      try {
        quarantine = await quarantineNoteImages(imagePaths);
        if (!deleteKnowledge(id, imagePaths)) {
          throw new ApiError(404, "KNOWLEDGE_NOT_FOUND", "Knowledge note not found.");
        }
      } catch (error) {
        await rollbackNoteImageMutation(error, quarantine, []);
      }

      await finalizeQuarantinedNoteImages(quarantine!);
      return new Response(null, { status: 204 });
    });
  });
}
