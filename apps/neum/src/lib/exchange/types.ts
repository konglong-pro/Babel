export const NEUM_SNAPSHOT_APP_ID = "neum" as const;
export const NEUM_SNAPSHOT_SCHEMA_VERSION = 2 as const;
export const NEUM_LEGACY_SNAPSHOT_SCHEMA_VERSION = 1 as const;

export const snapshotImageContentTypes = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
] as const;

export type SnapshotImageContentType =
  (typeof snapshotImageContentTypes)[number];
export type SnapshotEntryKind = "knowledge" | "snippet";

export interface SnapshotFolder {
  id: number;
  parentId: number | null;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface SnapshotTag {
  id: number;
  name: string;
}

export interface SnapshotEntryRecord {
  id: number;
  parentId: number | null;
  folderId: number;
  kind: SnapshotEntryKind;
  title: string;
  notesMd: string;
  code: string | null;
  language: string | null;
  filename: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface SnapshotEntryImageReference {
  id: number;
  imagePath: string;
  createdAt: string;
}

export interface SnapshotEntry extends SnapshotEntryRecord {
  tagIds: number[];
  images: SnapshotEntryImageReference[];
}

export interface SnapshotTrashPayload {
  entry: SnapshotEntryRecord;
  tags: string[];
  imagePaths: string[];
}

export interface SnapshotTrashEntry {
  id: number;
  originalEntryId: number;
  folderId: number;
  snapshot: SnapshotTrashPayload;
  deletedAt: string;
}

export interface SnapshotImage {
  imagePath: string;
  contentType: SnapshotImageContentType;
  size: number;
  sha256: string;
}

export interface NeumSnapshotManifest {
  appId: typeof NEUM_SNAPSHOT_APP_ID;
  schemaVersion: typeof NEUM_SNAPSHOT_SCHEMA_VERSION;
  exportedAt: string;
  folders: SnapshotFolder[];
  entries: SnapshotEntry[];
  tags: SnapshotTag[];
  trash: SnapshotTrashEntry[];
  images: SnapshotImage[];
}

export type NeumDatabaseSnapshot = Omit<
  NeumSnapshotManifest,
  "appId" | "schemaVersion" | "exportedAt" | "images"
>;
