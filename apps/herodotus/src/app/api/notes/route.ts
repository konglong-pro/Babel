import { NextResponse } from "next/server";

import { ApiError, handleApi } from "@/lib/http/errors";
import {
  assertOnlyFields,
  assertSameOrigin,
  optionalString,
  optionalStringArray,
  parsePositiveInteger,
  readNoteMultipart,
  requiredPositiveInteger,
  requiredString,
} from "@/lib/http/request";
import { createNote, getFolder, listNotes } from "@/lib/repositories";
import {
  assertNoteSaveLimits,
  ensureNoteImageStorageRecovered,
  finalizeQuarantinedNoteImages,
  quarantineNoteImages,
  stageNoteImages,
  withNoteImageMutationLock,
} from "@/lib/storage";

export const runtime = "nodejs";

export function GET(request: Request): Promise<Response> {
  return handleApi(() => {
    const value = new URL(request.url).searchParams.get("folderId");
    const folderId = value === null ? undefined : parsePositiveInteger(value, "folderId");
    return NextResponse.json(listNotes(folderId));
  });
}

export function POST(request: Request): Promise<Response> {
  return handleApi(async () => {
    assertSameOrigin(request);
    await ensureNoteImageStorageRecovered();
    const { payload, uploads } = await readNoteMultipart(request);
    assertOnlyFields(payload, ["folderId", "title", "contentMd", "tags"]);
    const folderId = requiredPositiveInteger(payload, "folderId");
    const title = requiredString(payload, "title");
    const contentMd =
      optionalString(payload, "contentMd", { allowEmpty: true, trim: false }) ?? "";
    const tags = optionalStringArray(payload, "tags") ?? [];
    return withNoteImageMutationLock(async () => {
      if (!getFolder(folderId)) {
        throw new ApiError(404, "FOLDER_NOT_FOUND", "Folder not found.", { folderId });
      }
      assertNoteSaveLimits(contentMd, uploads);
      const staged = await stageNoteImages(contentMd, uploads);
      try {
        const note = createNote(
          {
            folderId,
            title,
            contentMd: staged.contentMd,
            tags,
          },
          staged.imagePaths,
        );
        return NextResponse.json(note, { status: 201 });
      } catch (error) {
        let quarantine;
        try {
          quarantine = await quarantineNoteImages(staged.imagePaths);
        } catch (cleanupError) {
          throw new AggregateError(
            [error, cleanupError],
            "Note creation failed and staged images could not be quarantined.",
          );
        }
        await finalizeQuarantinedNoteImages(quarantine);
        throw error;
      }
    });
  });
}
