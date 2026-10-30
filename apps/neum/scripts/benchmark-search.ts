import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type BetterSqlite3 from "better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import {
  SEARCH_BENCHMARK_BODY_BYTES,
  SEARCH_BENCHMARK_FANOUT_QUERY,
  SEARCH_BENCHMARK_PAGE_LIMIT,
  SEARCH_BENCHMARK_RANKING_QUERY,
  SEARCH_BENCHMARK_RECORDS,
  fixedSearchBody,
  restoreEnvironment,
  runSearchBenchmark,
} from "../../../scripts/search-benchmark";

const RANKING_QUERY = SEARCH_BENCHMARK_RANKING_QUERY;
const FANOUT_QUERY = SEARCH_BENCHMARK_FANOUT_QUERY;

async function main(): Promise<void> {
const previousDatabasePath = process.env.NEUM_DATABASE_PATH;
const previousUploadDirectory = process.env.NEUM_UPLOAD_DIRECTORY;
const temporaryDirectory = await mkdtemp(
  path.join(os.tmpdir(), "babel-neum-search-benchmark-"),
);
const databasePath = path.join(temporaryDirectory, "sqlite.db");
let closeDatabase: (() => void) | undefined;

try {
  process.env.NEUM_DATABASE_PATH = databasePath;
  process.env.NEUM_UPLOAD_DIRECTORY = path.join(temporaryDirectory, "uploads");
  const databaseModule = await import("../src/lib/db/client");
  const database = databaseModule.getNeumDatabase();
  closeDatabase = () => database.sqlite.close();
  if (path.resolve(database.databasePath) !== path.resolve(databasePath)) {
    throw new Error("Search benchmark refused to use a non-temporary database.");
  }
  migrate(database.db, {
    migrationsFolder: path.resolve(import.meta.dirname, "..", "drizzle"),
  });
  seedEntries(database.sqlite);
  const repositories = await import("../src/lib/repositories");

  await runSearchBenchmark({
    app: "neum",
    workspace: "@babel-apps/neum",
    entityCounts: {
      knowledge: SEARCH_BENCHMARK_RECORDS / 2,
      snippets: SEARCH_BENCHMARK_RECORDS / 2,
    },
    scenarios: [
      scenario("ranking-sparse-8", RANKING_QUERY, 8),
      scenario("body-fanout-50", FANOUT_QUERY, 50),
    ],
  });

  function scenario(
    id: "ranking-sparse-8" | "body-fanout-50",
    query: string,
    expectedTotal: number,
  ) {
    return {
      id,
      query,
      expectedTotal,
      run(searchQuery: string) {
        const result = repositories.searchEntries(searchQuery, {
          limit: SEARCH_BENCHMARK_PAGE_LIMIT,
          offset: 0,
        });
        return {
          total: result.total,
          keys: result.items.map(({ id: itemId }) => String(itemId)),
        };
      },
    };
  }
} finally {
  closeDatabase?.();
  await rm(temporaryDirectory, { recursive: true, force: true });
  restoreEnvironment("NEUM_DATABASE_PATH", previousDatabasePath);
  restoreEnvironment("NEUM_UPLOAD_DIRECTORY", previousUploadDirectory);
}
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

function seedEntries(sqlite: BetterSqlite3.Database): void {
  const perKind = SEARCH_BENCHMARK_RECORDS / 2;
  const folder = sqlite
    .prepare("SELECT id FROM folder ORDER BY id LIMIT 1")
    .get() as { id: number } | undefined;
  if (!folder) throw new Error("Search benchmark migration did not seed a folder.");
  const insertEntry = sqlite.prepare(`
    INSERT INTO entry (
      parent_id, folder_id, kind, title, notes_md, code, language, filename
    ) VALUES (NULL, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertTag = sqlite.prepare(
    "INSERT INTO tag (name, name_key) VALUES (?, ?)",
  );
  const insertEntryTag = sqlite.prepare(
    "INSERT INTO entry_tag (entry_id, tag_id) VALUES (?, ?)",
  );

  sqlite.transaction(() => {
    for (let index = 0; index < perKind; index += 1) {
      let knowledgeTitle = `Synthetic knowledge ${String(index + 1).padStart(5, "0")}`;
      let knowledgeNotes = fixedSearchBody("", "none");
      let knowledgeTag = false;
      if (index === 0) knowledgeTitle = RANKING_QUERY;
      if (index === 1) knowledgeTag = true;
      if (index === 2) knowledgeNotes = fixedSearchBody(RANKING_QUERY, "start");
      if (index === 3) knowledgeTitle = `Before ${RANKING_QUERY} after`;
      if (index >= 4 && index < 29) {
        knowledgeNotes = fixedSearchBody(
          FANOUT_QUERY,
          (["start", "middle", "end"] as const)[index % 3]!,
        );
      }
      const knowledgeId = Number(insertEntry.run(
        folder.id,
        "knowledge",
        knowledgeTitle,
        knowledgeNotes,
        null,
        null,
        null,
      ).lastInsertRowid);
      if (knowledgeTag) {
        addTag(insertTag, insertEntryTag, knowledgeId, RANKING_QUERY);
      }

      let snippetTitle = `Synthetic snippet ${String(index + 1).padStart(5, "0")}`;
      let snippetCode = fixedSearchBody("", "none", SEARCH_BENCHMARK_BODY_BYTES - 1);
      let filename: string | null = null;
      let snippetTag = false;
      if (index === 0) snippetTitle = RANKING_QUERY;
      if (index === 1) filename = RANKING_QUERY;
      if (index === 2) {
        snippetCode = fixedSearchBody(
          RANKING_QUERY,
          "middle",
          SEARCH_BENCHMARK_BODY_BYTES - 1,
        );
      }
      if (index === 3) snippetTag = true;
      if (index >= 4 && index < 29) {
        snippetCode = fixedSearchBody(
          FANOUT_QUERY,
          (["start", "middle", "end"] as const)[index % 3]!,
          SEARCH_BENCHMARK_BODY_BYTES - 1,
        );
      }
      const snippetId = Number(insertEntry.run(
        folder.id,
        "snippet",
        snippetTitle,
        "x",
        snippetCode,
        "typescript",
        filename,
      ).lastInsertRowid);
      if (snippetTag) {
        addTag(
          insertTag,
          insertEntryTag,
          snippetId,
          `topic-${RANKING_QUERY}-more`,
        );
      }
    }
  })();
}

function addTag(
  insertTag: BetterSqlite3.Statement,
  insertEntryTag: BetterSqlite3.Statement,
  entryId: number,
  tagName: string,
): void {
  const tagId = Number(
    insertTag.run(tagName, tagName.toLowerCase()).lastInsertRowid,
  );
  insertEntryTag.run(entryId, tagId);
}
