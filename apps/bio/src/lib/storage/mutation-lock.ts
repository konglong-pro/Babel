type MutationLockState = { tail: Promise<void> };

const processGlobal = globalThis as typeof globalThis & {
  __babelBIONoteImageMutationLock?: MutationLockState;
};

function mutationLockState(): MutationLockState {
  return (processGlobal.__babelBIONoteImageMutationLock ??= {
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
