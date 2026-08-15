import path from "node:path";

import {
  cleanupMarkdownFolderImportSession,
  createMarkdownFolderImportSession,
  deleteMarkdownFolderImportSession,
  folderImportImageUpload,
  prepareMarkdownFolderImport,
  rethrowAfterMarkdownFolderImportCleanup,
  uploadMarkdownFolderImportFile,
} from "@babel-apps/platform/imports/server";
import type {
  FolderImportFileLike,
  MarkdownFolderCommitResult,
} from "@babel-apps/platform/imports/core";

import { ApiError } from "@/lib/http/errors";
import {
  importMarkdownFolderBatch,
  listMarkdownFolderImportTitles,
} from "@/lib/repositories";
import {
  NOTE_UPLOAD_PLACEHOLDER_PREFIX,
  ensureNoteImageStorageRecovered,
  finalizeQuarantinedNoteImages,
  quarantineNoteImages,
  stageNoteImages,
  withNoteImageMutationLock,
} from "@/lib/storage";
import { MarkdownFolderImportError } from "@babel-apps/platform/imports/core";

export function markdownFolderImportStagingRoot(): string {
  const uploadRoot = process.env.HERODOTUS_UPLOAD_DIRECTORY;
  const resolved = uploadRoot
    ? path.resolve(/* turbopackIgnore: true */ uploadRoot)
    : path.resolve(process.cwd(), "..", "..", "data", "herodotus", "uploads", "notes");
  return path.join(resolved, ".folder-imports");
}

export async function createMarkdownFolderSession() {
  return wrapFolderImportError(() =>
    createMarkdownFolderImportSession(markdownFolderImportStagingRoot()));
}

export async function uploadMarkdownFolderSessionFile(
  sessionId: string,
  sourcePath: string,
  kind: "markdown" | "image",
  file: FolderImportFileLike,
) {
  return wrapFolderImportError(() => uploadMarkdownFolderImportFile(
    markdownFolderImportStagingRoot(),
    sessionId,
    sourcePath,
    kind,
    file,
  ));
}

export async function cancelMarkdownFolderSession(sessionId: string): Promise<void> {
  await wrapFolderImportError(() =>
    deleteMarkdownFolderImportSession(markdownFolderImportStagingRoot(), sessionId));
}

export async function commitMarkdownFolderSession(
  sessionId: string,
  manifest: unknown,
): Promise<MarkdownFolderCommitResult> {
  return wrapFolderImportError(async () => {
    const stagingRoot = markdownFolderImportStagingRoot();
    try {
      await ensureNoteImageStorageRecovered();
    } catch (error) {
      return rethrowAfterMarkdownFolderImportCleanup(error, [
        () => cleanupMarkdownFolderImportSession(stagingRoot, sessionId),
      ]);
    }
    return withNoteImageMutationLock(async () => {
      const stagedRecords = [];
      const allImagePaths: string[] = [];
      try {
        const prepared = await prepareMarkdownFolderImport(
          stagingRoot,
          sessionId,
          manifest,
          {
            existingTitles: listMarkdownFolderImportTitles(),
            uploadPlaceholderPrefix: NOTE_UPLOAD_PLACEHOLDER_PREFIX,
          },
        );
        for (const record of prepared.records) {
          const uploads = new Map(record.images.map((image) => [
            image.token,
            folderImportImageUpload(image.file),
          ]));
          const staged = await stageNoteImages(record.contentMd, uploads);
          allImagePaths.push(...staged.imagePaths);
          stagedRecords.push({
            ...record,
            contentMd: staged.contentMd,
            imagePaths: staged.imagePaths,
          });
        }
        const result = importMarkdownFolderBatch(prepared.manifest.baseFolderId, stagedRecords);
        await deleteMarkdownFolderImportSession(stagingRoot, sessionId)
          .catch((error) => console.error("Failed to clean committed folder-import session.", error));
        return result;
      } catch (error) {
        return rethrowAfterMarkdownFolderImportCleanup(error, [
          async () => {
            if (allImagePaths.length === 0) return;
            const quarantine = await quarantineNoteImages(allImagePaths);
            await finalizeQuarantinedNoteImages(quarantine);
          },
          () => cleanupMarkdownFolderImportSession(stagingRoot, sessionId),
        ]);
      }
    });
  });
}

export function asFolderImportFile(value: FormDataEntryValue): FolderImportFileLike {
  if (
    typeof value === "string" ||
    typeof value.name !== "string" ||
    typeof value.size !== "number" ||
    typeof value.type !== "string" ||
    typeof value.arrayBuffer !== "function"
  ) {
    throw new ApiError(400, "VALIDATION_ERROR", "The file field must contain one file.");
  }
  return value;
}

async function wrapFolderImportError<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof MarkdownFolderImportError) {
      throw new ApiError(error.status, error.code, error.message, error.details);
    }
    throw error;
  }
}
