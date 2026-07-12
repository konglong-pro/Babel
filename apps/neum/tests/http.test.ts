import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import type * as EntryCollectionRoute from "@/app/api/entries/route";
import type * as EntryItemRoute from "@/app/api/entries/[id]/route";
import type * as FolderCollectionRoute from "@/app/api/folders/route";
import type * as HealthRoute from "@/app/api/health/route";
import type * as SearchRoute from "@/app/api/search/route";
import type * as TrashCollectionRoute from "@/app/api/trash/route";
import type * as TrashItemRoute from "@/app/api/trash/[id]/route";
import type * as TrashRestoreRoute from "@/app/api/trash/[id]/restore/route";
import type { EntryDetailDto, PaginatedDto, TrashEntryDto } from "@/lib/types";
import { withEntryMutationLock } from "@/lib/mutation-lock";

let entryCollectionRoute: typeof EntryCollectionRoute;
let entryItemRoute: typeof EntryItemRoute;
let folderCollectionRoute: typeof FolderCollectionRoute;
let healthRoute: typeof HealthRoute;
let searchRoute: typeof SearchRoute;
let trashCollectionRoute: typeof TrashCollectionRoute;
let trashItemRoute: typeof TrashItemRoute;
let trashRestoreRoute: typeof TrashRestoreRoute;

