/**
 * Produces the persisted identity used for case-insensitive folder and tag names.
 * NFKC keeps visually equivalent Unicode spellings from creating separate keys,
 * while an explicit locale makes the result deterministic across machines.
 */
export function identityKey(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("en-US");
}
