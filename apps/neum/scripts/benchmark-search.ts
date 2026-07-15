import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";

import { migrate } from "drizzle-orm/better-sqlite3/migrator";

const RECORD_COUNT = 10_000;
const CODE_BYTES_PER_ENTRY = 16 * 1024;
const CODE_HIT_COUNT = 200;
const QUERY = "NEUM_BENCHMARK_NEEDLE_CXX";
const PAGE_LIMIT = 50;
const EXPECTED_TOTAL = CODE_HIT_COUNT + 8;
const EXACT_TITLE = QUERY;
const PREFIX_TITLE = `${QUERY} prefix result`;
const CODE_LINE = "const syntheticValue = 42; // deterministic Neum benchmark filler\n";
const BASE_CODE = CODE_LINE
  .repeat(Math.ceil(CODE_BYTES_PER_ENTRY / CODE_LINE.length))
  .slice(0, CODE_BYTES_PER_ENTRY);

type NeedlePosition = "none" | "start" | "middle" | "end";

interface SyntheticEntry {
  title: string;
  notesMd: string;
  code: string;
  language: string;
  filename: string | null;
  tag: "exact" | "partial" | null;
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

async function main(): Promise<void> {
  const previousDatabasePath = process.env.NEUM_DATABASE_PATH;
  const previousUploadDirectory = process.env.NEUM_UPLOAD_DIRECTORY;
  const temporaryDirectory = await mkdtemp(
    path.join(os.tmpdir(), "babel-neum-search-benchmark-"),
  );
  const temporaryDatabasePath = path.join(temporaryDirectory, "sqlite.db");
  let closeDatabase: (() => void) | undefined;

  try {
    process.env.NEUM_DATABASE_PATH = temporaryDatabasePath;
    process.env.NEUM_UPLOAD_DIRECTORY = path.join(temporaryDirectory, "uploads");

    const databaseModule = await import("../src/lib/db/client");
    const database = databaseModule.getNeumDatabase();
    closeDatabase = () => database.sqlite.close();
    if (path.resolve(database.databasePath) !== path.resolve(temporaryDatabasePath)) {
      throw new Error("Search benchmark refused to use a non-temporary database.");
    }

    migrate(database.db, {
      migrationsFolder: path.resolve(import.meta.dirname, "..", "drizzle"),
    });

    const repositories = await import("../src/lib/repositories");
    const folder = database.sqlite
      .prepare("SELECT id FROM folder ORDER BY id ASC LIMIT 1")
      .get() as { id: number } | undefined;
    if (!folder) throw new Error("Search benchmark migration did not seed a folder.");

    assert.equal(Buffer.byteLength(codeWithNeedle("none"), "utf8"), CODE_BYTES_PER_ENTRY);
    assert.equal(Buffer.byteLength(codeWithNeedle("start"), "utf8"), CODE_BYTES_PER_ENTRY);
    assert.equal(Buffer.byteLength(codeWithNeedle("middle"), "utf8"), CODE_BYTES_PER_ENTRY);
    assert.equal(Buffer.byteLength(codeWithNeedle("end"), "utf8"), CODE_BYTES_PER_ENTRY);

    const insertEntry = database.sqlite.prepare(`
      INSERT INTO entry (
        parent_id,
        folder_id,
        kind,
        title,
        notes_md,
        code,
        language,
        filename
      ) VALUES (NULL, ?, 'snippet', ?, ?, ?, ?, ?)
    `);
    const insertTag = database.sqlite.prepare(
      "INSERT INTO tag (name, name_key) VALUES (?, ?)",
    );
    const insertEntryTag = database.sqlite.prepare(
      "INSERT INTO entry_tag (entry_id, tag_id) VALUES (?, ?)",
    );

    const seedEntries = database.sqlite.transaction(() => {
      const exactTagId = Number(
        insertTag.run(QUERY, QUERY.toLowerCase()).lastInsertRowid,
      );
      const partialTag = `topic-${QUERY}-more`;
      const partialTagId = Number(
        insertTag.run(partialTag, partialTag.toLowerCase()).lastInsertRowid,
      );

      for (let index = 0; index < RECORD_COUNT; index += 1) {
        const entry = createSyntheticEntry(index);
        const result = insertEntry.run(
          folder.id,
          entry.title,
          entry.notesMd,
          entry.code,
          entry.language,
          entry.filename,
        );
        const entryId = Number(result.lastInsertRowid);
        if (entry.tag === "exact") insertEntryTag.run(entryId, exactTagId);
        if (entry.tag === "partial") insertEntryTag.run(entryId, partialTagId);
      }
    });
    seedEntries();

    const records = (
      database.sqlite.prepare("SELECT count(*) AS count FROM entry").get() as {
        count: number;
      }
    ).count;
    assert.equal(records, RECORD_COUNT);

    const rssBefore = process.memoryUsage().rss;
    const startedAt = performance.now();
    const result = repositories.searchEntries(QUERY, {
      limit: PAGE_LIMIT,
      offset: 0,
    });
    const durationMs = performance.now() - startedAt;
    const rssAfter = process.memoryUsage().rss;

    assert.equal(result.total, EXPECTED_TOTAL);
    assert.equal(result.items.length, PAGE_LIMIT);
    assert.equal(result.limit, PAGE_LIMIT);
    assert.equal(result.offset, 0);
    assert.equal(result.items[0]?.title, EXACT_TITLE);
    assert.deepEqual(result.items[0]?.match.matchedFields, ["title"]);
    assert.equal(result.items[1]?.title, PREFIX_TITLE);

    console.log(JSON.stringify({
      benchmark: "neum-search",
      records,
      codeBytesPerEntry: CODE_BYTES_PER_ENTRY,
      totalMatches: result.total,
      pageSize: result.items.length,
      firstResultTier: "exact-title",
      durationMs: Number(durationMs.toFixed(3)),
      rssDeltaBytes: rssAfter - rssBefore,
    }, null, 2));
  } finally {
    closeDatabase?.();
    await rm(temporaryDirectory, { recursive: true, force: true });
    restoreEnvironment("NEUM_DATABASE_PATH", previousDatabasePath);
    restoreEnvironment("NEUM_UPLOAD_DIRECTORY", previousUploadDirectory);
  }
}

function createSyntheticEntry(index: number): SyntheticEntry {
  const id = String(index + 1).padStart(5, "0");
  const entry: SyntheticEntry = {
    title: `Synthetic snippet ${id}`,
    notesMd: `Deterministic synthetic notes for entry ${id}.`,
    code: codeWithNeedle(codeNeedlePosition(index)),
    language: "typescript",
    filename: null,
    tag: null,
  };

  if (index === 0) entry.title = EXACT_TITLE;
  if (index === 1) entry.title = PREFIX_TITLE;
  if (index === 2) entry.filename = QUERY;
  if (index === 3) entry.tag = "exact";
  if (index === 4) entry.title = `Guide to ${QUERY} internals`;
  if (index === 5) entry.filename = `sample-${QUERY}.ts`;
  if (index === 6) entry.language = `dialect-${QUERY}`;
  if (index === 7) entry.tag = "partial";
  return entry;
}

function codeNeedlePosition(index: number): NeedlePosition {
  if (index < 8 || index >= 8 + CODE_HIT_COUNT) return "none";
  if (index === 8) return "start";
  if (index === 9) return "end";
  return "middle";
}

function codeWithNeedle(position: NeedlePosition): string {
  if (position === "none") return BASE_CODE;
  if (position === "start") {
    return `${QUERY}\n${BASE_CODE}`.slice(0, CODE_BYTES_PER_ENTRY);
  }
  if (position === "end") {
    return `${BASE_CODE.slice(0, CODE_BYTES_PER_ENTRY - QUERY.length - 1)}\n${QUERY}`;
  }

  const start = Math.floor((CODE_BYTES_PER_ENTRY - QUERY.length) / 2);
  return `${BASE_CODE.slice(0, start)}${QUERY}${BASE_CODE.slice(start + QUERY.length)}`;
}

function restoreEnvironment(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
