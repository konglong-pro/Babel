import { sqlite } from "@/lib/db/client";

import { RepositoryError } from "./errors";

export const readerUnderlineColors = ["yellow", "green", "blue", "pink", "orange"] as const;
export type ReaderUnderlineColor = (typeof readerUnderlineColors)[number];

export interface ReaderUnderlineAnchor {
  start: number;
  end: number;
  exact: string;
  prefix: string;
  suffix: string;
}

export interface ReaderUnderlineDto {
  id: number;
  fieldKey: "content";
  color: ReaderUnderlineColor;
  anchor: ReaderUnderlineAnchor;
  noteIds: number[];
}

interface UnderlineRow {
  id: number;
  fieldKey: "content";
  color: ReaderUnderlineColor;
  start: number;
  end: number;
  exact: string;
  prefix: string;
  suffix: string;
  noteId: number | null;
}

const selectUnderlines = `
  SELECT u.id, u.field_key AS fieldKey, u.color,
    u.start_offset AS start, u.end_offset AS end,
    u.exact_text AS exact, u.prefix_text AS prefix, u.suffix_text AS suffix,
    l.note_id AS noteId
  FROM reader_underline u
  LEFT JOIN reader_underline_note l ON l.underline_id = u.id
`;

export function normalizeReaderUnderlineColor(value: unknown): ReaderUnderlineColor {
  if (typeof value === "string" && readerUnderlineColors.includes(value as ReaderUnderlineColor)) {
    return value as ReaderUnderlineColor;
  }
  throw new RepositoryError("VALIDATION", "color must be yellow, orange, pink, green, or blue.", {
    field: "color",
  });
}

export function normalizeReaderUnderlineAnchor(value: unknown): ReaderUnderlineAnchor {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new RepositoryError("VALIDATION", "anchor must be an object.", { field: "anchor" });
  }
  const anchor = value as Record<string, unknown>;
  if (
    !Number.isSafeInteger(anchor.start) ||
    !Number.isSafeInteger(anchor.end) ||
    (anchor.start as number) < 0 ||
    (anchor.end as number) <= (anchor.start as number) ||
    (anchor.end as number) - (anchor.start as number) > 20_000 ||
    typeof anchor.exact !== "string" ||
    anchor.exact.length === 0 ||
    anchor.exact.length > 20_000 ||
    !anchor.exact.trim() ||
    typeof anchor.prefix !== "string" ||
    anchor.prefix.length > 256 ||
    typeof anchor.suffix !== "string" ||
    anchor.suffix.length > 256 ||
    Object.keys(anchor).some((key) => !["start", "end", "exact", "prefix", "suffix"].includes(key))
  ) {
    throw new RepositoryError("VALIDATION", "anchor contains an invalid text selection.", {
      field: "anchor",
    });
  }
  return anchor as unknown as ReaderUnderlineAnchor;
}

function requirePositiveId(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RepositoryError("VALIDATION", `${field} must be a positive integer.`, { field });
  }
}

function requireNote(id: number): void {
  requirePositiveId(id, "noteId");
  if (!sqlite.prepare("SELECT 1 FROM note WHERE id = ?").get(id)) {
    throw new RepositoryError("NOT_FOUND", "Note not found.", { noteId: id });
  }
}

function requireUnderline(id: number): void {
  requirePositiveId(id, "id");
  if (!sqlite.prepare("SELECT 1 FROM reader_underline WHERE id = ?").get(id)) {
    throw new RepositoryError("NOT_FOUND", "Reader underline not found.", { id });
  }
}

function toDtos(rows: UnderlineRow[]): ReaderUnderlineDto[] {
  const byId = new Map<number, ReaderUnderlineDto>();
  for (const row of rows) {
    let dto = byId.get(row.id);
    if (!dto) {
      dto = {
        id: row.id,
        fieldKey: row.fieldKey,
        color: row.color,
        anchor: {
          start: row.start,
          end: row.end,
          exact: row.exact,
          prefix: row.prefix,
          suffix: row.suffix,
        },
        noteIds: [],
      };
      byId.set(row.id, dto);
    }
    if (row.noteId !== null) dto.noteIds.push(row.noteId);
  }
  return [...byId.values()];
}

export function listReaderUnderlines(sourceNoteId: number): ReaderUnderlineDto[] {
  requireNote(sourceNoteId);
  return toDtos(sqlite.prepare(`${selectUnderlines}
    WHERE u.source_note_id = ? ORDER BY u.id, l.note_id`).all(sourceNoteId) as UnderlineRow[]);
}

export function getReaderUnderline(id: number): ReaderUnderlineDto | null {
  requirePositiveId(id, "id");
  const rows = sqlite.prepare(`${selectUnderlines}
    WHERE u.id = ? ORDER BY l.note_id`).all(id) as UnderlineRow[];
  return toDtos(rows)[0] ?? null;
}

export function createReaderUnderline(input: {
  sourceNoteId: number;
  fieldKey: unknown;
  color: unknown;
  anchor: unknown;
}): ReaderUnderlineDto {
  requireNote(input.sourceNoteId);
  if (input.fieldKey !== "content") {
    throw new RepositoryError("VALIDATION", "fieldKey must be content.", { field: "fieldKey" });
  }
  const color = normalizeReaderUnderlineColor(input.color);
  const anchor = normalizeReaderUnderlineAnchor(input.anchor);
  const inserted = sqlite.prepare(`
    INSERT INTO reader_underline
      (source_note_id, field_key, color, start_offset, end_offset, exact_text, prefix_text, suffix_text)
    VALUES (?, 'content', ?, ?, ?, ?, ?, ?)
    RETURNING id
  `).get(
    input.sourceNoteId,
    color,
    anchor.start,
    anchor.end,
    anchor.exact,
    anchor.prefix,
    anchor.suffix,
  ) as { id: number };
  return getReaderUnderline(inserted.id)!;
}

export function recolorReaderUnderline(id: number, color: unknown): ReaderUnderlineDto {
  requireUnderline(id);
  const normalizedColor = normalizeReaderUnderlineColor(color);
  sqlite.prepare(`UPDATE reader_underline SET color = ?,
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`).run(normalizedColor, id);
  return getReaderUnderline(id)!;
}

export function deleteReaderUnderline(id: number): void {
  requireUnderline(id);
  sqlite.prepare("DELETE FROM reader_underline WHERE id = ?").run(id);
}

export function attachReaderUnderlineNote(id: number, noteId: number): ReaderUnderlineDto {
  sqlite.transaction(() => {
    requireUnderline(id);
    requireNote(noteId);
    sqlite.prepare("INSERT OR IGNORE INTO reader_underline_note (underline_id, note_id) VALUES (?, ?)")
      .run(id, noteId);
  })();
  return getReaderUnderline(id)!;
}

export function detachReaderUnderlineNote(id: number, noteId: number): void {
  requireUnderline(id);
  requirePositiveId(noteId, "noteId");
  sqlite.prepare("DELETE FROM reader_underline_note WHERE underline_id = ? AND note_id = ?")
    .run(id, noteId);
}
