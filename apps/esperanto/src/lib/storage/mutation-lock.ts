type MutationLockState = { tail: Promise<void> };

const processGlobal = globalThis as typeof globalThis & {
  __esperantoNoteImageMutationLock?: MutationLockState;
};

function mutationLockState(): MutationLockState {
  return (processGlobal.__esperantoNoteImageMutationLock ??= {
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
