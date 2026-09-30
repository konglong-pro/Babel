import { asc, eq, ne, sql, type SQL } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { noteTemplates } from "@/lib/db/schema";
import { managedImagePathsInMarkdown } from "@/lib/storage";
import type { NoteTemplateDto } from "@/lib/types";

import { RepositoryError } from "./errors";
import {
  assertPositiveId,
  normalizeMarkdown,
  normalizeRequiredText,
} from "./shared";

const TEMPLATE_NAME_MAX_LENGTH = 120;
const PENDING_IMAGE_URL_PATTERN = /leviathan-upload:\/\//iu;

type NoteTemplateRow = typeof noteTemplates.$inferSelect;

export interface CreateNoteTemplateInput {
  name: string;
  contentMd?: string;
}

export interface UpdateNoteTemplateInput {
  name?: string;
  contentMd?: string;
}

export function listNoteTemplates(): NoteTemplateDto[] {
  return db
    .select()
    .from(noteTemplates)
    .orderBy(sql`lower(${noteTemplates.name})`, asc(noteTemplates.id))
    .all()
    .map(toNoteTemplateDto);
}

export function getNoteTemplate(id: number): NoteTemplateDto | null {
  assertPositiveId(id, "id");
  const row = db.select().from(noteTemplates).where(eq(noteTemplates.id, id)).get();
  return row ? toNoteTemplateDto(row) : null;
}

export function createNoteTemplate(input: CreateNoteTemplateInput): NoteTemplateDto {
  const name = normalizeTemplateName(input.name);
  const contentMd = normalizeTemplateMarkdown(input.contentMd ?? "");
  assertTemplateNameAvailable(name);
  return toNoteTemplateDto(
    db.insert(noteTemplates).values({ name, contentMd }).returning().get(),
  );
}

export function updateNoteTemplate(
  id: number,
  input: UpdateNoteTemplateInput,
): NoteTemplateDto {
  assertPositiveId(id, "id");
  const current = db.select().from(noteTemplates).where(eq(noteTemplates.id, id)).get();
  if (!current) {
    throw new RepositoryError("NOT_FOUND", "Template not found.", { templateId: id });
  }

  const changes: { name?: string; contentMd?: string; updatedAt: SQL } = {
    updatedAt: sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`,
  };
  let changed = false;
  if (input.name !== undefined) {
    changes.name = normalizeTemplateName(input.name);
    assertTemplateNameAvailable(changes.name, id);
    changed = true;
  }
  if (input.contentMd !== undefined) {
    changes.contentMd = normalizeTemplateMarkdown(input.contentMd);
    changed = true;
  }
  if (!changed) return toNoteTemplateDto(current);

  return toNoteTemplateDto(
    db.update(noteTemplates).set(changes).where(eq(noteTemplates.id, id)).returning().get(),
  );
}

export function deleteNoteTemplate(id: number): boolean {
  assertPositiveId(id, "id");
  return db
    .delete(noteTemplates)
    .where(eq(noteTemplates.id, id))
    .returning({ id: noteTemplates.id })
    .get() !== undefined;
}

function normalizeTemplateName(value: unknown): string {
  const name = normalizeRequiredText(value, "name");
  if (name.length > TEMPLATE_NAME_MAX_LENGTH) {
    throw new RepositoryError(
      "VALIDATION",
      "Template name must not exceed 120 characters.",
      { field: "name", maxLength: TEMPLATE_NAME_MAX_LENGTH },
    );
  }
  return name;
}

function normalizeTemplateMarkdown(value: unknown): string {
  const contentMd = normalizeMarkdown(value, "contentMd");
  if (
    PENDING_IMAGE_URL_PATTERN.test(contentMd) ||
    managedImagePathsInMarkdown(contentMd).size > 0
  ) {
    throw new RepositoryError(
      "VALIDATION",
      "Templates cannot contain managed note images.",
      { field: "contentMd" },
    );
  }
  return contentMd;
}

function assertTemplateNameAvailable(name: string, excludedId?: number): void {
  const nameMatches = sql`lower(${noteTemplates.name}) = lower(${name})`;
  const row = db
    .select({ id: noteTemplates.id })
    .from(noteTemplates)
    .where(excludedId === undefined
      ? nameMatches
      : sql`${nameMatches} AND ${ne(noteTemplates.id, excludedId)}`)
    .get();
  if (row) {
    throw new RepositoryError(
      "CONFLICT",
      "A template with this name already exists.",
      { field: "name" },
    );
  }
}

function toNoteTemplateDto(row: NoteTemplateRow): NoteTemplateDto {
  return {
    id: row.id,
    name: row.name,
    contentMd: row.contentMd,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
