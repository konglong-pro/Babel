import path from "node:path";

import {
  MarkdownFolderImportError,
  type FolderImportFileLike,
  type MarkdownFolderCommitResult,
} from "@babel-apps/platform/imports/core";
import {
  cleanupMarkdownFolderImportSession,
  createMarkdownFolderImportSession,
  deleteMarkdownFolderImportSession,
  folderImportImageUpload,
  prepareMarkdownFolderImport,
  rethrowAfterMarkdownFolderImportCleanup,
  uploadMarkdownFolderImportFile,
} from "@babel-apps/platform/imports/server";

import { ApiError } from "@/lib/http/errors";
import { importMarkdownFolderBatch, listMarkdownFolderImportTitles } from "@/lib/repositories";
import {
  NOTE_UPLOAD_PLACEHOLDER_PREFIX,
  ensureNoteImageStorageRecovered,
  finalizeQuarantinedNoteImages,
  quarantineNoteImages,
  stageNoteImages,
  withNoteImageMutationLock,
} from "@/lib/storage";

const stagingRoot = () => path.join(
  process.env.RETEX_NOTE_UPLOAD_DIRECTORY
    ? path.resolve(/* turbopackIgnore: true */ process.env.RETEX_NOTE_UPLOAD_DIRECTORY)
    : path.resolve(process.cwd(), "..", "..", "data", "retex", "uploads", "notes"),
  ".folder-imports",
);

export const createMarkdownFolderSession = () => wrap(() =>
  createMarkdownFolderImportSession(stagingRoot()));
export const uploadMarkdownFolderSessionFile = (
  sessionId: string,
  sourcePath: string,
  kind: "markdown" | "image",
  file: FolderImportFileLike,
) => wrap(() => uploadMarkdownFolderImportFile(stagingRoot(), sessionId, sourcePath, kind, file));
export const cancelMarkdownFolderSession = (sessionId: string) => wrap(() =>
  deleteMarkdownFolderImportSession(stagingRoot(), sessionId));

export async function commitMarkdownFolderSession(
  sessionId: string,
  manifest: unknown,
): Promise<MarkdownFolderCommitResult> {
  return wrap(async () => {
    const root = stagingRoot();
    try {
      await ensureNoteImageStorageRecovered();
    } catch (error) {
      return rethrowAfterMarkdownFolderImportCleanup(error, [
        () => cleanupMarkdownFolderImportSession(root, sessionId),
      ]);
    }
    return withNoteImageMutationLock(async () => {
      const stagedRecords = [];
      const allImagePaths: string[] = [];
      try {
        const prepared = await prepareMarkdownFolderImport(root, sessionId, manifest, {
          existingTitles: listMarkdownFolderImportTitles(),
          uploadPlaceholderPrefix: NOTE_UPLOAD_PLACEHOLDER_PREFIX,
        });
        for (const record of prepared.records) {
          const uploads = new Map(record.images.map((image) => [
            image.token,
            folderImportImageUpload(image.file),
          ]));
          const staged = await stageNoteImages(record.contentMd, uploads);
          allImagePaths.push(...staged.imagePaths);
          stagedRecords.push({ ...record, contentMd: staged.contentMd, imagePaths: staged.imagePaths });
        }
        const result = importMarkdownFolderBatch(prepared.manifest.baseFolderId, stagedRecords);
        await deleteMarkdownFolderImportSession(root, sessionId)
          .catch((error) => console.error("Failed to clean committed folder-import session.", error));
        return result;
      } catch (error) {
        return rethrowAfterMarkdownFolderImportCleanup(error, [
          async () => {
            if (allImagePaths.length === 0) return;
            await finalizeQuarantinedNoteImages(await quarantineNoteImages(allImagePaths));
          },
          () => cleanupMarkdownFolderImportSession(root, sessionId),
        ]);
      }
    });
  });
}

export function asFolderImportFile(value: FormDataEntryValue): FolderImportFileLike {
  if (typeof value === "string" || typeof value.arrayBuffer !== "function") {
    throw new ApiError(400, "VALIDATION_ERROR", "The file field must contain one file.");
  }
  return value;
}

async function wrap<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof MarkdownFolderImportError) {
      throw new ApiError(error.status, error.code, error.message, error.details);
    }
    throw error;
  }
}
