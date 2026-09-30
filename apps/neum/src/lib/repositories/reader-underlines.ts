import { getNeumDatabase } from "@/lib/db/client";

import { RepositoryError } from "./errors";

export type ReaderUnderlineColor = "yellow" | "green" | "blue" | "pink" | "orange";
export interface ReaderAnchor { start: number; end: number; exact: string; prefix: string; suffix: string }
export interface ReaderUnderline { id: number; fieldKey: "notes" | "code"; color: ReaderUnderlineColor; anchor: ReaderAnchor; noteIds: number[] }

type UnderlineRow = {
  id: number; fieldKey: "notes" | "code"; color: ReaderUnderlineColor;
  anchorStart: number; anchorEnd: number; anchorExact: string; anchorPrefix: string; anchorSuffix: string;
};

function invalid(message: string): never { throw new RepositoryError("VALIDATION", message); }
function positiveId(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) invalid(`${label} must be a positive integer.`);
  return value as number;
}
function source(kind: unknown, id: unknown): { id: number; kind: "knowledge" | "snippet" } {
  if (kind !== "entry") invalid("Invalid reader source kind.");
  const sourceId = positiveId(typeof id === "string" ? Number(id) : id, "sourceId");
  const row = getNeumDatabase().sqlite.prepare('SELECT "kind" FROM "entry" WHERE "id" = ?').get(sourceId) as { kind: "knowledge" | "snippet" } | undefined;
  if (!row) throw new RepositoryError("NOT_FOUND", "Reader source not found.");
  return { id: sourceId, kind: row.kind };
}
function color(value: unknown): ReaderUnderlineColor {
  if (value === "yellow" || value === "green" || value === "blue" || value === "pink" || value === "orange") return value;
  return invalid("Invalid underline color.");
}
function anchor(value: unknown): ReaderAnchor {
  if (typeof value !== "object" || value === null || Array.isArray(value)) invalid("Invalid underline anchor.");
  const item = value as Record<string, unknown>;
  if (!Number.isSafeInteger(item.start) || (item.start as number) < 0 ||
      !Number.isSafeInteger(item.end) || (item.end as number) <= (item.start as number) ||
      typeof item.exact !== "string" || !item.exact.trim() || item.exact.length > 10000 ||
      typeof item.prefix !== "string" || item.prefix.length > 200 ||
      typeof item.suffix !== "string" || item.suffix.length > 200) invalid("Invalid underline anchor.");
  return item as unknown as ReaderAnchor;
}
function rowToUnderline(row: UnderlineRow): ReaderUnderline {
  const notes = getNeumDatabase().sqlite.prepare('SELECT "note_id" AS "noteId" FROM "reader_underline_note" WHERE "underline_id" = ? ORDER BY "note_id"').all(row.id) as { noteId: number }[];
  return { id: row.id, fieldKey: row.fieldKey, color: row.color,
    anchor: { start: row.anchorStart, end: row.anchorEnd, exact: row.anchorExact, prefix: row.anchorPrefix, suffix: row.anchorSuffix },
    noteIds: notes.map(({ noteId }) => noteId) };
}
const selectRow = 'SELECT "id", "field_key" AS "fieldKey", "color", "anchor_start" AS "anchorStart", "anchor_end" AS "anchorEnd", "anchor_exact" AS "anchorExact", "anchor_prefix" AS "anchorPrefix", "anchor_suffix" AS "anchorSuffix" FROM "reader_underline"';
function getRow(id: number): UnderlineRow {
  const row = getNeumDatabase().sqlite.prepare(`${selectRow} WHERE "id" = ?`).get(id) as UnderlineRow | undefined;
  if (!row) throw new RepositoryError("NOT_FOUND", "Underline not found.");
  return row;
}
export function listReaderUnderlines(sourceKind: unknown, sourceId: unknown): ReaderUnderline[] {
  const selected = source(sourceKind, sourceId);
  return (getNeumDatabase().sqlite.prepare(`${selectRow} WHERE "source_entry_id" = ? ORDER BY "id"`).all(selected.id) as UnderlineRow[]).map(rowToUnderline);
}
export function createReaderUnderline(input: Record<string, unknown>): ReaderUnderline {
  const selected = source(input.sourceKind, input.sourceId);
  if (input.fieldKey !== "notes" && input.fieldKey !== "code") invalid("Invalid reader field.");
  if (input.fieldKey === "code" && selected.kind !== "snippet") invalid("Code underlines require a snippet entry.");
  const nextColor = color(input.color);
  const nextAnchor = anchor(input.anchor);
  const result = getNeumDatabase().sqlite.prepare('INSERT INTO "reader_underline" ("source_entry_id", "field_key", "color", "anchor_start", "anchor_end", "anchor_exact", "anchor_prefix", "anchor_suffix") VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(selected.id, input.fieldKey, nextColor, nextAnchor.start, nextAnchor.end, nextAnchor.exact, nextAnchor.prefix, nextAnchor.suffix);
  return rowToUnderline(getRow(Number(result.lastInsertRowid)));
}
export function updateReaderUnderline(id: unknown, input: Record<string, unknown>): ReaderUnderline {
  const underlineId = positiveId(id, "id"); getRow(underlineId);
  const nextColor = color(input.color);
  getNeumDatabase().sqlite.prepare(`UPDATE "reader_underline" SET "color" = ?, "updated_at" = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE "id" = ?`).run(nextColor, underlineId);
  return rowToUnderline(getRow(underlineId));
}
export function deleteReaderUnderline(id: unknown): void {
  const underlineId = positiveId(id, "id"); getRow(underlineId);
  getNeumDatabase().sqlite.prepare('DELETE FROM "reader_underline" WHERE "id" = ?').run(underlineId);
}
export function attachReaderUnderlineNote(id: unknown, noteId: unknown): ReaderUnderline {
  const underlineId = positiveId(id, "id"); const targetId = positiveId(noteId, "noteId"); getRow(underlineId);
  if (!getNeumDatabase().sqlite.prepare('SELECT 1 FROM "entry" WHERE "id" = ?').get(targetId)) throw new RepositoryError("NOT_FOUND", "Entry not found.");
  getNeumDatabase().sqlite.prepare('INSERT OR IGNORE INTO "reader_underline_note" ("underline_id", "note_id") VALUES (?, ?)').run(underlineId, targetId);
  return rowToUnderline(getRow(underlineId));
}
export function detachReaderUnderlineNote(id: unknown, noteId: unknown): ReaderUnderline {
  const underlineId = positiveId(id, "id"); const targetId = positiveId(noteId, "noteId"); getRow(underlineId);
  getNeumDatabase().sqlite.prepare('DELETE FROM "reader_underline_note" WHERE "underline_id" = ? AND "note_id" = ?').run(underlineId, targetId);
  return rowToUnderline(getRow(underlineId));
}
