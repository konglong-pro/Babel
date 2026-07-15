import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";

import { migrate } from "drizzle-orm/better-sqlite3/migrator";

const RECORD_COUNT = 10_000;
const SHORT_QUERY = "短笔记基准针🧪C++";
const LONG_QUERY = "长文基准针🧪C++";
const LONG_MARKDOWN = Array.from(
  { length: 64 },
  (_, index) => [
    `## 合成章节 ${index + 1}`,
    "",
    "这是一段只用于本地搜索基准的长中文 Markdown。它包含历史叙述、人物关系、时间线和因果分析。",
    "",
    "- 第一条合成材料用于扩大正文长度。",
    "- 第二条合成材料用于验证多余空白和换行折叠。",
    "- 第三条合成材料不包含任何目标查询词。",
  ].join("\n"),
).join("\n\n");

interface SyntheticNote {
  title: string;
  contentMd: string;
  tags: string[];
}

interface BenchmarkResult {
  name: "short-notes" | "long-chinese-markdown";
  records: number;
  matches: number;
  durationMs: number;
  rssDeltaBytes: number;
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

async function main(): Promise<void> {
  const previousDatabasePath = process.env.HERODOTUS_DATABASE_PATH;
  const previousUploadDirectory = process.env.HERODOTUS_UPLOAD_DIRECTORY;
  const temporaryDirectory = await mkdtemp(
    path.join(os.tmpdir(), "babel-herodotus-search-benchmark-"),
  );
  const temporaryDatabasePath = path.join(temporaryDirectory, "sqlite.db");
  let closeDatabase: (() => void) | undefined;

  try {
    process.env.HERODOTUS_DATABASE_PATH = temporaryDatabasePath;
    process.env.HERODOTUS_UPLOAD_DIRECTORY = path.join(temporaryDirectory, "uploads");

    const database = await import("../src/lib/db/client");
    if (path.resolve(database.databasePath) !== path.resolve(temporaryDatabasePath)) {
      throw new Error("Search benchmark refused to use a non-temporary database.");
    }
    closeDatabase = () => database.sqlite.close();

    migrate(database.db, {
      migrationsFolder: path.resolve(import.meta.dirname, "..", "drizzle"),
    });

    const repositories = await import("../src/lib/repositories");
    const folder = database.sqlite
      .prepare("SELECT id FROM folder ORDER BY id ASC LIMIT 1")
      .get() as { id: number } | undefined;
    if (!folder) throw new Error("Search benchmark migration did not seed a folder.");

    const insert = database.sqlite.prepare(
      "INSERT INTO note (folder_id, title, content_md, tags) VALUES (?, ?, ?, ?)",
    );
    const rebuildScenario = database.sqlite.transaction(
      (createNote: (index: number) => SyntheticNote) => {
        database.sqlite.exec("DELETE FROM note");
        database.sqlite.exec("DELETE FROM sqlite_sequence WHERE name = 'note'");
        for (let index = 0; index < RECORD_COUNT; index += 1) {
          const note = createNote(index);
          insert.run(folder.id, note.title, note.contentMd, JSON.stringify(note.tags));
        }
      },
    );
    const countRecords = database.sqlite.prepare(
      "SELECT count(*) AS count FROM note",
    );

    function benchmarkScenario(
      name: BenchmarkResult["name"],
      query: string,
      expectedMatches: number,
      createNote: (index: number) => SyntheticNote,
    ): BenchmarkResult {
      rebuildScenario(createNote);
      const records = (countRecords.get() as { count: number }).count;
      if (records !== RECORD_COUNT) {
        throw new Error(`Expected ${RECORD_COUNT} synthetic notes, found ${records}.`);
      }

      const rssBefore = process.memoryUsage().rss;
      const startedAt = performance.now();
      const matches = repositories.searchNotes(query).notes.length;
      const durationMs = performance.now() - startedAt;
      const rssAfter = process.memoryUsage().rss;
      if (matches !== expectedMatches) {
        throw new Error(
          `${name} expected ${expectedMatches} matches, found ${matches}.`,
        );
      }

      return {
        name,
        records,
        matches,
        durationMs: Number(durationMs.toFixed(3)),
        rssDeltaBytes: rssAfter - rssBefore,
      };
    }

    const scenarios = [
      benchmarkScenario("short-notes", SHORT_QUERY, 6, createShortNote),
      benchmarkScenario(
        "long-chinese-markdown",
        LONG_QUERY,
        4,
        createLongMarkdownNote,
      ),
    ];

    console.log(JSON.stringify({ benchmark: "herodotus-search", scenarios }, null, 2));
  } finally {
    closeDatabase?.();
    await rm(temporaryDirectory, { recursive: true, force: true });
    restoreEnvironment("HERODOTUS_DATABASE_PATH", previousDatabasePath);
    restoreEnvironment("HERODOTUS_UPLOAD_DIRECTORY", previousUploadDirectory);
  }
}

function createShortNote(index: number): SyntheticNote {
  const id = String(index + 1).padStart(5, "0");
  const note: SyntheticNote = {
    title: `普通短笔记 ${id}`,
    contentMd: `这是一条确定性的合成短笔记，编号 ${id}。`,
    tags: ["合成", "短笔记"],
  };

  if (index === 0) note.title = SHORT_QUERY;
  if (index === 1) note.title = `普通短笔记 ${id} ${SHORT_QUERY}`;
  if (index === 2) note.contentMd = `${SHORT_QUERY} 位于正文开头。`;
  if (index === 3) note.contentMd = `目标短语位于正文结尾：${SHORT_QUERY}`;
  if (index === 4) note.tags = [SHORT_QUERY];
  if (index === 5) note.tags = [`前缀-${SHORT_QUERY}-后缀`];
  return note;
}

function createLongMarkdownNote(index: number): SyntheticNote {
  const id = String(index + 1).padStart(5, "0");
  const note: SyntheticNote = {
    title: `长中文 Markdown ${id}`,
    contentMd: `${LONG_MARKDOWN}\n\n记录编号：${id}`,
    tags: ["合成", "长文"],
  };

  if (index === 0) note.contentMd = `${LONG_QUERY}\n\n${note.contentMd}`;
  if (index === 1) note.contentMd = `${note.contentMd}\n\n${LONG_QUERY}`;
  if (index === 2) note.title = `${LONG_QUERY} ${id}`;
  if (index === 3) note.title = `长中文 Markdown ${id} ${LONG_QUERY}`;
  return note;
}

function restoreEnvironment(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
