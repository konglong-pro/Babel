import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import Database from "better-sqlite3";

import { checkpointDatabase } from "../scripts/checkpoint-database";
import { exportVault } from "../scripts/export-vault";
import { importLegacyVault } from "../scripts/import-legacy-vault";
import { migrateDatabase } from "../scripts/migrate";
import { openDatabase } from "../src/lib/db/client";
import { assertVaultSnapshotsEqual } from "../src/lib/exchange/audit";
import { readDatabaseSnapshot } from "../src/lib/exchange/database";
import { readLegacyVault } from "../src/lib/exchange/legacy-reader";
import { writeLegacyVault } from "../src/lib/exchange/markdown-writer";
import type { VaultSnapshot } from "../src/lib/exchange/types";

test("legacy import dry-run validates without creating database or output files", async () => {
  const root = await createWorkspace();
  try {
    const paths = scriptPaths(root);
    const result = await importLegacyVault({ ...paths, dryRun: true });

    assert.equal(result.status, "validated");
    assert.equal(result.validation.equal, true);
    await assertMissing(paths.target);
    await assertMissing(paths.export);
    await assertMissing(paths.report);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("legacy import restores, audits, exports, re-reads, and reports", async () => {
  const root = await createWorkspace();
  try {
    const paths = scriptPaths(root);
    const result = await importLegacyVault(paths);

    assert.equal(result.status, "completed");
    assert.equal(result.audits.sourceToDatabase.equal, true);
    assert.equal(result.audits.sourceToExport.equal, true);
    assert.equal(
      (JSON.parse(await readFile(paths.report, "utf8")) as { status: string }).status,
      "completed",
    );

    const source = await readLegacyVault(paths.source);
    assertVaultSnapshotsEqual(source, await readLegacyVault(paths.export));
    const database = openDatabase(paths.target);
    try {
      assertVaultSnapshotsEqual(source, readDatabaseSnapshot(database));
    } finally {
      database.close();
    }

    const secondExport = path.join(root, "second-export");
    await assert.rejects(
      importLegacyVault({ ...paths, export: secondExport }),
      /Target database is not empty/,
    );
    await assertMissing(secondExport);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("standalone export rejects stale destinations", async () => {
  const root = await createWorkspace();
  try {
    const paths = scriptPaths(root);
    await importLegacyVault(paths);
    const staleDestination = path.join(root, "stale-export");
    await mkdir(staleDestination);
    await writeFile(path.join(staleDestination, "stale.md"), "stale", "utf8");

    await assert.rejects(
      exportVault({ database: paths.target, destination: staleDestination }),
      /Export destination is not empty/,
    );
    assert.equal(
      await readFile(path.join(staleDestination, "stale.md"), "utf8"),
      "stale",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("migration closes the database and checkpoint uses SQLite backup", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "vali-script-checkpoint-"));
  try {
    const databasePath = path.join(root, "nested", "sqlite.db");
    const checkpointPath = path.join(root, "backups", "explicit.db");
    const migrated = migrateDatabase(databasePath);
    assert.equal(migrated.database, path.resolve(databasePath));

    const checkpoint = await checkpointDatabase(databasePath, checkpointPath);
    assert.equal(checkpoint.destination, path.resolve(checkpointPath));
    assert.equal(checkpoint.remainingPages, 0);
    await access(checkpointPath);

    const restored = openDatabase(checkpointPath);
    restored.close();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("checkpoint preserves an unmigrated source database", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "vali-script-checkpoint-readonly-"));
  try {
    const databasePath = path.join(root, "source.db");
    const checkpointPath = path.join(root, "checkpoint.db");
    const source = new Database(databasePath);
    source.exec("CREATE TABLE sentinel (value TEXT NOT NULL)");
    source.prepare("INSERT INTO sentinel (value) VALUES (?)").run("unchanged");
    const schemaBefore = readSchema(source);
    const journalModeBefore = source.pragma("journal_mode", { simple: true });
    source.close();

    await checkpointDatabase(databasePath, checkpointPath);

    const reopenedSource = new Database(databasePath, { readonly: true });
    const checkpoint = new Database(checkpointPath, { readonly: true });
    try {
      assert.deepEqual(readSchema(reopenedSource), schemaBefore);
      assert.equal(
        reopenedSource.pragma("journal_mode", { simple: true }),
        journalModeBefore,
      );
      assert.equal(
        reopenedSource.prepare("SELECT value FROM sentinel").pluck().get(),
        "unchanged",
      );
      assert.deepEqual(readSchema(checkpoint), schemaBefore);
      assert.equal(
        checkpoint.prepare("SELECT value FROM sentinel").pluck().get(),
        "unchanged",
      );
    } finally {
      checkpoint.close();
      reopenedSource.close();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

async function createWorkspace(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "vali-script-test-"));
  await writeLegacyVault(snapshot, path.join(root, "source"));
  return root;
}

function scriptPaths(root: string): {
  source: string;
  target: string;
  export: string;
  report: string;
} {
  return {
    source: path.join(root, "source"),
    target: path.join(root, "database", "sqlite.db"),
    export: path.join(root, "export"),
    report: path.join(root, "reports", "migration.json"),
  };
}

async function assertMissing(filename: string): Promise<void> {
  await assert.rejects(access(filename), (error) => {
    assert.equal((error as NodeJS.ErrnoException).code, "ENOENT");
    return true;
  });
}

function readSchema(database: Database.Database): unknown[] {
  return database
    .prepare(
      "SELECT type, name, tbl_name, sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name",
    )
    .all();
}

const snapshot: VaultSnapshot = {
  config: {
    name: "Vali 測試",
    version: 1,
    createdAt: "2026-07-11T01:02:03Z",
    defaultCategoryId: "cat_watchlist",
  },
  categories: [
    {
      id: "cat_watchlist",
      name: "觀察清單",
      order: 1,
      content: "# 說明\n\n保留尾端換行。\n\n",
      createdAt: "2026-07-11T01:02:03Z",
      updatedAt: "2026-07-11T02:03:04Z",
    },
  ],
  entries: [
    {
      id: "ent_unicode",
      title: "台積電",
      aliases: ["TSM", "2330"],
      categoryId: "cat_watchlist",
      order: 4,
      content: "  exact Markdown\n\n中文正文\n",
      createdAt: "2026-07-11T03:04:05Z",
      updatedAt: "2026-07-11T06:07:08Z",
    },
  ],
  reflections: [{ date: "2026-07-11", content: "# 今日\n\n保留。\n" }],
  trash: [],
};
