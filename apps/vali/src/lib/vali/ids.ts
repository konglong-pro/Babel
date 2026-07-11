import { randomInt } from "node:crypto";

const ID_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

export function newId(prefix: "cat" | "ent", exists: (candidate: string) => boolean): string {
  while (true) {
    let suffix = "";
    for (let index = 0; index < 6; index += 1) {
      suffix += ID_ALPHABET[randomInt(ID_ALPHABET.length)];
    }
    const candidate = `${prefix}_${suffix}`;
    if (!exists(candidate)) {
      return candidate;
    }
  }
}
