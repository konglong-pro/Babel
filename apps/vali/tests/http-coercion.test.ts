import assert from "node:assert/strict";
import test from "node:test";

import type { Category, Entry, ImportResult } from "../src/lib/vali/types";

test("Next routes preserve Python JSON scalar string conversion", async () => {
  process.env.VALI_DATABASE_PATH = ":memory:";
  const [categories, categoryById, entries, importer] = await Promise.all([
    import("../src/app/api/categories/route"),
    import("../src/app/api/categories/[id]/route"),
    import("../src/app/api/entries/route"),
    import("../src/app/api/import/route"),
  ]);

  const noneCategory = await expectJson<Category>(
    categories.POST(apiRequest("/api/categories", { name: null })),
    201,
  );
  const trueCategory = await expectJson<Category>(
    categories.POST(apiRequest("/api/categories", { name: true })),
    201,
  );
  const falseCategory = await expectJson<Category>(
    categories.POST(apiRequest("/api/categories", { name: false })),
    201,
  );
  assert.deepEqual(
    [noneCategory.name, trueCategory.name, falseCategory.name],
    ["None", "True", "False"],
  );

  const scalarEntry = await expectJson<Entry>(
    entries.POST(
      apiRequest("/api/entries", {
        title: true,
        aliases: [null, false],
        categoryId: "cat_watchlist",
      }),
    ),
    201,
  );
  assert.equal(scalarEntry.title, "True");
  assert.deepEqual(scalarEntry.aliases, ["None", "False"]);

  assert.deepEqual(
    await expectJson<ImportResult>(
      importer.POST(
        apiRequest("/api/import", {
          categoryId: "cat_owned",
          items: [null, true, false],
        }),
      ),
      201,
    ),
    { created: ["None", "True", "False"], skipped: [] },
  );

  const trueOrder = await expectJson<Category>(
    categoryById.PATCH(
      apiRequest(`/api/categories/${noneCategory.id}`, { order: true }, "PATCH"),
      params({ id: noneCategory.id }),
    ),
    200,
  );
  const falseOrder = await expectJson<Category>(
    categoryById.PATCH(
      apiRequest(`/api/categories/${noneCategory.id}`, { order: false }, "PATCH"),
      params({ id: noneCategory.id }),
    ),
    200,
  );
  const stringOrder = await expectJson<Category>(
    categoryById.PATCH(
      apiRequest(`/api/categories/${noneCategory.id}`, { order: "  +7  " }, "PATCH"),
      params({ id: noneCategory.id }),
    ),
    200,
  );
  assert.deepEqual([trueOrder.order, falseOrder.order, stringOrder.order], [1, 0, 7]);

  for (const [value, typeName] of [
    [null, "NoneType"],
    [[], "list"],
    [{}, "dict"],
  ] as const) {
    await expectError(
      categoryById.PATCH(
        apiRequest(`/api/categories/${noneCategory.id}`, { order: value }, "PATCH"),
        params({ id: noneCategory.id }),
      ),
      500,
      `int() argument must be a string, a bytes-like object or a real number, not '${typeName}'`,
    );
  }
});

function apiRequest(path: string, body: unknown, method = "POST"): Request {
  return new Request(`http://vali.test${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function params<T extends Record<string, string>>(value: T): { params: Promise<T> } {
  return { params: Promise.resolve(value) };
}

async function expectJson<T>(
  responseOrPromise: Response | Promise<Response>,
  status: number,
): Promise<T> {
  const response = await responseOrPromise;
  const payload = (await response.json()) as T;
  assert.equal(response.status, status, JSON.stringify(payload));
  return payload;
}

async function expectError(
  responseOrPromise: Response | Promise<Response>,
  status: number,
  message: string,
): Promise<void> {
  assert.deepEqual(await expectJson(responseOrPromise, status), { error: message });
}
