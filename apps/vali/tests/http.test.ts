import assert from "node:assert/strict";
import test from "node:test";

import type { Category, Entry, Reflection, SearchResult } from "../src/lib/vali/types";

const NO_BODY = Symbol("no-body");

test("actual Next handlers preserve the legacy contract with isolated SQLite", async () => {
  process.env.VALI_DATABASE_PATH = ":memory:";

  const [categories, categoryById, entries, entryById, search, importer, reflections, reflectionByDate, health] =
    await Promise.all([
      import("../src/app/api/categories/route"),
      import("../src/app/api/categories/[id]/route"),
      import("../src/app/api/entries/route"),
      import("../src/app/api/entries/[id]/route"),
      import("../src/app/api/search/route"),
      import("../src/app/api/import/route"),
      import("../src/app/api/reflections/route"),
      import("../src/app/api/reflections/[date]/route"),
      import("../src/app/api/health/route"),
    ]);

  const defaults = await expectJson<Category[]>(categories.GET(), 200);
  assert.deepEqual(defaults.map(({ id }) => id), ["cat_watchlist", "cat_owned", "cat_avoid"]);
  assert.deepEqual(await expectJson(health.GET(), 200), {
    id: "vali",
    status: "ok",
    schemaVersion: 1,
  });

  const createdCategory = await expectJson<Category>(
    categories.POST(apiRequest("POST", "/api/categories", { name: "Research" })),
    201,
  );
  const patchedCategory = await expectJson<Category>(
    categoryById.PATCH(
      apiRequest("PATCH", `/api/categories/${createdCategory.id}`, {
        name: "Deep Research",
        order: 9,
        content: "# Research\n\nKeep exact Markdown.",
      }),
      params({ id: createdCategory.id }),
    ),
    200,
  );
  assert.equal(patchedCategory.name, "Deep Research");
  assert.equal(patchedCategory.order, 9);
  assert.equal(patchedCategory.content, "# Research\n\nKeep exact Markdown.");
  const truncatedOrderCategory = await expectJson<Category>(
    categoryById.PATCH(
      apiRequest("PATCH", `/api/categories/${createdCategory.id}`, { order: 1.9 }),
      params({ id: createdCategory.id }),
    ),
    200,
  );
  assert.equal(truncatedOrderCategory.order, 1);
  await expectError(
    categoryById.PATCH(
      apiRequest("PATCH", `/api/categories/${createdCategory.id}`, { order: "1.9" }),
      params({ id: createdCategory.id }),
    ),
    400,
    "invalid literal for int() with base 10: '1.9'",
  );
  assert.deepEqual(
    await expectJson(
      categoryById.DELETE(
        apiRequest("DELETE", `/api/categories/${createdCategory.id}`),
        params({ id: createdCategory.id }),
      ),
      200,
    ),
    { ok: true },
  );

  const apple = await expectJson<Entry>(
    entries.POST(
      apiRequest("POST", "/api/entries", {
        title: "Apple",
        aliases: [],
        categoryId: "cat_watchlist",
      }),
    ),
    201,
  );
  assert.deepEqual(
    await expectJson<Entry>(
      entryById.GET(apiRequest("GET", `/api/entries/${apple.id}`), params({ id: apple.id })),
      200,
    ),
    apple,
  );

  const patchedApple = await expectJson<Entry>(
    entryById.PATCH(
      apiRequest("PATCH", `/api/entries/${apple.id}`, {
        aliases: [" AAPL ", "苹果", "AAPL"],
        content: "# 判断\n\n继续观察。",
      }),
      params({ id: apple.id }),
    ),
    200,
  );
  assert.deepEqual(patchedApple.aliases, ["AAPL", "苹果"]);
  assert.equal(patchedApple.content, "# 判断\n\n继续观察。");
  const truncatedEntryOrder = await expectJson<Entry>(
    entryById.PATCH(
      apiRequest("PATCH", `/api/entries/${apple.id}`, { order: 1.9 }),
      params({ id: apple.id }),
    ),
    200,
  );
  assert.equal(truncatedEntryOrder.order, 1);
  await expectError(
    entryById.PATCH(
      apiRequest("PATCH", `/api/entries/${apple.id}`, { order: "1.9" }),
      params({ id: apple.id }),
    ),
    400,
    "invalid literal for int() with base 10: '1.9'",
  );

  const watchlist = await expectJson<Entry[]>(
    entries.GET(apiRequest("GET", "/api/entries?categoryId=cat_watchlist")),
    200,
  );
  assert.equal(watchlist.some(({ id }) => id === apple.id), true);

  assert.deepEqual(
    await expectJson(
      importer.POST(
        apiRequest("POST", "/api/import", {
          categoryId: "cat_watchlist",
          items: ["Microsoft", "Nvidia", "Microsoft"],
        }),
      ),
      201,
    ),
    { created: ["Microsoft", "Nvidia"], skipped: ["Microsoft"] },
  );
  const aliasResults = await expectJson<SearchResult[]>(
    search.GET(apiRequest("GET", "/api/search?q=AAPL")),
    200,
  );
  assert.equal(aliasResults[0]?.title, "Apple");
  assert.equal(aliasResults[0]?.rank, 1);

  await expectError(
    categories.POST(apiRequest("POST", "/api/categories", { name: "   " })),
    400,
    "Category name is required",
  );
  await expectError(
    categories.POST(apiRequest("POST", "/api/categories")),
    400,
    "Category name is required",
  );
  await expectError(
    entryById.GET(apiRequest("GET", "/api/entries/ent_missing"), params({ id: "ent_missing" })),
    404,
    "Entry not found: ent_missing",
  );
  await expectError(
    entries.POST(
      apiRequest("POST", "/api/entries", {
        title: "Apple",
        aliases: [],
        categoryId: "cat_watchlist",
      }),
    ),
    409,
    "Entry already exists in this category: Apple",
  );
  await expectError(
    categories.POST(apiRequest("POST", "/api/categories", [])),
    400,
    "JSON body must be an object",
  );
  await expectError(
    entries.POST(
      apiRequest("POST", "/api/entries", {
        title: "Bad aliases",
        aliases: "not-a-list",
        categoryId: "cat_watchlist",
      }),
    ),
    400,
    "aliases must be a list",
  );
  await expectError(
    entryById.PATCH(
      apiRequest("PATCH", `/api/entries/${apple.id}`, { aliases: "not-a-list" }),
      params({ id: apple.id }),
    ),
    400,
    "Entry aliases must be a list",
  );
  await expectError(
    importer.POST(
      apiRequest("POST", "/api/import", {
        categoryId: "cat_watchlist",
        items: "not-a-list",
      }),
    ),
    400,
    "items must be a list",
  );
  assert.deepEqual(
    await expectJson(
      entryById.DELETE(
        apiRequest("DELETE", `/api/entries/${apple.id}`),
        params({ id: apple.id }),
      ),
      200,
    ),
    { ok: true },
  );
  await expectError(
    entryById.GET(apiRequest("GET", `/api/entries/${apple.id}`), params({ id: apple.id })),
    404,
    `Entry not found: ${apple.id}`,
  );

  const earlier = await expectJson<Reflection>(
    reflectionByDate.PATCH(
      apiRequest("PATCH", "/api/reflections/2026-07-09", { content: "# Earlier" }),
      params({ date: "2026-07-09" }),
    ),
    200,
  );
  const today = await expectJson<Reflection>(
    reflectionByDate.PATCH(
      apiRequest("PATCH", "/api/reflections/2026-07-10", {
        content: "# Today\n\nA useful review.",
      }),
      params({ date: "2026-07-10" }),
    ),
    200,
  );
  assert.deepEqual(earlier, { date: "2026-07-09", content: "# Earlier" });
  assert.deepEqual(await expectJson<string[]>(reflections.GET(), 200), [
    "2026-07-10",
    "2026-07-09",
  ]);
  assert.deepEqual(
    await expectJson<Reflection>(
      reflectionByDate.GET(
        apiRequest("GET", "/api/reflections/2026-07-10"),
        params({ date: "2026-07-10" }),
      ),
      200,
    ),
    today,
  );
  await expectError(
    reflectionByDate.GET(
      apiRequest("GET", "/api/reflections/2026-07-11"),
      params({ date: "2026-07-11" }),
    ),
    404,
    "Reflection not found: 2026-07-11",
  );
  await expectError(
    reflectionByDate.PATCH(
      apiRequest("PATCH", "/api/reflections/2026-02-30", { content: "invalid" }),
      params({ date: "2026-02-30" }),
    ),
    400,
    "Reflection date must be a valid calendar date",
  );
  await expectError(
    reflectionByDate.PATCH(
      apiRequest("PATCH", "/api/reflections/2026-07-10", {}),
      params({ date: "2026-07-10" }),
    ),
    400,
    "Reflection content is required",
  );
  await expectError(
    reflectionByDate.PATCH(
      apiRequest("PATCH", "/api/reflections/2026-07-10", { content: null }),
      params({ date: "2026-07-10" }),
    ),
    400,
    "Reflection content must be a string",
  );
});

function apiRequest(method: string, path: string, body: unknown | typeof NO_BODY = NO_BODY): Request {
  const init: RequestInit = { method };
  if (body !== NO_BODY) {
    init.headers = { "Content-Type": "application/json" };
    init.body = JSON.stringify(body);
  }
  return new Request(`http://vali.test${path}`, init);
}

function params<T extends Record<string, string>>(value: T): { params: Promise<T> } {
  return { params: Promise.resolve(value) };
}

async function expectJson<T = unknown>(
  responseOrPromise: Response | Promise<Response>,
  status: number,
): Promise<T> {
  const response = await responseOrPromise;
  assert.equal(response.status, status);
  return (await response.json()) as T;
}

async function expectError(
  responseOrPromise: Response | Promise<Response>,
  status: number,
  message: string,
): Promise<void> {
  assert.deepEqual(await expectJson(responseOrPromise, status), { error: message });
}
