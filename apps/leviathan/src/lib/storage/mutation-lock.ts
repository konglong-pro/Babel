type MutationLockState = { tail: Promise<void> };

const processGlobal = globalThis as typeof globalThis & {
  __leviathanNoteImageMutationLock?: MutationLockState;
};

function mutationLockState(): MutationLockState {
  return (processGlobal.__leviathanNoteImageMutationLock ??= {
    tail: Promise.resolve(),
  });
}

export async function withNoteImageMutationLock<T>(
  mutation: () => Promise<T>,
): Promise<T> {
  const state = mutationLockState();
  const previous = state.tail;
  let release!: () => void;
  state.tail = new Promise<void>((resolve) => {
    release = resolve;
  });

  await previous;
  try {
    return await mutation();
  } finally {
    release();
  }
}
