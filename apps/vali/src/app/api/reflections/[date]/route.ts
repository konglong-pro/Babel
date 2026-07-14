import { NextResponse } from "next/server";

import { ApiError, handleApi } from "@/lib/http/errors";
import {
  assertOnlyFields,
  assertSameOrigin,
  optionalString,
  readJsonObject,
  readNoteMultipart,
} from "@/lib/http/request";
import {
  getReflection,
  listReflectionImagePaths,
  normalizeReflectionDate,
  saveReflection,
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
  type NoteImageUpload,
  type NoteImageQuarantine,
} from "@/lib/storage";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ date: string }> };

async function routeDate(context: RouteContext): Promise<string> {
  const { date } = await context.params;
  return normalizeReflectionDate(date);
}

export function GET(_request: Request, context: RouteContext): Promise<Response> {
  return handleApi(async () => {
    const reflection = getReflection(await routeDate(context));
    if (!reflection) {
      throw new ApiError(404, "REFLECTION_NOT_FOUND", "Reflection not found.");
    }
    return NextResponse.json(reflection);
  });
}

export function PUT(request: Request, context: RouteContext): Promise<Response> {
  return handleApi(async () => {
    assertSameOrigin(request);
    await ensureNoteImageStorageRecovered();
    const date = await routeDate(context);
    const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
    let contentMd: string;
    let uploads = new Map<string, NoteImageUpload>();
    if (contentType.startsWith("application/json")) {
      const payload = await readJsonObject(request);
      assertOnlyFields(payload, ["contentMd"]);
      const value = optionalString(payload, "contentMd", {
        allowEmpty: true,
        trim: false,
      });
      if (value === undefined) {
        throw new ApiError(400, "VALIDATION_ERROR", "contentMd is required.", {
          field: "contentMd",
        });
      }
      contentMd = value;
    } else {
      const multipart = await readNoteMultipart(request);
      assertOnlyFields(multipart.payload, ["contentMd"]);
      const value = optionalString(multipart.payload, "contentMd", {
        allowEmpty: true,
        trim: false,
      });
      if (value === undefined) {
        throw new ApiError(400, "VALIDATION_ERROR", "contentMd is required.", {
          field: "contentMd",
        });
      }
      contentMd = value;
      uploads = multipart.uploads;
    }

    return withNoteImageMutationLock(async () => {
      assertNoteSaveLimits(contentMd, uploads);
      const staged = await stageNoteImages(contentMd, uploads);
      const current = getReflection(date);
      const ownedImagePaths = current ? listReflectionImagePaths(date) : [];
      const referencedImagePaths = managedImagePathsInMarkdown(staged.contentMd);
      const removedImagePaths = ownedImagePaths.filter(
        (imagePath) => !referencedImagePaths.has(imagePath),
      );
      let quarantine: NoteImageQuarantine | undefined;
      let result;
      try {
        quarantine = await quarantineNoteImages(removedImagePaths);
        result = saveReflection(
          date,
          staged.contentMd,
          staged.imagePaths,
          removedImagePaths,
        );
      } catch (error) {
        await rollbackImageMutation(error, quarantine, staged.imagePaths);
      }
      await finalizeQuarantinedNoteImages(quarantine!);
      return NextResponse.json(result!.reflection, { status: current ? 200 : 201 });
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
  if (newImageQuarantine) await finalizeQuarantinedNoteImages(newImageQuarantine);

  if (rollbackFailures.length > 0) {
    throw new AggregateError(
      [cause, ...rollbackFailures],
      "The reflection save failed and its images could not be fully restored.",
    );
  }
  throw cause;
}
