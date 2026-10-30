import {
  finalizeQuarantinedNoteImages,
  quarantineNoteImages,
  restoreQuarantinedNoteImages,
  type NoteImageQuarantine,
} from "@/lib/storage/note-images";

export async function rollbackNoteImageMutation(
  cause: unknown,
  quarantine: NoteImageQuarantine | undefined,
  newImagePaths: readonly string[],
): Promise<never> {
  const rollbackFailures: unknown[] = [];
  if (quarantine !== undefined) {
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
  if (newImageQuarantine !== undefined) {
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
