import { NextResponse } from "next/server";

import { ApiError, handleApi } from "@/lib/http/errors";
import {
  assertOnlyFields,
  assertPatchHasFields,
  assertSameOrigin,
  optionalNullablePositiveInteger,
  optionalNullableString,
  optionalNonNegativeInteger,
  optionalPositiveInteger,
  optionalString,
  optionalStringArray,
  parsePositiveInteger,
  readEntryMultipart,
  readJsonObject,
  requiredPositiveInteger,
} from "@/lib/http/request";
import { withEntryMutationLock } from "@/lib/mutation-lock";
import {
  deleteEntry,
  getEntry,
  listEntryImagePaths,
  updateEntry,
  type UpdateEntryInput,
} from "@/lib/repositories/entries";
import {
  assertEntrySaveLimits,
  ensureEntryImageStorageRecovered,
  finalizeQuarantinedEntryImages,
  managedImagePathsInMarkdown,
  quarantineEntryImages,
  restoreQuarantinedEntryImages,
  stageEntryImages,
  type EntryImageQuarantine,
} from "@/lib/storage";
import type { EntryKind } from "@/lib/types";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

export function GET(_request: Request, context: RouteContext): Promise<Response> {
  return handleApi(async () => {
    const entry = getEntry(await routeId(context));
    if (!entry) throw entryNotFound();
    return NextResponse.json(entry);
  });
}

export function PATCH(request: Request, context: RouteContext): Promise<Response> {
  return handleApi(async () => {
    assertSameOrigin(request);
    await ensureEntryImageStorageRecovered();
    return withEntryMutationLock(async () => {
      const id = await routeId(context);
      const current = getEntry(id);
      if (!current) throw entryNotFound();

    const { payload, uploads } = await readEntryMultipart(request);
    assertOnlyFields(payload, [
      "expectedVersion",
      "folderId",
      "parentId",
      "kind",
      "title",
      "notesMd",
      "code",
      "language",
      "filename",
      "tags",
      "position",
    ]);

    const patch: UpdateEntryInput = {
      expectedVersion: requiredPositiveInteger(payload, "expectedVersion"),
    };
    const folderId = optionalPositiveInteger(payload, "folderId");
    const parentId = optionalNullablePositiveInteger(payload, "parentId");
    const kind = optionalEntryKind(payload);
    const title = optionalString(payload, "title");
    const notesMd = optionalString(payload, "notesMd", {
      allowEmpty: true,
      trim: false,
    });
    const code = optionalNullableString(payload, "code", {
      allowEmpty: true,
      trim: false,
    });
    const language = optionalNullableString(payload, "language");
    const filename = optionalNullableString(payload, "filename");
    const tags = optionalStringArray(payload, "tags");
    const position = optionalNonNegativeInteger(payload, "position");
    if (folderId !== undefined) patch.folderId = folderId;
    if (parentId !== undefined) patch.parentId = parentId;
    if (kind !== undefined) patch.kind = kind;
    if (title !== undefined) patch.title = title;
    if (code !== undefined) patch.code = code;
    if (language !== undefined) patch.language = language;
    if (filename !== undefined) patch.filename = filename;
    if (tags !== undefined) patch.tags = tags;
    if (position !== undefined) patch.position = position;

    if (notesMd === undefined && uploads.size > 0) {
      throw new ApiError(
        400,
        "VALIDATION_ERROR",
        "notesMd is required when adding images.",
        { field: "notesMd" },
      );
    }
    const nextCode = code === undefined ? current.code : code;
    if (notesMd !== undefined || code !== undefined || uploads.size > 0) {
      assertEntrySaveLimits(notesMd ?? current.notesMd, nextCode, uploads);
    }
    const staged = notesMd === undefined
      ? { notesMd: undefined, imagePaths: [] }
      : await stageEntryImages(notesMd, uploads, nextCode);
    if (staged.notesMd !== undefined) patch.notesMd = staged.notesMd;

    assertPatchHasFields(
      {
        folderId,
        parentId,
        kind,
        title,
        notesMd,
        code,
        language,
        filename,
        tags,
        position,
        uploads: uploads.size > 0 ? true : undefined,
      },
      "At least one entry field must be provided for update.",
    );

    const ownedImagePaths = listEntryImagePaths(id);
    const nextNotesMd = staged.notesMd ?? current.notesMd;
    const referencedImagePaths = managedImagePathsInMarkdown(nextNotesMd);
    const removedImagePaths = ownedImagePaths.filter(
      (imagePath) => !referencedImagePaths.has(imagePath),
    );

    let quarantine: EntryImageQuarantine | undefined;
    let result;
    try {
      quarantine = await quarantineEntryImages(removedImagePaths);
      result = updateEntry(id, patch, staged.imagePaths, removedImagePaths);
    } catch (error) {
      await rollbackImageMutation(error, quarantine, staged.imagePaths);
    }
    await finalizeQuarantinedEntryImages(quarantine!);
      return NextResponse.json(result!.entry);
    });
  });
}

