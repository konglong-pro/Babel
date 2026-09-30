import { db } from "@/lib/db/client";
import { noteImages } from "@/lib/db/schema";

import { withNoteImageMutationLock } from "./mutation-lock";
import { reconcileNoteImageStorage } from "./note-images";

type RecoveryState = { promise?: Promise<void> };

const processGlobal = globalThis as typeof globalThis & {
  __valiNoteImageRecovery?: RecoveryState;
};

function recoveryState(): RecoveryState {
  return (processGlobal.__valiNoteImageRecovery ??= {});
}

export function ensureNoteImageStorageRecovered(): Promise<void> {
  const state = recoveryState();
  state.promise ??= recoverNoteImageStorage().catch((error: unknown) => {
    state.promise = undefined;
    throw error;
  });
  return state.promise;
}

export async function recoverNoteImageStorage(
  reconcile: (ownedImagePaths: ReadonlySet<string>) => Promise<void> =
    reconcileNoteImageStorage,
): Promise<void> {
  await withNoteImageMutationLock(async () => {
    const ownedImagePaths = new Set(
      db
        .select({ imagePath: noteImages.imagePath })
        .from(noteImages)
        .all()
        .map(({ imagePath }) => imagePath),
    );
    await reconcile(ownedImagePaths);
  });
}

