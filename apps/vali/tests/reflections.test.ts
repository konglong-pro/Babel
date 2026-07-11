import assert from "node:assert/strict";
import test from "node:test";

import { openDatabase } from "../src/lib/db/client";
import { NotFoundError, ValidationError } from "../src/lib/vali/errors";
import { createValiVault } from "../src/lib/vali/module";

test("saving and getting a reflection preserves exact Markdown", () => {
  const database = openDatabase(":memory:");

  try {
    const vault = createValiVault(database);
    const content = "# Daily reflection\n\n- Keep trailing newlines.\n\n";

    const saved = vault.reflections.save("2026-07-10", content);

    assert.deepEqual(saved, { date: "2026-07-10", content });
    assert.deepEqual(vault.reflections.get("2026-07-10"), saved);
  } finally {
    database.close();
  }
});

test("saving an existing reflection overwrites its content", () => {
  const database = openDatabase(":memory:");

  try {
    const vault = createValiVault(database);
    vault.reflections.save("2026-07-10", "First draft");

    const overwritten = vault.reflections.save("2026-07-10", "Second draft\n");

    assert.deepEqual(overwritten, { date: "2026-07-10", content: "Second draft\n" });
    assert.deepEqual(vault.reflections.get("2026-07-10"), overwritten);
  } finally {
    database.close();
  }
});

test("an empty reflection remains listed", () => {
  const database = openDatabase(":memory:");

  try {
    const vault = createValiVault(database);
    vault.reflections.save("2026-07-10", "First draft");

    vault.reflections.save("2026-07-10", "");

    assert.deepEqual(vault.reflections.listDates(), ["2026-07-10"]);
    assert.equal(vault.reflections.get("2026-07-10").content, "");
  } finally {
    database.close();
  }
});

test("reflection dates are listed in descending order", () => {
  const database = openDatabase(":memory:");

  try {
    const vault = createValiVault(database);
    vault.reflections.save("2026-07-09", "Earlier");
    vault.reflections.save("2026-07-11", "Later");
    vault.reflections.save("2026-07-10", "Middle");

    assert.deepEqual(vault.reflections.listDates(), [
      "2026-07-11",
      "2026-07-10",
      "2026-07-09",
    ]);
  } finally {
    database.close();
  }
});

test("reflection listing ignores invalid persisted dates", () => {
  const database = openDatabase(":memory:");

  try {
    const vault = createValiVault(database);
    database.prepare("INSERT INTO reflection (date, content) VALUES (?, ?)").run(
      "2026-02-30",
      "ignore me",
    );
    vault.reflections.save("2026-07-10", "keep me");

    assert.deepEqual(vault.reflections.listDates(), ["2026-07-10"]);
  } finally {
    database.close();
  }
});

test("a reflection date with the wrong format returns a 400 domain error", () => {
  const database = openDatabase(":memory:");

  try {
    const vault = createValiVault(database);

    assert.throws(
      () => vault.reflections.save("2026-7-10", "invalid"),
      (error) => {
        assert.ok(error instanceof ValidationError);
        assert.equal(error.statusCode, 400);
        assert.equal(error.message, "Reflection date must use YYYY-MM-DD");
        return true;
      },
    );
  } finally {
    database.close();
  }
});

test("an impossible reflection calendar date returns a 400 domain error", () => {
  const database = openDatabase(":memory:");

  try {
    const vault = createValiVault(database);

    assert.throws(
      () => vault.reflections.save("2026-02-30", "invalid"),
      (error) => {
        assert.ok(error instanceof ValidationError);
        assert.equal(error.statusCode, 400);
        assert.equal(error.message, "Reflection date must be a valid calendar date");
        return true;
      },
    );
  } finally {
    database.close();
  }
});

test("getting a missing reflection returns a 404 domain error", () => {
  const database = openDatabase(":memory:");

  try {
    const vault = createValiVault(database);

    assert.throws(
      () => vault.reflections.get("2026-07-11"),
      (error) => {
        assert.ok(error instanceof NotFoundError);
        assert.equal(error.statusCode, 404);
        assert.equal(error.message, "Reflection not found: 2026-07-11");
        return true;
      },
    );
  } finally {
    database.close();
  }
});

test("saving non-string reflection content returns a 400 domain error", () => {
  const database = openDatabase(":memory:");

  try {
    const vault = createValiVault(database);

    assert.throws(
      () => vault.reflections.save("2026-07-10", null as unknown as string),
      (error) => {
        assert.ok(error instanceof ValidationError);
        assert.equal(error.statusCode, 400);
        assert.equal(error.message, "Reflection content must be a string");
        return true;
      },
    );
  } finally {
    database.close();
  }
});
