import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import BetterSqlite3 from "better-sqlite3";

import {
  finalizeLegacyExerciseProblems,
  prepareLegacyExerciseProblems,
} from "../src/lib/db/exercise-problem-migration";

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01]);

test("legacy exercise images migrate into managed problem Markdown without data loss", async () => {
  const temporaryDirectory = await mkdtemp(
    path.join(os.tmpdir(), "matter-exercise-problem-migration-"),
  );
  const legacyRoot = path.join(temporaryDirectory, "uploads", "exercises");
  const noteRoot = path.join(temporaryDirectory, "uploads", "notes");
  const previousLegacyRoot = process.env.MATTER_UPLOAD_DIRECTORY;
  const previousNoteRoot = process.env.MATTER_NOTE_UPLOAD_DIRECTORY;
  process.env.MATTER_UPLOAD_DIRECTORY = legacyRoot;
  process.env.MATTER_NOTE_UPLOAD_DIRECTORY = noteRoot;
  const sqlite = new BetterSqlite3(path.join(temporaryDirectory, "sqlite.db"));

  try {
    createLegacySchema(sqlite);
    sqlite.exec(`
      INSERT INTO folder (id, type, name) VALUES (1, 'exercise', 'Exercises');
      INSERT INTO knowledge_note (id, folder_id, title) VALUES (1, 1, 'Related');
      INSERT INTO exercise (id, folder_id, title, image_path)
      VALUES (7, 1, 'Legacy exercise', 'data/uploads/exercises/problem.png');
      INSERT INTO scratch_solution (exercise_id, content_md) VALUES (7, 'scratch');
      INSERT INTO knowledge_exercise (knowledge_id, exercise_id) VALUES (1, 7);
    `);
    await mkdir(legacyRoot, { recursive: true });
    await writeFile(path.join(legacyRoot, "problem.png"), png);

    assert.equal(await prepareLegacyExerciseProblems(sqlite), 1);
    const staged = await readFile(
      path.join(noteRoot, ".exercise-problem-migration", "legacy-exercise-7-problem.png"),
    );
    assert.deepEqual(staged, png);
    assert.deepEqual(
      await readFile(path.join(noteRoot, "legacy-exercise-7-problem.png")),
      png,
      "the final file must exist before the database can commit its Markdown reference",
    );

    sqlite.pragma("foreign_keys = OFF");
    await applyExerciseProblemMigration(sqlite);
    assert.deepEqual(sqlite.pragma("foreign_key_check"), []);
    sqlite.pragma("foreign_keys = ON");

    assert.equal(await finalizeLegacyExerciseProblems(sqlite), 1);
    assert.equal(
      sqlite.prepare("SELECT problem_md FROM exercise WHERE id = 7").pluck().get(),
      "![Problem](/api/uploads/notes/legacy-exercise-7-problem.png)",
    );
    assert.deepEqual(
      await readFile(path.join(noteRoot, "legacy-exercise-7-problem.png")),
      png,
    );
    assert.deepEqual(await readFile(path.join(legacyRoot, "problem.png")), png);
    assert.equal(
      sqlite
        .prepare(
          "SELECT count(*) FROM note_image WHERE source_kind = 'exercise' AND source_id = 7 AND image_path = ?",
        )
        .pluck()
        .get("data/matter/uploads/notes/legacy-exercise-7-problem.png"),
      1,
    );
    assert.equal(
      sqlite.prepare("SELECT count(*) FROM scratch_solution WHERE exercise_id = 7").pluck().get(),
      1,
    );
    assert.equal(
      sqlite.prepare("SELECT count(*) FROM knowledge_exercise WHERE exercise_id = 7").pluck().get(),
      1,
    );
    const exerciseColumns = sqlite.prepare("PRAGMA table_info(exercise)").all() as Array<{
      name: string;
      notnull: number;
    }>;
    assert.equal(exerciseColumns.some(({ name }) => name === "image_path"), false);
    assert.equal(
      exerciseColumns.find(({ name }) => name === "problem_md")?.notnull,
      1,
    );

    assert.equal(await finalizeLegacyExerciseProblems(sqlite), 1);

    sqlite
      .prepare("UPDATE exercise SET problem_md = problem_md || ? WHERE id = 7")
      .run("\n\nAdditional user-authored explanation.");
    assert.equal(
      await finalizeLegacyExerciseProblems(sqlite),
      1,
      "later migration runs must not treat editable problem Markdown as migration state",
    );
  } finally {
    sqlite.close();
    restoreEnvironment("MATTER_UPLOAD_DIRECTORY", previousLegacyRoot);
    restoreEnvironment("MATTER_NOTE_UPLOAD_DIRECTORY", previousNoteRoot);
    const resolved = path.resolve(temporaryDirectory);
    assert.ok(
      resolved.startsWith(
        `${path.resolve(os.tmpdir())}${path.sep}matter-exercise-problem-migration-`,
      ),
    );
    rmSync(resolved, { recursive: true, force: true });
  }
});

