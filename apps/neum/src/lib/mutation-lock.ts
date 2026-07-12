type MutationLockState = {
  held: boolean;
  waiters: Array<() => void>;
};

const globalForMutationLock = globalThis as typeof globalThis & {
  __neumEntryMutationLock?: MutationLockState;
};

function lockState(): MutationLockState {
  const state = globalForMutationLock.__neumEntryMutationLock ?? {
    held: false,
    waiters: [],
  };
  globalForMutationLock.__neumEntryMutationLock = state;
  return state;
}

/** Serializes database + managed-image mutations within a Neum server process. */
export async function withEntryMutationLock<T>(operation: () => Promise<T>): Promise<T> {
  const state = lockState();
  if (state.held) {
    await new Promise<void>((resolve) => state.waiters.push(resolve));
  } else {
    state.held = true;
  }

  try {
    return await operation();
  } finally {
    const next = state.waiters.shift();
    if (next) next();
    else state.held = false;
  }
}
