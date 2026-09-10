import { desc, eq, sql, type SQL } from "drizzle-orm";

import {
  createEmptyCanvasScene,
  decodeCanvasScene,
  encodeCanvasScene,
  type CanvasScene,
} from "@/lib/canvas-scene";
import { db } from "@/lib/db/client";
import { canvases } from "@/lib/db/schema";
import type { CanvasDetailDto, CanvasSummaryDto } from "@/lib/types";

import { RepositoryError } from "./errors";
import { assertPositiveId, normalizeRequiredText } from "./shared";

type CanvasRow = typeof canvases.$inferSelect;

export interface UpdateCanvasInput {
  title?: string;
  scene?: unknown;
}

export function listCanvases(): CanvasSummaryDto[] {
  return db
    .select()
    .from(canvases)
    .orderBy(desc(canvases.updatedAt), desc(canvases.id))
    .all()
    .map(toCanvasSummary);
}

export function getCanvas(id: number): CanvasDetailDto | null {
  assertPositiveId(id, "id");
  const row = db.select().from(canvases).where(eq(canvases.id, id)).get();
  return row ? toCanvasDetail(row) : null;
}

export function createCanvas(title = "Untitled canvas"): CanvasDetailDto {
  const row = db
    .insert(canvases)
    .values({ title: normalizeCanvasTitle(title), scene: encodeCanvasScene(createEmptyCanvasScene()) })
    .returning()
    .get();
  return toCanvasDetail(row);
}

export function updateCanvas(id: number, input: UpdateCanvasInput): CanvasDetailDto | null {
  assertPositiveId(id, "id");
  const changes: {
    title?: string;
    scene?: string;
    updatedAt: SQL;
  } = { updatedAt: sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))` };

  if (input.title !== undefined) changes.title = normalizeCanvasTitle(input.title);
  if (input.scene !== undefined) changes.scene = normalizeCanvasScene(input.scene);

  const row = db
    .update(canvases)
    .set(changes)
    .where(eq(canvases.id, id))
    .returning()
    .get();
  return row ? toCanvasDetail(row) : null;
}

export function deleteCanvas(id: number): boolean {
  assertPositiveId(id, "id");
  return db.delete(canvases).where(eq(canvases.id, id)).returning().get() !== undefined;
}

function normalizeCanvasTitle(value: unknown): string {
  const title = normalizeRequiredText(value, "title");
  if (title.length > 160) {
    throw new RepositoryError("VALIDATION", "Canvas title must not exceed 160 characters.", {
      field: "title",
    });
  }
  return title;
}

function normalizeCanvasScene(value: unknown): string {
  try {
    return encodeCanvasScene(value);
  } catch (error) {
    throw new RepositoryError(
      "VALIDATION",
      error instanceof Error ? error.message : "Canvas scene is invalid.",
      { field: "scene" },
    );
  }
}

function toCanvasSummary(row: CanvasRow): CanvasSummaryDto {
  return {
    id: row.id,
    title: row.title,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toCanvasDetail(row: CanvasRow): CanvasDetailDto {
  let scene: CanvasScene;
  try {
    scene = decodeCanvasScene(row.scene);
  } catch (error) {
    throw new RepositoryError(
      "CONFLICT",
      error instanceof Error ? error.message : "Stored canvas scene is invalid.",
      { canvasId: row.id },
    );
  }
  return { ...toCanvasSummary(row), scene };
}