test("Neum HTTP contract", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "neum-http-"));
  const databasePath = path.join(root, "sqlite.db");
  const uploadDirectory = path.join(root, "uploads");
  process.env.NEUM_DATABASE_PATH = databasePath;
  process.env.NEUM_UPLOAD_DIRECTORY = uploadDirectory;
  await mkdir(uploadDirectory, { recursive: true });

  const [{ getNeumDatabase }, routes] = await Promise.all([
    import("@/lib/db/client"),
    Promise.all([
      import("@/app/api/entries/route"),
      import("@/app/api/entries/[id]/route"),
      import("@/app/api/folders/route"),
      import("@/app/api/health/route"),
      import("@/app/api/search/route"),
      import("@/app/api/trash/route"),
      import("@/app/api/trash/[id]/route"),
      import("@/app/api/trash/[id]/restore/route"),
    ]),
  ]);
  assert.equal(existsSync(databasePath), false);
  const { db, sqlite } = getNeumDatabase();
  assert.equal(existsSync(databasePath), true);
  [
    entryCollectionRoute,
    entryItemRoute,
    folderCollectionRoute,
    healthRoute,
    searchRoute,
    trashCollectionRoute,
    trashItemRoute,
    trashRestoreRoute,
  ] = routes;

  migrate(db, { migrationsFolder: path.resolve(import.meta.dirname, "..", "drizzle") });

  t.after(async () => {
    sqlite.close();
    delete process.env.NEUM_DATABASE_PATH;
    delete process.env.NEUM_UPLOAD_DIRECTORY;
    await rm(root, { recursive: true, force: true });
  });

  await t.test("health is database and upload aware", async () => {
    const response = await healthRoute.GET();
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: "ok", app: "Neum" });

    await rm(uploadDirectory, { recursive: true, force: true });
    await writeFile(uploadDirectory, "not a directory", "utf8");
    const originalConsoleError = console.error;
    console.error = () => undefined;
    try {
      const unavailable = await healthRoute.GET();
      assert.equal(unavailable.status, 503);
      assert.equal(await errorCode(unavailable), "SERVICE_UNAVAILABLE");
    } finally {
      console.error = originalConsoleError;
      await rm(uploadDirectory, { force: true });
      await mkdir(uploadDirectory, { recursive: true });
    }
  });

  await t.test("managed-image mutations are serialized", async () => {
    const order: string[] = [];
    let releaseFirst!: () => void;
    let signalStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      signalStarted = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const first = withEntryMutationLock(async () => {
      order.push("first:start");
      signalStarted();
      await gate;
      order.push("first:end");
    });
    await started;
    const second = withEntryMutationLock(async () => {
      order.push("second");
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.deepEqual(order, ["first:start"]);
    releaseFirst();
    await Promise.all([first, second]);
    assert.deepEqual(order, ["first:start", "first:end", "second"]);
  });

  await t.test("mutations reject foreign origins and unknown fields", async () => {
    const foreign = await folderCollectionRoute.POST(
      jsonRequest("http://localhost/api/folders", { name: "Systems" }, "POST", {
        origin: "https://example.com",
      }),
    );
    assert.equal(foreign.status, 403);

    const unknown = await folderCollectionRoute.POST(
      jsonRequest("http://localhost/api/folders", {
        name: "Systems",
        unexpected: true,
      }),
    );
    assert.equal(unknown.status, 400);
    assert.equal((await errorCode(unknown)), "VALIDATION_ERROR");
  });

  let snippet: EntryDetailDto;
  await t.test("snippet content is preserved and literal search is paginated", async () => {
    const inboxId = 1;
    const created = await entryCollectionRoute.POST(
      multipartRequest("http://localhost/api/entries", {
        folderId: inboxId,
        kind: "snippet",
        title: "C++ deploy_config",
        notesMd: "Broken configuration is still useful.",
        code: "root: [still, editable\nkey_%: foo_bar",
        language: "yaml",
        filename: "deploy_config.yaml",
        tags: ["Config", "config", " C++ "],
      }),
    );
    assert.equal(created.status, 201);
    snippet = (await created.json()) as EntryDetailDto;
    assert.equal(snippet.code, "root: [still, editable\nkey_%: foo_bar");
    assert.deepEqual(snippet.tags, ["C++", "Config"]);
    assert.equal(snippet.version, 1);

    for (const query of ["C++", "foo_bar", "key_%", "deploy_config.yaml"]) {
      const response = await searchRoute.GET(
        new Request(`http://localhost/api/search?q=${encodeURIComponent(query)}&limit=1`),
      );
      assert.equal(response.status, 200);
      const page = (await response.json()) as PaginatedDto<{ id: number }>;
      assert.equal(page.items[0]?.id, snippet.id);
      assert.equal(page.limit, 1);
      assert.equal(page.offset, 0);
    }
  });

  await t.test("expectedVersion prevents stale updates and deletes", async () => {
    const first = await entryItemRoute.PATCH(
      multipartRequest(`http://localhost/api/entries/${snippet.id}`, {
        expectedVersion: snippet.version,
        notesMd: "Updated notes",
      }),
      routeContext(snippet.id),
    );
    assert.equal(first.status, 200);
    const updated = (await first.json()) as EntryDetailDto;
    assert.equal(updated.version, 2);

    const stale = await entryItemRoute.PATCH(
      multipartRequest(`http://localhost/api/entries/${snippet.id}`, {
        expectedVersion: 1,
        title: "Stale title",
      }),
      routeContext(snippet.id),
    );
    assert.equal(stale.status, 409);
    assert.equal(await errorCode(stale), "VERSION_CONFLICT");

    const staleDelete = await entryItemRoute.DELETE(
      jsonRequest(
        `http://localhost/api/entries/${snippet.id}`,
        { expectedVersion: 1 },
        "DELETE",
      ),
      routeContext(snippet.id),
    );
    assert.equal(staleDelete.status, 409);
    snippet = updated;
  });

  await t.test("delete, inspect, restore, and purge use the trash contract", async () => {
    const deleted = await entryItemRoute.DELETE(
      jsonRequest(
        `http://localhost/api/entries/${snippet.id}`,
        { expectedVersion: snippet.version },
        "DELETE",
      ),
      routeContext(snippet.id),
    );
    assert.equal(deleted.status, 204);

    const trashPageResponse = await trashCollectionRoute.GET(
      new Request("http://localhost/api/trash?limit=50&offset=0"),
    );
    const trashPage = (await trashPageResponse.json()) as PaginatedDto<TrashEntryDto>;
    assert.equal(trashPage.total, 1);
    const trash = trashPage.items[0];
    assert.equal(trash.id, snippet.id);

    const detail = await trashItemRoute.GET(
      new Request(`http://localhost/api/trash/${trash.trashId}`),
      routeContext(trash.trashId),
    );
    assert.equal(detail.status, 200);

    const restoredResponse = await trashRestoreRoute.POST(
      new Request(`http://localhost/api/trash/${trash.trashId}/restore`, {
        method: "POST",
      }),
      routeContext(trash.trashId),
    );
    assert.equal(restoredResponse.status, 200);
    const restored = (await restoredResponse.json()) as EntryDetailDto;
    assert.equal(restored.id, snippet.id);
    assert.equal(restored.version, snippet.version + 1);

    const deleteAgain = await entryItemRoute.DELETE(
      jsonRequest(
        `http://localhost/api/entries/${restored.id}`,
        { expectedVersion: restored.version },
        "DELETE",
      ),
      routeContext(restored.id),
    );
    assert.equal(deleteAgain.status, 204);
    const nextTrash = (await (
      await trashCollectionRoute.GET(new Request("http://localhost/api/trash"))
    ).json()) as PaginatedDto<TrashEntryDto>;
    const purged = await trashItemRoute.DELETE(
      new Request(`http://localhost/api/trash/${nextTrash.items[0].trashId}`, {
        method: "DELETE",
      }),
      routeContext(nextTrash.items[0].trashId),
    );
    assert.equal(purged.status, 204);
  });
});

function multipartRequest(url: string, payload: Record<string, unknown>): Request {
  const form = new FormData();
  form.set("payload", JSON.stringify(payload));
  return new Request(url, { method: "POST", body: form });
}

function jsonRequest(
  url: string,
  body: Record<string, unknown>,
  method = "POST",
  headers: Record<string, string> = {},
): Request {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

function routeContext(id: number): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id: String(id) }) };
}

async function errorCode(response: Response): Promise<string | undefined> {
  const body = (await response.json()) as { error?: { code?: string } };
  return body.error?.code;
}
