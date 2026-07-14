import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

import { and, count, eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import type * as RepositoryModule from "../src/lib/repositories";

let temporaryDirectory = "";
let repositories: typeof RepositoryModule;
let database: typeof import("../src/lib/db/client");
let schema: typeof import("../src/lib/db/schema");

before(async () => {
  temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "retex-links-test-"));
  process.env.RETEX_DATABASE_PATH = path.join(temporaryDirectory, "sqlite.db");
  process.env.RETEX_UPLOAD_DIRECTORY = path.join(temporaryDirectory, "uploads");
  database = await import("../src/lib/db/client");
  schema = await import("../src/lib/db/schema");
  migrate(database.db, { migrationsFolder: path.join(process.cwd(), "drizzle") });
  repositories = await import("../src/lib/repositories");
});

after(() => {
  database.sqlite.close();
  const resolved = path.resolve(temporaryDirectory);
  assert.ok(resolved.startsWith(`${path.resolve(os.tmpdir())}${path.sep}retex-links-test-`));
  rmSync(resolved, { recursive: true, force: true });
});

test("indexes both exercise markdown fields once and excludes scratch work", () => {
  const knowledgeFolder = repositories.createFolder({
    type: "knowledge",
    name: "Link targets",
  });
  const exerciseFolder = repositories.createFolder({
    type: "exercise",
    name: "Link sources",
  });
  const shared = repositories.createKnowledge({
    folderId: knowledgeFolder.id,
    title: "Shared target",
  });
  repositories.createKnowledge({
    folderId: knowledgeFolder.id,
    title: "Answer target",
  });
  repositories.createKnowledge({
    folderId: knowledgeFolder.id,
    title: "Solution target",
  });
  const source = repositories.createExercise({
    folderId: exerciseFolder.id,
    title: "Two-field source",
    imagePath: "data/uploads/exercises/two-field.png",
    answerMd: "[[Shared target]] [[Answer target]]",
    solutionMd: "[[Shared target]] [[Solution target]]",
  });

  assert.deepEqual(
    source.links.map(({ titleKey }) => titleKey),
    ["answer target", "shared target", "solution target"],
  );
  assert.deepEqual(
    source.links.find(({ titleKey }) => titleKey === "shared target"),
    { titleKey: "shared target", targetKind: "knowledge", targetId: shared.id },
  );
  assert.equal(source.links.length, 3);

  repositories.upsertScratch(source.id, "[[Scratch-only target]]");
  assert.equal(repositories.getExercise(source.id)?.links.length, 3);
  const scratchRows = database.db
    .select({ value: count() })
    .from(schema.noteLinks)
    .where(eq(schema.noteLinks.targetTitleKey, "scratch-only target"))
    .get();
  assert.equal(scratchRows?.value, 0);
});

test("resolves knowledge before exercise and uses the smallest id within a kind", () => {
  const knowledgeFolder = repositories.createFolder({
    type: "knowledge",
    name: "Priority knowledge",
  });
  const exerciseFolder = repositories.createFolder({
    type: "exercise",
    name: "Priority exercises",
  });
  const firstExercise = repositories.createExercise({
    folderId: exerciseFolder.id,
    title: "Priority target",
    imagePath: "data/uploads/exercises/priority-first.png",
  });
  repositories.createExercise({
    folderId: exerciseFolder.id,
    title: "Priority target",
    imagePath: "data/uploads/exercises/priority-second.png",
  });
  const source = repositories.createKnowledge({
    folderId: knowledgeFolder.id,
    title: "Priority source",
    contentMd: "[[Priority target]]",
  });
  assert.deepEqual(source.links[0], {
    titleKey: "priority target",
    targetKind: "exercise",
    targetId: firstExercise.id,
  });

  const firstKnowledge = repositories.createKnowledge({
    folderId: knowledgeFolder.id,
    title: "Priority target",
  });
  repositories.createKnowledge({
    folderId: knowledgeFolder.id,
    title: "Priority target",
  });
  assert.deepEqual(repositories.getKnowledge(source.id)?.links[0], {
    titleKey: "priority target",
    targetKind: "knowledge",
    targetId: firstKnowledge.id,
  });
});

