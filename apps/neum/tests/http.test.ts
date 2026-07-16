import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import type * as EntryCollectionRoute from "@/app/api/entries/route";
import type * as EntryItemRoute from "@/app/api/entries/[id]/route";
import type * as EntryBacklinksRoute from "@/app/api/entries/[id]/backlinks/route";
import type * as EntryTitlesRoute from "@/app/api/entries/titles/route";
import type * as FolderCollectionRoute from "@/app/api/folders/route";
import type * as HealthRoute from "@/app/api/health/route";
import type * as SearchRoute from "@/app/api/search/route";
import type {
  EntryBacklinkDto,
  EntryDetailDto,
  EntryTitleDto,
  PaginatedDto,
  SearchResultsDto,
} from "@/lib/types";
import { withEntryMutationLock } from "@/lib/mutation-lock";

let entryCollectionRoute: typeof EntryCollectionRoute;
let entryItemRoute: typeof EntryItemRoute;
let entryBacklinksRoute: typeof EntryBacklinksRoute;
let entryTitlesRoute: typeof EntryTitlesRoute;
let folderCollectionRoute: typeof FolderCollectionRoute;
let healthRoute: typeof HealthRoute;
let searchRoute: typeof SearchRoute;

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
      import("@/app/api/entries/[id]/backlinks/route"),
      import("@/app/api/entries/titles/route"),
      import("@/app/api/folders/route"),
      import("@/app/api/health/route"),
      import("@/app/api/search/route"),
    ]),
  ]);
  assert.equal(existsSync(databasePath), false);
  const { db, sqlite } = getNeumDatabase();
  assert.equal(existsSync(databasePath), true);
  [
    entryCollectionRoute,
    entryItemRoute,
    entryBacklinksRoute,
    entryTitlesRoute,
    folderCollectionRoute,
    healthRoute,
    searchRoute,
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
      jsonRequest(
        "http://localhost/api/folders",
        {
          name: "Systems",
          unexpected: true,
        },
        "POST",
        { origin: "http://127.0.0.1" },
      ),
    );
    assert.equal(unknown.status, 400);
    assert.equal((await errorCode(unknown)), "VALIDATION_ERROR");

    const foreignEntry = await entryCollectionRoute.POST(
      multipartRequest(
        "http://localhost/api/entries",
        { folderId: 1, kind: "knowledge", title: "Foreign entry" },
        { origin: "https://example.com" },
      ),
    );
    assert.equal(foreignEntry.status, 403);
  });

  await t.test("entry routes enforce UTF-8 Markdown and code limits", async () => {
    const oversizedNotes = await entryCollectionRoute.POST(
      multipartRequest("http://localhost/api/entries", {
        folderId: 1,
        kind: "knowledge",
        title: "Oversized notes",
        notesMd: "\u53f2".repeat(Math.floor((10 * 1024 * 1024) / 3) + 1),
      }),
    );
    assert.equal(oversizedNotes.status, 413);
    assert.equal(await errorCode(oversizedNotes), "CONTENT_TOO_LARGE");

    const oversizedCode = await entryCollectionRoute.POST(
      multipartRequest("http://localhost/api/entries", {
        folderId: 1,
        kind: "snippet",
        title: "Oversized code",
        code: "x".repeat(10 * 1024 * 1024 + 1),
        language: "text",
      }),
    );
    assert.equal(oversizedCode.status, 413);
    assert.equal(await errorCode(oversizedCode), "CODE_TOO_LARGE");
  });

  let snippet: EntryDetailDto;
  let rootPage: EntryDetailDto;
  let childPage: EntryDetailDto;
  await t.test("entry routes create nested pages and reject deleting a parent", async () => {
    const rootResponse = await entryCollectionRoute.POST(
      multipartRequest("http://localhost/api/entries", {
        folderId: 1,
        parentId: null,
        kind: "knowledge",
        title: "HTTP root page",
      }),
    );
    assert.equal(rootResponse.status, 201);
    rootPage = (await rootResponse.json()) as EntryDetailDto;
    assert.equal(rootPage.parentId, null);

    const crossUnitChild = await entryCollectionRoute.POST(
      multipartRequest("http://localhost/api/entries", {
        folderId: 1,
        parentId: rootPage.id,
        kind: "snippet",
        title: "HTTP cross-unit child",
        code: "const invalid = true;",
        language: "typescript",
      }),
    );
    assert.equal(crossUnitChild.status, 409);
    assert.equal(await errorCode(crossUnitChild), "CONFLICT");

    const changedKind = await entryItemRoute.PATCH(
      multipartRequest(`http://localhost/api/entries/${rootPage.id}`, {
        expectedVersion: rootPage.version,
        kind: "snippet",
        code: "const invalid = true;",
        language: "typescript",
      }),
      routeContext(rootPage.id),
    );
    assert.equal(changedKind.status, 409);
    assert.equal(await errorCode(changedKind), "CONFLICT");

    const childResponse = await entryCollectionRoute.POST(
      multipartRequest("http://localhost/api/entries", {
        folderId: 1,
        parentId: rootPage.id,
        kind: "knowledge",
        title: "HTTP child page",
      }),
    );
    assert.equal(childResponse.status, 201);
    childPage = (await childResponse.json()) as EntryDetailDto;
    assert.equal(childPage.parentId, rootPage.id);

    const completeTreeResponse = await entryCollectionRoute.GET(
      new Request("http://localhost/api/entries?completeTree=true&limit=1"),
    );
    assert.equal(completeTreeResponse.status, 200);
    const completeTree = (await completeTreeResponse.json()) as PaginatedDto<EntryDetailDto>;
    assert.equal(completeTree.items.length, completeTree.total);
    assert.ok(completeTree.items.length >= 2);

    const blocked = await entryItemRoute.DELETE(
      jsonRequest(
        `http://localhost/api/entries/${rootPage.id}`,
        { expectedVersion: rootPage.version },
        "DELETE",
      ),
      routeContext(rootPage.id),
    );
    assert.equal(blocked.status, 409);
    assert.equal(await errorCode(blocked), "NOT_EMPTY");

    const detached = await entryItemRoute.PATCH(
      multipartRequest(`http://localhost/api/entries/${childPage.id}`, {
        expectedVersion: childPage.version,
        parentId: null,
      }),
      routeContext(childPage.id),
    );
    assert.equal(detached.status, 200);
    childPage = (await detached.json()) as EntryDetailDto;
    assert.equal(childPage.parentId, null);
  });

  await t.test("snippet content is preserved and literal search is paginated", async () => {
    const inboxId = 1;
    const created = await entryCollectionRoute.POST(
      multipartRequest("http://localhost/api/entries", {
        folderId: inboxId,
        kind: "snippet",
        title: "C++ deploy_config",
        notesMd: "Broken configuration is still useful.",
        code: "line before\nroot: [still, editable\nkey_%: foo_bar\npath: C:\\temp\nline after",
        language: "yaml",
        filename: "deploy_config.yaml",
        tags: ["Config", "config", " C++ "],
      }),
    );
    assert.equal(created.status, 201);
    snippet = (await created.json()) as EntryDetailDto;
    assert.equal(
      snippet.code,
      "line before\nroot: [still, editable\nkey_%: foo_bar\npath: C:\\temp\nline after",
    );
    assert.deepEqual(snippet.tags, ["C++", "Config"]);
    assert.equal(snippet.version, 1);

    const snippetIndex = await entryCollectionRoute.GET(
      new Request("http://localhost/api/entries?kind=snippet&limit=100"),
    );
    assert.equal(snippetIndex.status, 200);
    const snippetPage = (await snippetIndex.json()) as PaginatedDto<EntryDetailDto>;
    assert.deepEqual(snippetPage.items.map(({ id }) => id), [snippet.id]);

    for (const query of ["C++", "foo_bar", "key_%", "deploy_config.yaml", "\\"]) {
      const response = await searchRoute.GET(
        new Request(`http://localhost/api/search?q=${encodeURIComponent(query)}&limit=1`),
      );
      assert.equal(response.status, 200);
      const page = (await response.json()) as SearchResultsDto;
      const item = page.items[0];
      assert.equal(item?.id, snippet.id);
      assert.equal(page.limit, 1);
      assert.equal(page.offset, 0);
      assert.ok(item);
      assert.equal(Object.hasOwn(item, "notesMd"), false);
      assert.equal(Object.hasOwn(item, "code"), false);
      assert.equal(Object.hasOwn(item, "score"), false);
      assert.ok(
        [
          ...item.match.title,
          ...item.match.tags.flatMap(({ parts }) => parts),
          ...item.match.snippet.parts,
        ].some(({ highlighted }) => highlighted),
      );
      if (query === "foo_bar") {
        const snippetText = item.match.snippet.parts.map(({ text }) => text).join("");
        assert.equal(item.match.snippet.field, "code");
        assert.equal(item.match.matchedFields.includes("code"), true);
        assert.equal(snippetText.split("\n").length, 3);
        assert.match(snippetText, /root: \[still, editable\nkey_%: foo_bar\npath: C:\\temp/);
      }
    }

    const filteredResponse = await searchRoute.GET(
      new Request(
        "http://localhost/api/search?q=foo_bar&folderId=1&scope=direct&kind=snippet&tag=config&limit=1&offset=1",
      ),
    );
    assert.equal(filteredResponse.status, 200);
    const filteredPage = (await filteredResponse.json()) as SearchResultsDto;
    assert.equal(filteredPage.total, 1);
    assert.equal(filteredPage.items.length, 0);
    assert.equal(filteredPage.limit, 1);
    assert.equal(filteredPage.offset, 1);
  });

  await t.test("wikilink detail, title, and backlink routes expose the link index", async () => {
    const targetResponse = await entryCollectionRoute.POST(
      multipartRequest("http://localhost/api/entries", {
        folderId: 1,
        kind: "knowledge",
        title: "HTTP wikilink target",
      }),
    );
    const target = (await targetResponse.json()) as EntryDetailDto;
    const sourceResponse = await entryCollectionRoute.POST(
      multipartRequest("http://localhost/api/entries", {
        folderId: 1,
        kind: "snippet",
        title: "HTTP wikilink source",
        notesMd: "[[HTTP wikilink target]] and [[HTTP missing target]]",
        code: "const linked = true;",
        language: "typescript",
      }),
    );
    const source = (await sourceResponse.json()) as EntryDetailDto;
    assert.deepEqual(source.links, [
      {
        titleKey: "http missing target",
        targetId: null,
        targetKind: null,
      },
      {
        titleKey: "http wikilink target",
        targetId: target.id,
        targetKind: "knowledge",
      },
    ]);

    const detailResponse = await entryItemRoute.GET(
      new Request(`http://localhost/api/entries/${source.id}`),
      routeContext(source.id),
    );
    assert.equal(detailResponse.status, 200);
    assert.deepEqual((await detailResponse.json() as EntryDetailDto).links, source.links);

    const titlesResponse = await entryTitlesRoute.GET(
      new Request("http://localhost/api/entries/titles?q=http%20wikilink&limit=20"),
    );
    assert.equal(titlesResponse.status, 200);
    const titles = (await titlesResponse.json()) as EntryTitleDto[];
    assert.deepEqual(
      titles.map(({ id, kind, title }) => ({ id, kind, title })),
      [
        { id: source.id, kind: "snippet", title: source.title },
        { id: target.id, kind: "knowledge", title: target.title },
      ],
    );
    const invalidLimit = await entryTitlesRoute.GET(
      new Request("http://localhost/api/entries/titles?limit=101"),
    );
    assert.equal(invalidLimit.status, 400);

    const backlinksResponse = await entryBacklinksRoute.GET(
      new Request(`http://localhost/api/entries/${target.id}/backlinks`),
      routeContext(target.id),
    );
    assert.equal(backlinksResponse.status, 200);
    assert.deepEqual(await backlinksResponse.json(), [
      {
        id: source.id,
        folderId: source.folderId,
        kind: source.kind,
        title: source.title,
      } satisfies EntryBacklinkDto,
    ]);
    const missingBacklinks = await entryBacklinksRoute.GET(
      new Request("http://localhost/api/entries/999999/backlinks"),
      routeContext(999999),
    );
    assert.equal(missingBacklinks.status, 404);
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

  await t.test("delete permanently removes entries without creating trash records", async () => {
    const deletedKnowledge = await entryItemRoute.DELETE(
      jsonRequest(
        `http://localhost/api/entries/${childPage.id}`,
        { expectedVersion: childPage.version },
        "DELETE",
      ),
      routeContext(childPage.id),
    );
    assert.equal(deletedKnowledge.status, 204);

    const deleted = await entryItemRoute.DELETE(
      jsonRequest(
        `http://localhost/api/entries/${snippet.id}`,
        { expectedVersion: snippet.version },
        "DELETE",
      ),
      routeContext(snippet.id),
    );
    assert.equal(deleted.status, 204);

    const missingKnowledge = await entryItemRoute.GET(
      new Request(`http://localhost/api/entries/${childPage.id}`),
      routeContext(childPage.id),
    );
    assert.equal(missingKnowledge.status, 404);
    const missingSnippet = await entryItemRoute.GET(
      new Request(`http://localhost/api/entries/${snippet.id}`),
      routeContext(snippet.id),
    );
    assert.equal(missingSnippet.status, 404);
    assert.equal(
      (sqlite.prepare("SELECT count(*) FROM trash_entry").pluck().get() as number),
      0,
    );
  });
});

function multipartRequest(
  url: string,
  payload: Record<string, unknown>,
  headers: Record<string, string> = {},
): Request {
  const form = new FormData();
  form.set("payload", JSON.stringify(payload));
  return new Request(url, { method: "POST", headers, body: form });
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