test("legacy migration refuses to alter the database when an image is missing", async () => {
  const temporaryDirectory = await mkdtemp(
    path.join(os.tmpdir(), "matter-exercise-problem-missing-"),
  );
  const previousLegacyRoot = process.env.MATTER_UPLOAD_DIRECTORY;
  const previousNoteRoot = process.env.MATTER_NOTE_UPLOAD_DIRECTORY;
  process.env.MATTER_UPLOAD_DIRECTORY = path.join(temporaryDirectory, "legacy");
  process.env.MATTER_NOTE_UPLOAD_DIRECTORY = path.join(temporaryDirectory, "notes");
  const sqlite = new BetterSqlite3(path.join(temporaryDirectory, "sqlite.db"));

  try {
    createLegacySchema(sqlite);
    sqlite.exec(`
      INSERT INTO folder (id, type, name) VALUES (1, 'exercise', 'Exercises');
      INSERT INTO exercise (id, folder_id, title, image_path)
      VALUES (1, 1, 'Missing image', 'data/uploads/exercises/missing.png');
    `);
    await assert.rejects(
      prepareLegacyExerciseProblems(sqlite),
      /missing or is not a regular file/i,
    );
    assert.equal(
      sqlite.prepare("SELECT image_path FROM exercise WHERE id = 1").pluck().get(),
      "data/uploads/exercises/missing.png",
    );
  } finally {
    sqlite.close();
    restoreEnvironment("MATTER_UPLOAD_DIRECTORY", previousLegacyRoot);
    restoreEnvironment("MATTER_NOTE_UPLOAD_DIRECTORY", previousNoteRoot);
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

function createLegacySchema(sqlite: BetterSqlite3.Database): void {
  sqlite.pragma("foreign_keys = ON");
  sqlite.exec(`
    CREATE TABLE folder (
      id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
      type text NOT NULL,
      name text NOT NULL
    );
    CREATE TABLE knowledge_note (
      id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
      folder_id integer NOT NULL REFERENCES folder(id) ON DELETE restrict,
      title text NOT NULL
    );
    CREATE TABLE exercise (
      id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
      folder_id integer NOT NULL REFERENCES folder(id) ON DELETE restrict,
      title text NOT NULL,
      image_path text NOT NULL,
      answer_md text DEFAULT '' NOT NULL,
      solution_md text DEFAULT '' NOT NULL,
      tags text DEFAULT '[]' NOT NULL,
      created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
      updated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL
    );
    CREATE TABLE scratch_solution (
      id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
      exercise_id integer NOT NULL REFERENCES exercise(id) ON DELETE cascade,
      content_md text DEFAULT '' NOT NULL,
      updated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL
    );
    CREATE TABLE knowledge_exercise (
      knowledge_id integer NOT NULL REFERENCES knowledge_note(id) ON DELETE cascade,
      exercise_id integer NOT NULL REFERENCES exercise(id) ON DELETE cascade,
      PRIMARY KEY (knowledge_id, exercise_id)
    );
    CREATE TABLE note_image (
      id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
      source_kind text NOT NULL,
      source_id integer NOT NULL,
      image_path text NOT NULL UNIQUE,
      created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL
    );
  `);
}

async function applyExerciseProblemMigration(
  sqlite: BetterSqlite3.Database,
): Promise<void> {
  const sql = await readFile(
    path.join(process.cwd(), "drizzle", "0004_exercise_problem_markdown.sql"),
    "utf8",
  );
  sqlite.transaction(() => {
    for (const statement of sql.split("--> statement-breakpoint")) {
      if (statement.trim()) sqlite.exec(statement);
    }
  })();
}

function restoreEnvironment(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