test("rename and delete make links unresolved and later targets re-resolve them", async () => {
  const knowledgeFolder = repositories.createFolder({
    type: "knowledge",
    name: "Lifecycle knowledge",
  });
  const exerciseFolder = repositories.createFolder({
    type: "exercise",
    name: "Lifecycle exercises",
  });
  const target = repositories.createExercise({
    folderId: exerciseFolder.id,
    title: "Lifecycle target",
    imagePath: "data/uploads/exercises/lifecycle.png",
  });
  const source = repositories.createKnowledge({
    folderId: knowledgeFolder.id,
    title: "Lifecycle source",
    contentMd: "[[Lifecycle target]]",
  });
  assert.equal(repositories.getKnowledge(source.id)?.links[0]?.targetId, target.id);

  repositories.updateExercise(target.id, { title: "Renamed exercise" });
  assert.deepEqual(repositories.getKnowledge(source.id)?.links[0], {
    titleKey: "lifecycle target",
    targetKind: null,
    targetId: null,
  });

  const replacement = repositories.createKnowledge({
    folderId: knowledgeFolder.id,
    title: "Lifecycle target",
  });
  assert.deepEqual(repositories.getKnowledge(source.id)?.links[0], {
    titleKey: "lifecycle target",
    targetKind: "knowledge",
    targetId: replacement.id,
  });
  assert.equal(repositories.deleteKnowledge(replacement.id), true);
  assert.equal(repositories.getKnowledge(source.id)?.links[0]?.targetId, null);

  repositories.updateExercise(target.id, { title: " Lifecycle   Target " });
  assert.deepEqual(repositories.getKnowledge(source.id)?.links[0], {
    titleKey: "lifecycle target",
    targetKind: "exercise",
    targetId: target.id,
  });

  assert.equal(repositories.deleteKnowledge(source.id), true);
  const sourceRows = database.db
    .select({ value: count() })
    .from(schema.noteLinks)
    .where(
      and(
        eq(schema.noteLinks.sourceKind, "knowledge"),
        eq(schema.noteLinks.sourceId, source.id),
      ),
    )
    .get();
  assert.equal(sourceRows?.value, 0);
  assert.equal(await repositories.deleteExercise(target.id), true);
});

test("backlinks are grouped by source kind and title suggestions preserve kinds", () => {
  const knowledgeFolder = repositories.createFolder({
    type: "knowledge",
    name: "Backlink knowledge",
  });
  const exerciseFolder = repositories.createFolder({
    type: "exercise",
    name: "Backlink exercises",
  });
  const target = repositories.createKnowledge({
    folderId: knowledgeFolder.id,
    title: "Grouped target",
  });
  const knowledgeSource = repositories.createKnowledge({
    folderId: knowledgeFolder.id,
    title: "Grouped knowledge source",
    contentMd: "[[Grouped target]]",
  });
  const exerciseSource = repositories.createExercise({
    folderId: exerciseFolder.id,
    title: "Grouped exercise source",
    imagePath: "data/uploads/exercises/grouped.png",
    answerMd: "[[Grouped target]]",
  });

  const backlinks = repositories.listBacklinks("knowledge", target.id);
  assert.deepEqual(backlinks.knowledge.map(({ id }) => id), [knowledgeSource.id]);
  assert.deepEqual(backlinks.exercises.map(({ id }) => id), [exerciseSource.id]);
  assert.deepEqual(
    repositories.listNoteTitles("grouped", 20).map(({ title, kind }) => ({ title, kind })),
    [
      { title: "Grouped exercise source", kind: "exercise" },
      { title: "Grouped knowledge source", kind: "knowledge" },
      { title: "Grouped target", kind: "knowledge" },
    ],
  );
  assert.deepEqual(
    repositories.listNoteTitles("grouped", 1).map(({ title, kind }) => ({ title, kind })),
    [{ title: "Grouped exercise source", kind: "exercise" }],
  );

  const literal = repositories.createKnowledge({
    folderId: knowledgeFolder.id,
    title: "Grouped %_ literal prefix",
  });
  repositories.createExercise({
    folderId: exerciseFolder.id,
    title: "Before Grouped %_ literal prefix",
    imagePath: "data/uploads/exercises/grouped-infix.png",
  });
  const slash = repositories.createKnowledge({
    folderId: knowledgeFolder.id,
    title: "Grouped slash\\ literal prefix",
  });
  const unicode = repositories.createKnowledge({
    folderId: knowledgeFolder.id,
    title: "Ĉapitro   Du",
  });

  assert.deepEqual(repositories.listNoteTitles("grouped %_", 20), [
    { id: literal.id, title: literal.title, kind: "knowledge" },
  ]);
  assert.deepEqual(repositories.listNoteTitles("grouped slash\\", 20), [
    { id: slash.id, title: slash.title, kind: "knowledge" },
  ]);
  assert.deepEqual(repositories.listNoteTitles("ĉa", 20), [
    { id: unicode.id, title: unicode.title, kind: "knowledge" },
  ]);
  assert.deepEqual(repositories.listNoteTitles("ĉapitro du", 20), [
    { id: unicode.id, title: unicode.title, kind: "knowledge" },
  ]);
  assert.equal(repositories.listNoteTitles("", 1).length, 1);
});

