import assert from "node:assert/strict";
import test from "node:test";

import { openDatabase } from "../src/lib/db/client";
import { ConflictError, NotFoundError, ValidationError } from "../src/lib/vali/errors";
import { createValiVault } from "../src/lib/vali/module";

test("a new vault exposes the three protected default categories", () => {
  const database = openDatabase(":memory:");

  try {
    const vault = createValiVault(database);

    assert.deepEqual(
      vault.categories.list().map(({ id, name, order, content }) => ({
        id,
        name,
        order,
        content,
      })),
      [
        { id: "cat_watchlist", name: "Watchlist", order: 1, content: "" },
        { id: "cat_owned", name: "Owned", order: 2, content: "" },
        { id: "cat_avoid", name: "Avoid", order: 3, content: "" },
      ],
    );
  } finally {
    database.close();
  }
});

test("creating a category trims its name and assigns generated metadata", () => {
  const database = openDatabase(":memory:");

  try {
    const vault = createValiVault(database);

    const created = vault.categories.create({ name: "  AI Sector  " });

    assert.match(created.id, /^cat_[a-z0-9]{6}$/);
    assert.equal(created.name, "AI Sector");
    assert.equal(created.order, 4);
    assert.equal(created.content, "");
    assert.match(created.createdAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    assert.equal(created.updatedAt, created.createdAt);
    assert.deepEqual(vault.categories.list().at(-1), created);
  } finally {
    database.close();
  }
});

test("creating a category rejects a blank name with a 400 domain error", () => {
  const database = openDatabase(":memory:");

  try {
    const vault = createValiVault(database);

    assert.throws(
      () => vault.categories.create({ name: "   " }),
      (error) => {
        assert.ok(error instanceof ValidationError);
        assert.equal(error.statusCode, 400);
        assert.equal(error.message, "Category name is required");
        return true;
      },
    );
  } finally {
    database.close();
  }
});

test("category names are exactly unique", () => {
  const database = openDatabase(":memory:");

  try {
    const vault = createValiVault(database);
    vault.categories.create({ name: "AI Sector" });

    assert.throws(
      () => vault.categories.create({ name: "  AI Sector  " }),
      (error) => {
        assert.ok(error instanceof ConflictError);
        assert.equal(error.statusCode, 409);
        assert.equal(error.message, "Category already exists: AI Sector");
        return true;
      },
    );
    assert.equal(vault.categories.create({ name: "ai sector" }).name, "ai sector");
  } finally {
    database.close();
  }
});

test("updating a category can rename, reorder, and replace its Markdown content", () => {
  const database = openDatabase(":memory:");

  try {
    const vault = createValiVault(database);
    const created = vault.categories.create({ name: "AI Sector" });

    const updated = vault.categories.update(created.id, {
      name: "  Semiconductor Sector  ",
      order: 0,
      content: "# Thesis\n\nKeep exact Markdown.\n",
    });

    assert.deepEqual(updated, {
      ...created,
      name: "Semiconductor Sector",
      order: 0,
      content: "# Thesis\n\nKeep exact Markdown.\n",
      updatedAt: updated.updatedAt,
    });
    assert.match(updated.updatedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    assert.deepEqual(
      vault.categories.list().find((item) => item.id === created.id),
      updated,
    );
  } finally {
    database.close();
  }
});

test("category order patches use legacy integer coercion", () => {
  const database = openDatabase(":memory:");

  try {
    const vault = createValiVault(database);

    assert.equal(vault.categories.update("cat_owned", { order: 2.9 }).order, 2);
  } finally {
    database.close();
  }
});

test("renaming a category rejects a blank name with a 400 domain error", () => {
  const database = openDatabase(":memory:");

  try {
    const vault = createValiVault(database);

    assert.throws(
      () => vault.categories.update("cat_owned", { name: "   " }),
      (error) => {
        assert.ok(error instanceof ValidationError);
        assert.equal(error.statusCode, 400);
        assert.equal(error.message, "Category name is required");
        return true;
      },
    );
  } finally {
    database.close();
  }
});

test("renaming a category rejects an exact duplicate name", () => {
  const database = openDatabase(":memory:");

  try {
    const vault = createValiVault(database);

    assert.throws(
      () => vault.categories.update("cat_owned", { name: " Watchlist " }),
      (error) => {
        assert.ok(error instanceof ConflictError);
        assert.equal(error.statusCode, 409);
        assert.equal(error.message, "Category already exists: Watchlist");
        return true;
      },
    );
  } finally {
    database.close();
  }
});

test("updating a missing category returns a 404 domain error", () => {
  const database = openDatabase(":memory:");

  try {
    const vault = createValiVault(database);

    assert.throws(
      () => vault.categories.update("cat_missing", { content: "" }),
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

test("deleting the configured default category returns a 400 domain error", () => {
  const database = openDatabase(":memory:");

  try {
    const vault = createValiVault(database);

    assert.throws(
      () => vault.categories.delete("cat_watchlist"),
      (error) => {
        assert.ok(error instanceof ValidationError);
        assert.equal(error.statusCode, 400);
        assert.equal(error.message, "Default category cannot be deleted");
        return true;
      },
    );
    assert.ok(vault.categories.list().some((item) => item.id === "cat_watchlist"));
  } finally {
    database.close();
  }
});

test("deleting an empty non-default category removes it", () => {
  const database = openDatabase(":memory:");

  try {
    const vault = createValiVault(database);
    const category = vault.categories.create({ name: "Temporary" });

    vault.categories.delete(category.id);

    assert.equal(
      vault.categories.list().some((item) => item.id === category.id),
      false,
    );
  } finally {
    database.close();
  }
});

test("deleting a missing category returns a 404 domain error", () => {
  const database = openDatabase(":memory:");

  try {
    const vault = createValiVault(database);

    assert.throws(
      () => vault.categories.delete("cat_missing"),
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
