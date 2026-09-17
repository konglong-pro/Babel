import { getNeumDatabase } from "@/lib/db/client";
import { entryImages, trashEntries } from "@/lib/db/schema";
import { withEntryMutationLock } from "@/lib/mutation-lock";

import { ImageStorageError } from "./errors";
import {
  normalizeStoredEntryImagePath,
  reconcileEntryImageStorage,
} from "./note-images";

type RecoveryState = { promise?: Promise<void> };

const processGlobal = globalThis as typeof globalThis & {
  __neumEntryImageRecovery?: RecoveryState;
};

function recoveryState(): RecoveryState {
  return (processGlobal.__neumEntryImageRecovery ??= {});
}

export function ensureEntryImageStorageRecovered(): Promise<void> {
  const state = recoveryState();
  state.promise ??= recoverEntryImageStorage().catch((error: unknown) => {
    state.promise = undefined;
    throw error;
  });
  return state.promise;
}

export async function recoverEntryImageStorage(
  reconcile: (ownedImagePaths: ReadonlySet<string>) => Promise<void> =
    reconcileEntryImageStorage,
): Promise<void> {
  await withEntryMutationLock(async () => {
    const { db } = getNeumDatabase();
    const ownedImagePaths = new Set(
      db
        .select({ imagePath: entryImages.imagePath })
        .from(entryImages)
        .all()
        .map(({ imagePath }) => normalizeStoredEntryImagePath(imagePath)),
    );

    for (const { id, snapshotJson } of db
      .select({ id: trashEntries.id, snapshotJson: trashEntries.snapshotJson })
      .from(trashEntries)
      .all()) {
      for (const imagePath of trashSnapshotImagePaths(id, snapshotJson)) {
        ownedImagePaths.add(imagePath);
      }
    }

    await reconcile(ownedImagePaths);
  });
}

function trashSnapshotImagePaths(trashId: number, snapshotJson: string): string[] {
  let snapshot: unknown;
  try {
    snapshot = JSON.parse(snapshotJson);
  } catch {
    throw invalidTrashSnapshot(trashId);
  }
  if (
    typeof snapshot !== "object" ||
    snapshot === null ||
    !("imagePaths" in snapshot) ||
    !Array.isArray(snapshot.imagePaths) ||
    snapshot.imagePaths.some((value) => typeof value !== "string")
  ) {
    throw invalidTrashSnapshot(trashId);
  }

  try {
    return snapshot.imagePaths.map((imagePath) =>
      normalizeStoredEntryImagePath(imagePath as string),
    );
  } catch {
    throw invalidTrashSnapshot(trashId);
  }
}

function invalidTrashSnapshot(trashId: number): ImageStorageError {
  return new ImageStorageError(
    "INVALID_CONTENT",
    `Trash entry ${trashId} has invalid managed image ownership data.`,
  );
}
