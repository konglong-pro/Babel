import type { Category, Entry, Reflection } from "../vali/types";

export interface VaultConfig {
  name: string;
  version: number;
  createdAt: string;
  defaultCategoryId: string;
}

export interface TrashProvenance {
  sourceName: string | null;
  originalEntryId: string;
  deletedAt: string | null;
}

export interface TrashSnapshot extends TrashProvenance {
  entry: Entry;
}

export interface VaultSnapshot {
  config: VaultConfig;
  categories: Category[];
  entries: Entry[];
  reflections: Reflection[];
  trash: TrashSnapshot[];
}
