import { NextResponse } from "next/server";

import { ApiError, handleApi } from "@/lib/http/errors";
import { parseEntryQuery } from "@/lib/http/entry-query";
import {
  assertOnlyFields,
  assertSameOrigin,
  optionalNullablePositiveInteger,
  optionalNullableString,
  optionalString,
  optionalStringArray,
  readEntryMultipart,
  requiredPositiveInteger,
  requiredString,
  type JsonObject,
} from "@/lib/http/request";
import { withEntryMutationLock } from "@/lib/mutation-lock";
import { createEntry, listEntries } from "@/lib/repositories/entries";
import {
  finalizeQuarantinedEntryImages,
  quarantineEntryImages,
  stageEntryImages,
} from "@/lib/storage";
import type { EntryKind } from "@/lib/types";

export const runtime = "nodejs";

export function GET(request: Request): Promise<Response> {
  return handleApi(() => NextResponse.json(listEntries(parseEntryQuery(request))));
}

export function POST(request: Request): Promise<Response> {
  return handleApi(() => withEntryMutationLock(async () => {
    assertSameOrigin(request);
    const { payload, uploads } = await readEntryMultipart(request);
    assertOnlyFields(payload, [
      "folderId",
      "parentId",
      "kind",
      "title",
      "notesMd",
      "code",
      "language",
      "filename",
      "tags",
    ]);

    const notesMd =
      optionalString(payload, "notesMd", { allowEmpty: true, trim: false }) ?? "";
    const staged = await stageEntryImages(notesMd, uploads);
    try {
      const entry = createEntry(
        {
          folderId: requiredPositiveInteger(payload, "folderId"),
          parentId: optionalNullablePositiveInteger(payload, "parentId"),
          kind: requiredEntryKind(payload),
          title: requiredString(payload, "title"),
          notesMd: staged.notesMd,
          code: optionalNullableString(payload, "code", {
            allowEmpty: true,
            trim: false,
          }),
          language: optionalNullableString(payload, "language"),
          filename: optionalNullableString(payload, "filename"),
          tags: optionalStringArray(payload, "tags") ?? [],
        },
        staged.imagePaths,
      );
      return NextResponse.json(entry, { status: 201 });
    } catch (error) {
      let quarantine;
      try {
        quarantine = await quarantineEntryImages(staged.imagePaths);
      } catch (cleanupError) {
        throw new AggregateError(
          [error, cleanupError],
          "Entry creation failed and staged images could not be quarantined.",
        );
      }
      await finalizeQuarantinedEntryImages(quarantine);
      throw error;
    }
  }));
}

function requiredEntryKind(body: JsonObject): EntryKind {
  const value = requiredString(body, "kind");
  if (value !== "knowledge" && value !== "snippet") {
    throw new ApiError(400, "VALIDATION_ERROR", "kind must be knowledge or snippet.", {
      field: "kind",
    });
  }
  return value;
}
