import { NextResponse } from "next/server";

import { ApiError, handleApi } from "@/lib/http/errors";
import {
  assertOnlyFields,
  assertPatchHasFields,
  assertSameOrigin,
  optionalNullableString,
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
  getEntry,
  listEntryImagePaths,
  updateEntry,
  type UpdateEntryInput,
} from "@/lib/repositories/entries";
import { moveEntryToTrash } from "@/lib/repositories/trash";
import {
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
  return handleApi(() => withEntryMutationLock(async () => {
    assertSameOrigin(request);
    const id = await routeId(context);
    const current = getEntry(id);
    if (!current) throw entryNotFound();

    const { payload, uploads } = await readEntryMultipart(request);
    assertOnlyFields(payload, [
      "expectedVersion",
      "folderId",
      "kind",
      "title",
      "notesMd",
      "code",
      "language",
      "filename",
      "tags",
    ]);

    const patch: UpdateEntryInput = {
      expectedVersion: requiredPositiveInteger(payload, "expectedVersion"),
    };
    const folderId = optionalPositiveInteger(payload, "folderId");
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
    if (folderId !== undefined) patch.folderId = folderId;
    if (kind !== undefined) patch.kind = kind;
    if (title !== undefined) patch.title = title;
    if (code !== undefined) patch.code = code;
    if (language !== undefined) patch.language = language;
    if (filename !== undefined) patch.filename = filename;
    if (tags !== undefined) patch.tags = tags;

    if (notesMd === undefined && uploads.size > 0) {
      throw new ApiError(
        400,
        "VALIDATION_ERROR",
        "notesMd is required when adding images.",
        { field: "notesMd" },
      );
    }
    const staged =
      notesMd === undefined
        ? { notesMd: undefined, imagePaths: [] }
        : await stageEntryImages(notesMd, uploads);
    if (staged.notesMd !== undefined) patch.notesMd = staged.notesMd;

    assertPatchHasFields(
      {
        folderId,
        kind,
        title,
        notesMd,
        code,
        language,
        filename,
        tags,
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
  }));
}

export function DELETE(request: Request, context: RouteContext): Promise<Response> {
  return handleApi(() => withEntryMutationLock(async () => {
    assertSameOrigin(request);
    const body = await readJsonObject(request);
    assertOnlyFields(body, ["expectedVersion"]);
    const deleted = moveEntryToTrash(
      await routeId(context),
      requiredPositiveInteger(body, "expectedVersion"),
    );
    if (!deleted) throw entryNotFound();
    return new Response(null, { status: 204 });
  }));
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
