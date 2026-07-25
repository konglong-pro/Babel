import { NextResponse } from "next/server";

import { ApiError, handleApi } from "@/lib/http/errors";
import {
  assertOnlyFields,
  assertPatchHasFields,
  assertSameOrigin,
  optionalPositiveInteger,
  optionalNullablePositiveInteger,
  optionalString,
  optionalStringArray,
  parsePositiveInteger,
  readNoteMultipart,
} from "@/lib/http/request";
import {
  deleteNote,
  getFolder,
  getNote,
  listNoteImagePaths,
  updateNote,
  type UpdateNoteInput,
} from "@/lib/repositories";
import {
  assertNoteSaveLimits,
  ensureNoteImageStorageRecovered,
  finalizeQuarantinedNoteImages,
  managedImagePathsInMarkdown,
  quarantineNoteImages,
  restoreQuarantinedNoteImages,
  stageNoteImages,
  withNoteImageMutationLock,
  type NoteImageQuarantine,
} from "@/lib/storage";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

async function routeId(context: RouteContext): Promise<number> {
  const { id } = await context.params;
  return parsePositiveInteger(id, "id");
}

export function GET(_request: Request, context: RouteContext): Promise<Response> {
  return handleApi(async () => {
    const note = getNote(await routeId(context));
    if (!note) throw new ApiError(404, "NOTE_NOT_FOUND", "Note not found.");
    return NextResponse.json(note);
  });
}

export function PATCH(request: Request, context: RouteContext): Promise<Response> {
  return handleApi(async () => {
    assertSameOrigin(request);
    await ensureNoteImageStorageRecovered();
    const id = await routeId(context);
    const { payload, uploads } = await readNoteMultipart(request);
    assertOnlyFields(payload, ["folderId", "parentId", "title", "contentMd", "tags"]);
    const patch: UpdateNoteInput = {};
    const folderId = optionalPositiveInteger(payload, "folderId");
    const parentId = optionalNullablePositiveInteger(payload, "parentId");
    const title = optionalString(payload, "title");
    const contentMd = optionalString(payload, "contentMd", {
      allowEmpty: true,
      trim: false,
    });
    const tags = optionalStringArray(payload, "tags");
    if (folderId !== undefined) patch.folderId = folderId;
    if (parentId !== undefined) patch.parentId = parentId;
    if (title !== undefined) patch.title = title;
    if (tags !== undefined) patch.tags = tags;

    if (contentMd === undefined && uploads.size > 0) {
      throw new ApiError(
        400,
        "VALIDATION_ERROR",
        "contentMd is required when adding images.",
        { field: "contentMd" },
      );
    }
    assertPatchHasFields({ ...patch, contentMd, uploads: uploads.size > 0 ? true : undefined });
    return withNoteImageMutationLock(async () => {
      const current = getNote(id);
      if (!current) throw new ApiError(404, "NOTE_NOT_FOUND", "Note not found.");
      if (folderId !== undefined && !getFolder(folderId)) {
        throw new ApiError(404, "FOLDER_NOT_FOUND", "Folder not found.", { folderId });
      }
      if (contentMd !== undefined) assertNoteSaveLimits(contentMd, uploads);
      const staged =
        contentMd === undefined
          ? { contentMd: undefined, imagePaths: [] }
          : await stageNoteImages(contentMd, uploads);
      if (staged.contentMd !== undefined) patch.contentMd = staged.contentMd;

      let quarantine: NoteImageQuarantine | undefined;
      let result;
      try {
        const ownedImagePaths = listNoteImagePaths(id);
        const nextContentMd = staged.contentMd ?? current.contentMd;
        const referencedImagePaths = managedImagePathsInMarkdown(nextContentMd);
        const removedImagePaths = ownedImagePaths.filter(
          (imagePath) => !referencedImagePaths.has(imagePath),
        );
        quarantine = await quarantineNoteImages(removedImagePaths);
        result = updateNote(id, patch, staged.imagePaths, removedImagePaths);
      } catch (error) {
        await rollbackImageMutation(error, quarantine, staged.imagePaths);
      }
      await finalizeQuarantinedNoteImages(quarantine!);
      return NextResponse.json(result!.note);
    });
  });
}

export function DELETE(request: Request, context: RouteContext): Promise<Response> {
  return handleApi(async () => {
    assertSameOrigin(request);
    await ensureNoteImageStorageRecovered();
    const id = await routeId(context);
    return withNoteImageMutationLock(async () => {
      if (!getNote(id)) throw new ApiError(404, "NOTE_NOT_FOUND", "Note not found.");
      const imagePaths = listNoteImagePaths(id);
      let quarantine: NoteImageQuarantine | undefined;
      try {
        quarantine = await quarantineNoteImages(imagePaths);
        const deleted = deleteNote(id, imagePaths);
        if (!deleted) throw new ApiError(404, "NOTE_NOT_FOUND", "Note not found.");
      } catch (error) {
        await rollbackImageMutation(error, quarantine, []);
      }
      await finalizeQuarantinedNoteImages(quarantine!);
      return new Response(null, { status: 204 });
    });
  });
}

async function rollbackImageMutation(
  cause: unknown,
  quarantine: NoteImageQuarantine | undefined,
  newImagePaths: readonly string[],
): Promise<never> {
  const rollbackFailures: unknown[] = [];
  if (quarantine) {
    try {
      await restoreQuarantinedNoteImages(quarantine);
    } catch (error) {
      rollbackFailures.push(error);
    }
  }

  let newImageQuarantine: NoteImageQuarantine | undefined;
  try {
    newImageQuarantine = await quarantineNoteImages(newImagePaths);
  } catch (error) {
    rollbackFailures.push(error);
  }
  if (newImageQuarantine) {
    await finalizeQuarantinedNoteImages(newImageQuarantine);
  }

  if (rollbackFailures.length > 0) {
    throw new AggregateError(
      [cause, ...rollbackFailures],
      "The note change failed and its images could not be fully restored.",
    );
  }
  throw cause;
}
