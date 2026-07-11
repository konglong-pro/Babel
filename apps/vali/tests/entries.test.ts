import assert from "node:assert/strict";
import test from "node:test";

import { openDatabase } from "../src/lib/db/client";
import { ConflictError, NotFoundError, ValidationError } from "../src/lib/vali/errors";
import { createValiVault } from "../src/lib/vali/module";
import type { CreateEntryInput } from "../src/lib/vali/types";

test("creating an entry assigns the default template and generated metadata", () => {
  const database = openDatabase(":memory:");

  try {
    const vault = createValiVault(database);

    const created = vault.entries.create({
      title: "Apple",
      categoryId: "cat_watchlist",
    });

    assert.match(created.id, /^ent_[a-z0-9]{6}$/);
    assert.equal(created.title, "Apple");
    assert.deepEqual(created.aliases, []);
    assert.equal(created.categoryId, "cat_watchlist");
    assert.equal(created.order, 1);
    assert.equal(
      created.content,
      "# Business Notes\n\n# Bull Case\n\n# Bear Case\n\n# Current Take\n",
    );
    assert.match(created.createdAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    assert.equal(created.updatedAt, created.createdAt);
  } finally {
    database.close();
  }
});

test("creating an entry trims its title", () => {
  const database = openDatabase(":memory:");

  try {
    const vault = createValiVault(database);

    const created = vault.entries.create({
      title: "  Apple  ",
      categoryId: "cat_watchlist",
    });

    assert.equal(created.title, "Apple");
  } finally {
    database.close();
  }
});

test("creating an entry rejects a blank title", () => {
  const database = openDatabase(":memory:");

  try {
    const vault = createValiVault(database);

    assert.throws(
      () => vault.entries.create({ title: "   ", categoryId: "cat_watchlist" }),
      (error) => {
        assert.ok(error instanceof ValidationError);
        assert.equal(error.statusCode, 400);
        assert.equal(error.message, "Entry title is required");
        return true;
      },
    );
  } finally {
    database.close();
  }
});

test("entry aliases are trimmed, ordered, exactly deduplicated, and case-sensitive", () => {
  const database = openDatabase(":memory:");

  try {
    const vault = createValiVault(database);

    const created = vault.entries.create({
      title: "Apple",
      aliases: ["  AAPL  ", "Apple", "", "AAPL", "aapl", "  Apple  ", "   "],
      categoryId: "cat_watchlist",
    });

    assert.deepEqual(created.aliases, ["AAPL", "Apple", "aapl"]);
  } finally {
    database.close();
  }
});

test("entry aliases must be supplied as a list", () => {
  const database = openDatabase(":memory:");

  try {
    const vault = createValiVault(database);
    const input = {
      title: "Apple",
      aliases: "AAPL",
      categoryId: "cat_watchlist",
    } as unknown as CreateEntryInput;

    assert.throws(
      () => vault.entries.create(input),
      (error) => {
        assert.ok(error instanceof ValidationError);
        assert.equal(error.statusCode, 400);
        assert.equal(error.message, "Entry aliases must be a list");
        return true;
      },
    );
  } finally {
    database.close();
  }
});

test("getting an entry returns its persisted aliases in position order", () => {
  const database = openDatabase(":memory:");

  try {
    const vault = createValiVault(database);
    const created = vault.entries.create({
      title: "Apple",
      aliases: ["AAPL", "苹果"],
      categoryId: "cat_watchlist",
    });

    assert.deepEqual(vault.entries.get(created.id), created);
  } finally {
    database.close();
  }
});

test("getting a missing entry returns a 404 domain error", () => {
  const database = openDatabase(":memory:");

  try {
    const vault = createValiVault(database);

    assert.throws(
      () => vault.entries.get("ent_missing"),
      (error) => {
        assert.ok(error instanceof NotFoundError);
        assert.equal(error.statusCode, 404);
        assert.equal(error.message, "Entry not found: ent_missing");
        return true;
      },
    );
  } finally {
    database.close();
  }
});

test("listing entries can filter by category and preserves entry order", () => {
  const database = openDatabase(":memory:");

  try {
    const vault = createValiVault(database);
    const apple = vault.entries.create({
      title: "Apple",
      aliases: ["AAPL"],
      categoryId: "cat_watchlist",
    });
    const microsoft = vault.entries.create({
      title: "Microsoft",
      categoryId: "cat_watchlist",
    });
    vault.entries.create({ title: "Berkshire", categoryId: "cat_owned" });

    assert.deepEqual(vault.entries.list("cat_watchlist"), [apple, microsoft]);
    assert.equal(vault.entries.list().length, 3);
  } finally {
    database.close();
  }
});

test("listing a missing category returns a 404 domain error", () => {
  const database = openDatabase(":memory:");

  try {
    const vault = createValiVault(database);

    assert.throws(
      () => vault.entries.list("cat_missing"),
      (error) => {
        assert.ok(error instanceof NotFoundError);
        assert.equal(error.statusCode, 404);
        assert.equal(error.message, "Category not found: cat_missing");
        return true;
      },
    );
  } finally {
    database.close();
  }
});

test("entry titles are exactly unique only within the same category", () => {
  const database = openDatabase(":memory:");

  try {
    const vault = createValiVault(database);
    vault.entries.create({ title: "Apple", categoryId: "cat_watchlist" });

    assert.throws(
      () => vault.entries.create({ title: "  Apple  ", categoryId: "cat_watchlist" }),
      (error) => {
        assert.ok(error instanceof ConflictError);
        assert.equal(error.statusCode, 409);
        assert.equal(error.message, "Entry already exists in this category: Apple");
        return true;
      },
    );
    assert.equal(
      vault.entries.create({ title: "apple", categoryId: "cat_watchlist" }).title,
      "apple",
    );
    assert.equal(
      vault.entries.create({ title: "Apple", categoryId: "cat_owned" }).categoryId,
      "cat_owned",
    );
  } finally {
    database.close();
  }
});

test("creating an entry in a missing category returns a 404 domain error", () => {
  const database = openDatabase(":memory:");

  try {
    const vault = createValiVault(database);

    assert.throws(
      () => vault.entries.create({ title: "Apple", categoryId: "cat_missing" }),
      (error) => {
        assert.ok(error instanceof NotFoundError);
        assert.equal(error.statusCode, 404);
        assert.equal(error.message, "Category not found: cat_missing");
        return true;
      },
    );
  } finally {
    database.close();
  }
});

test("updating an entry can rename it and replace aliases and exact Markdown content", () => {
  const database = openDatabase(":memory:");

  try {
    const vault = createValiVault(database);
    const created = vault.entries.create({
      title: "Apple",
      aliases: ["AAPL"],
      categoryId: "cat_watchlist",
    });

    const updated = vault.entries.update(created.id, {
      title: "  Apple Inc.  ",
      aliases: ["  NASDAQ:AAPL  ", "AAPL", "NASDAQ:AAPL", "aapl"],
      content: "# Updated thesis\n\nKeep every newline.\n\n",
    });

    assert.deepEqual(updated, {
      ...created,
      title: "Apple Inc.",
      aliases: ["NASDAQ:AAPL", "AAPL", "aapl"],
      content: "# Updated thesis\n\nKeep every newline.\n\n",
      updatedAt: updated.updatedAt,
    });
    assert.match(updated.updatedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    assert.deepEqual(vault.entries.get(created.id), updated);
  } finally {
    database.close();
  }
});

test("updating a missing entry returns a 404 domain error", () => {
  const database = openDatabase(":memory:");

  try {
    const vault = createValiVault(database);

    assert.throws(
      () => vault.entries.update("ent_missing", { content: "" }),
      (error) => {
        assert.ok(error instanceof NotFoundError);
        assert.equal(error.statusCode, 404);
        assert.equal(error.message, "Entry not found: ent_missing");
        return true;
      },
    );
  } finally {
    database.close();
  }
});

test("updating an entry rejects an exact title conflict in its destination category", () => {
  const database = openDatabase(":memory:");

  try {
    const vault = createValiVault(database);
    vault.entries.create({ title: "Apple", categoryId: "cat_watchlist" });
    const microsoft = vault.entries.create({
      title: "Microsoft",
      categoryId: "cat_watchlist",
    });

    assert.throws(
      () => vault.entries.update(microsoft.id, { title: " Apple " }),
      (error) => {
        assert.ok(error instanceof ConflictError);
        assert.equal(error.statusCode, 409);
        assert.equal(error.message, "Entry already exists in this category: Apple");
        return true;
      },
    );
  } finally {
    database.close();
  }
});

test("moving an entry retains its order unless an explicit order is supplied", () => {
  const database = openDatabase(":memory:");

  try {
    const vault = createValiVault(database);
    const apple = vault.entries.create({ title: "Apple", categoryId: "cat_watchlist" });
    const microsoft = vault.entries.create({
      title: "Microsoft",
      categoryId: "cat_watchlist",
    });

    const retained = vault.entries.update(apple.id, { categoryId: "cat_owned" });
    const explicit = vault.entries.update(microsoft.id, {
      categoryId: "cat_owned",
      order: 7,
    });

    assert.equal(retained.categoryId, "cat_owned");
    assert.equal(retained.order, 1);
    assert.equal(explicit.categoryId, "cat_owned");
    assert.equal(explicit.order, 7);
  } finally {
    database.close();
  }
});

test("moving an entry to a missing category returns a 404 domain error", () => {
  const database = openDatabase(":memory:");

  try {
    const vault = createValiVault(database);
    const created = vault.entries.create({ title: "Apple", categoryId: "cat_watchlist" });

    assert.throws(
      () => vault.entries.update(created.id, { categoryId: "cat_missing" }),
      (error) => {
        assert.ok(error instanceof NotFoundError);
        assert.equal(error.statusCode, 404);
        assert.equal(error.message, "Category not found: cat_missing");
        return true;
      },
    );
  } finally {
    database.close();
  }
});

test("listing entries sorts by order and then case-folded title", () => {
  const database = openDatabase(":memory:");

  try {
    const vault = createValiVault(database);
    const zebra = vault.entries.create({ title: "Zebra", categoryId: "cat_watchlist" });
    const alpha = vault.entries.create({ title: "alpha", categoryId: "cat_watchlist" });
    const beta = vault.entries.create({ title: "Beta", categoryId: "cat_watchlist" });
    for (const item of [zebra, alpha, beta]) {
      vault.entries.update(item.id, { order: 1 });
    }

    assert.deepEqual(
      vault.entries.list("cat_watchlist").map((item) => item.title),
      ["alpha", "Beta", "Zebra"],
    );
  } finally {
    database.close();
  }
});

test("entry-list ties preserve creation order", () => {
  const database = openDatabase(":memory:");

  try {
    const vault = createValiVault(database);
    const titles = ["Tie", "tIe", "tiE", "TIE", "tie", "Tie", "tIE", "TIe"];
    const created = titles.map((title, index) =>
      vault.entries.create({
        title,
        categoryId: index % 2 === 0 ? "cat_watchlist" : "cat_owned",
      }),
    );
    for (const item of created) {
      vault.entries.update(item.id, { order: 1 });
    }

    assert.deepEqual(
      vault.entries.list().map((item) => item.id),
      created.map((item) => item.id),
    );
  } finally {
    database.close();
  }
});

test("entry order patches use legacy integer coercion", () => {
  const database = openDatabase(":memory:");

  try {
    const vault = createValiVault(database);
    const created = vault.entries.create({ title: "Apple", categoryId: "cat_watchlist" });

    assert.equal(vault.entries.update(created.id, { order: 7.9 }).order, 7);
  } finally {
    database.close();
  }
});

test("deleting a nonempty category returns a 400 domain error", () => {
  const database = openDatabase(":memory:");

  try {
    const vault = createValiVault(database);
    vault.entries.create({ title: "Apple", categoryId: "cat_owned" });

    assert.throws(
      () => vault.categories.delete("cat_owned"),
      (error) => {
        assert.ok(error instanceof ValidationError);
        assert.equal(error.statusCode, 400);
        assert.equal(error.message, "Category is not empty");
        return true;
      },
    );
    assert.equal(vault.entries.list("cat_owned").length, 1);
  } finally {
    database.close();
  }
});
