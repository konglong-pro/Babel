type MutationLockState = { tail: Promise<void> };

const globalForMutationLock = globalThis as typeof globalThis & {
  __neumEntryMutationLock?: MutationLockState;
};

function lockState(): MutationLockState {
  const state = globalForMutationLock.__neumEntryMutationLock ?? {
    tail: Promise.resolve(),
  };
  globalForMutationLock.__neumEntryMutationLock = state;
  return state;
}

/** Serializes database + managed-image mutations within a Neum server process. */
export async function withEntryMutationLock<T>(operation: () => Promise<T>): Promise<T> {
  const state = lockState();
  const previous = state.tail;
  let release!: () => void;
  state.tail = new Promise<void>((resolve) => {
    release = resolve;
  });

  await previous;
  try {
    return await operation();
  } finally {
    release();
  }
}