export function DELETE(request: Request, context: RouteContext): Promise<Response> {
  return handleApi(async () => {
    assertSameOrigin(request);
    await ensureEntryImageStorageRecovered();
    return withEntryMutationLock(async () => {
      const id = await routeId(context);
      const body = await readJsonObject(request);
      assertOnlyFields(body, ["expectedVersion"]);
      const expectedVersion = requiredPositiveInteger(body, "expectedVersion");
      const imagePaths = listEntryImagePaths(id);

      let quarantine: EntryImageQuarantine | undefined;
      try {
        quarantine = await quarantineEntryImages(imagePaths);
        if (!deleteEntry(id, expectedVersion, imagePaths)) throw entryNotFound();
      } catch (error) {
        if (quarantine) {
          try {
            await restoreQuarantinedEntryImages(quarantine);
          } catch (restoreError) {
            throw new AggregateError(
              [error, restoreError],
              "Entry deletion failed and its images could not be restored.",
            );
          }
        }
        throw error;
      }
      await finalizeQuarantinedEntryImages(quarantine!);
      return new Response(null, { status: 204 });
    });
  });
}

async function routeId(context: RouteContext): Promise<number> {
  const { id } = await context.params;
  return parsePositiveInteger(id, "id");
}

function optionalEntryKind(body: Record<string, unknown>): EntryKind | undefined {
  const value = optionalString(body, "kind");
  if (value === undefined) return undefined;
  if (value !== "knowledge" && value !== "snippet") {
    throw new ApiError(400, "VALIDATION_ERROR", "kind must be knowledge or snippet.", {
      field: "kind",
    });
  }
  return value;
}

function entryNotFound(): ApiError {
  return new ApiError(404, "ENTRY_NOT_FOUND", "Entry not found.");
}

async function rollbackImageMutation(
  cause: unknown,
  quarantine: EntryImageQuarantine | undefined,
  newImagePaths: readonly string[],
): Promise<never> {
  const rollbackFailures: unknown[] = [];
  if (quarantine) {
    try {
      await restoreQuarantinedEntryImages(quarantine);
    } catch (error) {
      rollbackFailures.push(error);
    }
  }

  let newImageQuarantine: EntryImageQuarantine | undefined;
  try {
    newImageQuarantine = await quarantineEntryImages(newImagePaths);
  } catch (error) {
    rollbackFailures.push(error);
  }
  if (newImageQuarantine) {
    try {
      await finalizeQuarantinedEntryImages(newImageQuarantine);
    } catch (error) {
      rollbackFailures.push(error);
    }
  }

  if (rollbackFailures.length > 0) {
    throw new AggregateError(
      [cause, ...rollbackFailures],
      "The entry change failed and its images could not be fully restored.",
    );
  }
  throw cause;
}
