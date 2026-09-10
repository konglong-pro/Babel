type MutationLockState = { tail: Promise<void> };

const processGlobal = globalThis as typeof globalThis & {
  __babel__APP_ENV_PREFIX__NoteImageMutationLock?: MutationLockState;
};

function mutationLockState(): MutationLockState {
  return (processGlobal.__babel__APP_ENV_PREFIX__NoteImageMutationLock ??= {
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