test("link trigger failures roll back entity and relation writes", () => {
  const knowledgeFolder = repositories.createFolder({
    type: "knowledge",
    name: "Rollback knowledge",
  });
  const exerciseFolder = repositories.createFolder({
    type: "exercise",
    name: "Rollback exercises",
  });
  const relationA = repositories.createKnowledge({
    folderId: knowledgeFolder.id,
    title: "Relation A",
  });
  const relationB = repositories.createKnowledge({
    folderId: knowledgeFolder.id,
    title: "Relation B",
  });
  repositories.createKnowledge({
    folderId: knowledgeFolder.id,
    title: "Original target",
  });
  repositories.createKnowledge({
    folderId: knowledgeFolder.id,
    title: "Rollback target",
  });
  const source = repositories.createExercise({
    folderId: exerciseFolder.id,
    title: "Rollback source",
    imagePath: "data/uploads/exercises/rollback-original.png",
    answerMd: "[[Original target]]",
    knowledgeIds: [relationA.id],
  });

  database.sqlite.exec(`
    CREATE TRIGGER fail_retex_link_insert
    BEFORE INSERT ON note_link
    WHEN NEW.target_title_key = 'rollback target'
    BEGIN
      SELECT RAISE(ABORT, 'link insert blocked');
    END;
  `);
  try {
    assert.throws(
      () => repositories.updateExercise(source.id, {
        title: "Changed source",
        imagePath: "data/uploads/exercises/rollback-changed.png",
        answerMd: "[[Rollback target]]",
        knowledgeIds: [relationB.id],
      }),
      /link insert blocked/i,
    );
    const unchanged = repositories.getExercise(source.id);
    assert.equal(unchanged?.title, "Rollback source");
    assert.equal(unchanged?.imagePath, "data/uploads/exercises/rollback-original.png");
    assert.equal(unchanged?.answerMd, "[[Original target]]");
    assert.deepEqual(unchanged?.relatedKnowledge.map(({ id }) => id), [relationA.id]);
    assert.deepEqual(unchanged?.links.map(({ titleKey }) => titleKey), ["original target"]);

    const relationExercise = repositories.createExercise({
      folderId: exerciseFolder.id,
      title: "Create rollback relation",
      imagePath: "data/uploads/exercises/create-rollback.png",
    });
    assert.throws(
      () => repositories.createKnowledge({
        folderId: knowledgeFolder.id,
        title: "Should not persist",
        contentMd: "[[Rollback target]]",
        exerciseIds: [relationExercise.id],
      }),
      /link insert blocked/i,
    );
    assert.equal(
      repositories.listKnowledge().some(({ title }) => title === "Should not persist"),
      false,
    );
  } finally {
    database.sqlite.exec("DROP TRIGGER fail_retex_link_insert");
  }
});

test("full link rebuild is idempotent and still excludes scratch markdown", () => {
  const knowledgeFolder = repositories.createFolder({
    type: "knowledge",
    name: "Rebuild knowledge",
  });
  const exerciseFolder = repositories.createFolder({
    type: "exercise",
    name: "Rebuild exercises",
  });
  repositories.createKnowledge({
    folderId: knowledgeFolder.id,
    title: "Rebuild target",
  });
  repositories.createKnowledge({
    folderId: knowledgeFolder.id,
    title: "Rebuild source",
    contentMd: "[[Rebuild target]] [[Rebuild missing]]",
  });
  const exercise = repositories.createExercise({
    folderId: exerciseFolder.id,
    title: "Rebuild exercise source",
    imagePath: "data/uploads/exercises/rebuild.png",
    answerMd: "[[Rebuild target]]",
    solutionMd: "[[Rebuild target]] [[Rebuild solution missing]]",
  });
  repositories.upsertScratch(exercise.id, "[[Rebuild scratch missing]]");

  database.db.delete(schema.noteLinks).run();
  const first = repositories.rebuildAllNoteLinks();
  const second = repositories.rebuildAllNoteLinks();
  assert.deepEqual(second, first);
  assert.equal(
    second.unresolved.some(({ targetTitleKey }) =>
      targetTitleKey === "rebuild scratch missing"),
    false,
  );
  assert.equal(
    second.unresolved.some(({ targetTitleKey }) =>
      targetTitleKey === "rebuild missing"),
    true,
  );
  assert.equal(
    second.unresolved.some(({ targetTitleKey }) =>
      targetTitleKey === "rebuild solution missing"),
    true,
  );
});
