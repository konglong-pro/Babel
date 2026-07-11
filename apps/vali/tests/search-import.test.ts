import assert from "node:assert/strict";
import test from "node:test";

import { openDatabase } from "../src/lib/db/client";
import { NotFoundError } from "../src/lib/vali/errors";
import { createValiVault } from "../src/lib/vali/module";

test("search applies all six ranks before the case-normalized title tie-break", () => {
  const database = openDatabase(":memory:");

  try {
    const vault = createValiVault(database);
    const exactTitle = vault.entries.create({ title: "Alpha", categoryId: "cat_watchlist" });
    vault.entries.create({
      title: "Alias Exact",
      aliases: ["ALPHA"],
      categoryId: "cat_watchlist",
    });
    vault.entries.create({ title: "Alphabet", categoryId: "cat_watchlist" });
    vault.entries.create({ title: "Alpha Beta", categoryId: "cat_watchlist" });
    vault.entries.create({
      title: "Alias Prefix",
      aliases: ["Alphabet Soup"],
      categoryId: "cat_watchlist",
    });
    vault.entries.create({ title: "The Alpha Company", categoryId: "cat_watchlist" });
    vault.entries.create({
      title: "Alias Contains",
      aliases: ["The Alpha Alias"],
      categoryId: "cat_watchlist",
    });

    const results = vault.entries.search("  aLpHa  ");

    assert.deepEqual(
      results.map((result) => [result.title, result.rank]),
      [
        ["Alpha", 0],
        ["Alias Exact", 1],
        ["Alpha Beta", 2],
        ["Alphabet", 2],
        ["Alias Prefix", 3],
        ["The Alpha Company", 4],
        ["Alias Contains", 5],
      ],
    );
    assert.deepEqual(results[0], {
      id: exactTitle.id,
      title: "Alpha",
      aliases: [],
      categoryId: "cat_watchlist",
      categoryName: "Watchlist",
      updatedAt: exactTitle.updatedAt,
      rank: 0,
    });
  } finally {
    database.close();
  }
});

test("blank and unmatched search queries return no results", () => {
  const database = openDatabase(":memory:");

  try {
    const vault = createValiVault(database);
    vault.entries.create({ title: "Apple", aliases: ["AAPL"], categoryId: "cat_watchlist" });

    assert.deepEqual(vault.entries.search("   "), []);
    assert.deepEqual(vault.entries.search("missing"), []);
  } finally {
    database.close();
  }
});

test("search uses Python-compatible Unicode case folding", () => {
  const database = openDatabase(":memory:");

  try {
    const vault = createValiVault(database);
    vault.entries.create({
      title: "Straße",
      aliases: ["Maße"],
      categoryId: "cat_watchlist",
    });

    assert.equal(vault.entries.search("strasse")[0]?.title, "Straße");
    assert.equal(vault.entries.search("masse")[0]?.title, "Straße");
  } finally {
    database.close();
  }
});

test("title import trims items and reports exact conflicts in encounter order", () => {
  const database = openDatabase(":memory:");

  try {
    const vault = createValiVault(database);

    const result = vault.entries.importTitles("cat_watchlist", [
      "  Apple  ",
      "",
      "   ",
      "Microsoft",
      "Apple",
      "apple",
      "  Tesla  ",
    ]);

    assert.deepEqual(result, {
      created: ["Apple", "Microsoft", "apple", "Tesla"],
      skipped: ["Apple"],
    });
    assert.deepEqual(
      vault.entries.list("cat_watchlist").map((entry) => entry.title),
      ["Apple", "Microsoft", "apple", "Tesla"],
    );
  } finally {
    database.close();
  }
});

test("title import rejects a missing category before creating entries", () => {
  const database = openDatabase(":memory:");

  try {
    const vault = createValiVault(database);

    assert.throws(
      () => vault.entries.importTitles("cat_missing", ["Apple", "Microsoft"]),
      (error) => {
        assert.ok(error instanceof NotFoundError);
        assert.equal(error.statusCode, 404);
        assert.equal(error.message, "Category not found: cat_missing");
        return true;
      },
    );
    assert.deepEqual(vault.entries.list(), []);
  } finally {
    database.close();
  }
});
