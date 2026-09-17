import type BetterSqlite3 from "better-sqlite3";
import { NextResponse } from "next/server";

import { ApiError } from "../http/errors";
import {
  assertOnlyFields,
  assertPatchHasFields,
  assertSameOrigin,
  optionalString,
  parsePositiveInteger,
  readJsonObject,
} from "../http/request";
import {
  createEmptyCanvasScene,
  decodeCanvasScene,
  encodeCanvasScene,
  type CanvasDetail,
  type CanvasSummary,
} from "./core";

type CanvasRow = {
  id: number;
  title: string;
  scene: string;
  createdAt: string;
  updatedAt: string;
};

export interface UpdateCanvasInput {
  title?: string;
  scene?: unknown;
}

export interface CanvasRepository {
  list(): CanvasSummary[];
  get(id: number): CanvasDetail | null;
  create(title?: string): CanvasDetail;
  update(id: number, input: UpdateCanvasInput): CanvasDetail | null;
  delete(id: number): boolean;
}

class CanvasRepositoryError extends Error {
  readonly code: "VALIDATION" | "CONFLICT";
  readonly details?: Readonly<Record<string, unknown>>;

  constructor(
    code: "VALIDATION" | "CONFLICT",
    message: string,
    details?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
    this.name = "CanvasRepositoryError";
    this.code = code;
    this.details = details;
  }
}

export function createCanvasRepository(sqlite: BetterSqlite3.Database): CanvasRepository {
  function list(): CanvasSummary[] {
    return (sqlite.prepare(`
      SELECT id, title, scene, created_at AS createdAt, updated_at AS updatedAt
      FROM canvas
      ORDER BY updated_at DESC, id DESC
    `).all() as CanvasRow[]).map(toSummary);
  }

  function get(id: number): CanvasDetail | null {
    assertPositiveId(id);
    const row = sqlite.prepare(`
      SELECT id, title, scene, created_at AS createdAt, updated_at AS updatedAt
      FROM canvas WHERE id = ?
    `).get(id) as CanvasRow | undefined;
    return row === undefined ? null : toDetail(row);
  }

  function create(title = "Untitled canvas"): CanvasDetail {
    const row = sqlite.prepare(`
      INSERT INTO canvas (title, scene) VALUES (?, ?)
      RETURNING id, title, scene, created_at AS createdAt, updated_at AS updatedAt
    `).get(normalizeTitle(title), encodeCanvasScene(createEmptyCanvasScene())) as CanvasRow;
    return toDetail(row);
  }

  function update(id: number, input: UpdateCanvasInput): CanvasDetail | null {
    assertPositiveId(id);
    const title = input.title === undefined ? undefined : normalizeTitle(input.title);
    const scene = input.scene === undefined ? undefined : normalizeScene(input.scene);
    let row: CanvasRow | undefined;
    if (title !== undefined && scene !== undefined) {
      row = sqlite.prepare(`
        UPDATE canvas SET title = ?, scene = ?, updated_at = (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        WHERE id = ? RETURNING id, title, scene, created_at AS createdAt, updated_at AS updatedAt
      `).get(title, scene, id) as CanvasRow | undefined;
    } else if (title !== undefined) {
      row = sqlite.prepare(`
        UPDATE canvas SET title = ?, updated_at = (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        WHERE id = ? RETURNING id, title, scene, created_at AS createdAt, updated_at AS updatedAt
      `).get(title, id) as CanvasRow | undefined;
    } else if (scene !== undefined) {
      row = sqlite.prepare(`
        UPDATE canvas SET scene = ?, updated_at = (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        WHERE id = ? RETURNING id, title, scene, created_at AS createdAt, updated_at AS updatedAt
      `).get(scene, id) as CanvasRow | undefined;
    } else {
      return get(id);
    }
    return row === undefined ? null : toDetail(row);
  }

  function remove(id: number): boolean {
    assertPositiveId(id);
    return sqlite.prepare("DELETE FROM canvas WHERE id = ?").run(id).changes > 0;
  }

  return { list, get, create, update, delete: remove };
}

function assertPositiveId(id: number): void {
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new CanvasRepositoryError("VALIDATION", "id must be a positive integer.", { field: "id" });
  }
}

function normalizeTitle(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new CanvasRepositoryError("VALIDATION", "title is required.", { field: "title" });
  }
  const title = value.trim();
  if (title.length > 160) {
    throw new CanvasRepositoryError("VALIDATION", "Canvas title must not exceed 160 characters.", {
      field: "title",
    });
  }
  return title;
}

function normalizeScene(value: unknown): string {
  try {
    return encodeCanvasScene(value);
  } catch (error) {
    throw new CanvasRepositoryError(
      "VALIDATION",
      error instanceof Error ? error.message : "Canvas scene is invalid.",
      { field: "scene" },
    );
  }
}

function toSummary(row: CanvasRow): CanvasSummary {
  return {
    id: row.id,
    title: row.title,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toDetail(row: CanvasRow): CanvasDetail {
  try {
    return { ...toSummary(row), scene: decodeCanvasScene(row.scene) };
  } catch (error) {
    throw new CanvasRepositoryError(
      "CONFLICT",
      error instanceof Error ? error.message : "Stored canvas scene is invalid.",
      { canvasId: row.id },
    );
  }
}

type HandleApi = (handler: () => Response | Promise<Response>) => Promise<Response>;
export type CanvasRouteContext = { params: Promise<{ id: string }> };

export function createCanvasCollectionHandlers(repository: CanvasRepository, handleApi: HandleApi) {
  return {
    GET(): Promise<Response> {
      return handleApi(() => NextResponse.json(repository.list()));
    },
    POST(request: Request): Promise<Response> {
      return handleApi(async () => {
        assertSameOrigin(request);
        const body = await readJsonObject(request);
        assertOnlyFields(body, ["title"]);
        const title = optionalString(body, "title") ?? "Untitled canvas";
        return NextResponse.json(repository.create(title), { status: 201 });
      });
    },
  };
}

export function createCanvasItemHandlers(repository: CanvasRepository, handleApi: HandleApi) {
  async function routeId(context: CanvasRouteContext): Promise<number> {
    return parsePositiveInteger((await context.params).id, "id");
  }

  return {
    GET(_request: Request, context: CanvasRouteContext): Promise<Response> {
      return handleApi(async () => {
        const canvas = repository.get(await routeId(context));
        if (canvas === null) throw new ApiError(404, "CANVAS_NOT_FOUND", "Canvas not found.");
        return NextResponse.json(canvas);
      });
    },
    PATCH(request: Request, context: CanvasRouteContext): Promise<Response> {
      return handleApi(async () => {
        assertSameOrigin(request);
        const body = await readJsonObject(request);
        assertOnlyFields(body, ["title", "scene"]);
        assertPatchHasFields(body);
        const patch: UpdateCanvasInput = {};
        const title = optionalString(body, "title");
        if (title !== undefined) patch.title = title;
        if (Object.hasOwn(body, "scene")) patch.scene = body.scene;
        const canvas = repository.update(await routeId(context), patch);
        if (canvas === null) throw new ApiError(404, "CANVAS_NOT_FOUND", "Canvas not found.");
        return NextResponse.json(canvas);
      });
    },
    DELETE(request: Request, context: CanvasRouteContext): Promise<Response> {
      return handleApi(async () => {
        assertSameOrigin(request);
        if (!repository.delete(await routeId(context))) {
          throw new ApiError(404, "CANVAS_NOT_FOUND", "Canvas not found.");
        }
        return new Response(null, { status: 204 });
      });
    },
  };
}
