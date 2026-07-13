import { NextResponse } from "next/server";

import { handleApi } from "@/lib/http/errors";
import {
  assertOnlyFields,
  assertSameOrigin,
  optionalString,
  optionalStringArray,
  optionalNullablePositiveInteger,
  parsePositiveInteger,
  readNoteMultipart,
  requiredPositiveInteger,
  requiredString,
} from "@/lib/http/request";
import { createNote, listNotes } from "@/lib/repositories";
import {
  finalizeQuarantinedNoteImages,
  quarantineNoteImages,
  stageNoteImages,
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
    const { payload, uploads } = await readNoteMultipart(request);
    assertOnlyFields(payload, ["folderId", "parentId", "title", "contentMd", "tags"]);
    const contentMd =
      optionalString(payload, "contentMd", { allowEmpty: true, trim: false }) ?? "";
    const staged = await stageNoteImages(contentMd, uploads);
    try {
      const note = createNote(
        {
          folderId: requiredPositiveInteger(payload, "folderId"),
          parentId: optionalNullablePositiveInteger(payload, "parentId") ?? null,
          title: requiredString(payload, "title"),
          contentMd: staged.contentMd,
          tags: optionalStringArray(payload, "tags") ?? [],
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
}
