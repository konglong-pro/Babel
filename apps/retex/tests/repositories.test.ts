import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

import { count, eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import type * as RepositoryModule from "../src/lib/repositories";

let temporaryDirectory = "";
let repositories: typeof RepositoryModule;
let database: typeof import("../src/lib/db/client");

before(async () => {
  temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "retex-test-"));
  process.env.RETEX_DATABASE_PATH = path.join(
    temporaryDirectory,
    "sqlite.db",
  );

  database = await import("../src/lib/db/client");
  migrate(database.db, {
    migrationsFolder: path.join(process.cwd(), "drizzle"),
  });
  repositories = await import("../src/lib/repositories");
});

after(() => {
  database.sqlite.close();

  const resolved = path.resolve(temporaryDirectory);
  const temporaryRoot = path.resolve(os.tmpdir());
  assert.ok(resolved.startsWith(`${temporaryRoot}${path.sep}retex-test-`));
  rmSync(resolved, { recursive: true, force: true });
});

test("repository workflow preserves archive invariants", async () => {
  const knowledgeRoot = repositories.createFolder({
    type: "knowledge",
    name: "Calculus",
  });
  const knowledgeChild = repositories.createFolder({
    type: "knowledge",
    name: "Integration",
    parentId: knowledgeRoot.id,
  });
  const exerciseRoot = repositories.createFolder({
    type: "exercise",
    name: "Calculus",
  });

  assert.throws(
    () =>
      repositories.createFolder({
        type: "knowledge",
        name: "Wrong type",
        parentId: exerciseRoot.id,
      }),
    /Knowledge|folder/i,
  );

  const knowledge = repositories.createKnowledge({
    folderId: knowledgeRoot.id,
    title: "换元积分理解",
    contentMd: "深层关键词 deep-substitution-token，且 $u=x^2$。",
    tags: ["换元", "积分", "换元"],
  });
  const firstExercise = repositories.createExercise({
    folderId: exerciseRoot.id,
    title: "经典换元积分题 001",
    imagePath: "data/uploads/exercises/repository-test-1.png",
    answerMd: "$1/3$",
    solutionMd: "解法关键词 solution-substitution-token",
    tags: ["经典", "换元"],
  });
  const secondExercise = repositories.createExercise({
    folderId: exerciseRoot.id,
    title: "经典换元积分题 002",
    imagePath: "data/uploads/exercises/repository-test-2.png",
    solutionMd: "另一种推导",
    tags: ["积分"],
  });

  const related = repositories.setKnowledgeExercises(knowledge.id, [
    firstExercise.id,
    secondExercise.id,
    firstExercise.id,
  ]);
  assert.deepEqual(
    related.map((item) => item.id).sort((a, b) => a - b),
    [firstExercise.id, secondExercise.id],
  );
  assert.equal(
    repositories.getKnowledge(knowledge.id)?.relatedExercises.length,
    2,
  );
  assert.equal(
    repositories.getExercise(firstExercise.id)?.relatedKnowledge[0]?.id,
    knowledge.id,
  );

  const updatedExercise = repositories.updateExercise(firstExercise.id, {
    title: "经典换元积分题 001（更新）",
    answerMd: "$2/3$",
    solutionMd: "更新后的解法仍含 solution-substitution-token",
    tags: ["经典", "更新"],
    knowledgeIds: [knowledge.id],
  });
  assert.equal(updatedExercise.title, "经典换元积分题 001（更新）");
  assert.equal(updatedExercise.answerMd, "$2/3$");
  assert.deepEqual(updatedExercise.tags, ["经典", "更新"]);
  assert.equal(updatedExercise.relatedKnowledge[0]?.id, knowledge.id);

  const firstScratch = repositories.upsertScratch(
    firstExercise.id,
    "第一次临时推导",
  );
  const secondScratch = repositories.upsertScratch(
    firstExercise.id,
    "覆盖后的临时推导",
  );
  assert.equal(firstScratch.id, secondScratch.id);
  assert.equal(
    repositories.getScratch(firstExercise.id)?.contentMd,
    "覆盖后的临时推导",
  );

  const { db } = database;
  const { scratchSolutions } = await import("../src/lib/db/schema");
  const scratchCount = db
    .select({ value: count() })
    .from(scratchSolutions)
    .where(eq(scratchSolutions.exerciseId, firstExercise.id))
    .get();
  assert.equal(scratchCount?.value, 1);

  assert.equal(repositories.searchArchive("deep-substitution-token").knowledge[0]?.id, knowledge.id);
  assert.equal(repositories.searchArchive("solution-substitution-token").exercises[0]?.id, firstExercise.id);
  assert.equal(repositories.searchArchive("经典").exercises[0]?.id, firstExercise.id);

  repositories.updateKnowledge(knowledge.id, {
    folderId: knowledgeChild.id,
    title: "换元积分：尺度变化",
  });
  assert.equal(repositories.listKnowledge(knowledgeChild.id)[0]?.id, knowledge.id);

  assert.throws(
    () =>
      repositories.updateFolder(knowledgeRoot.id, {
        parentId: knowledgeChild.id,
      }),
    /cycle|itself|descendant/i,
  );
  assert.throws(() => repositories.deleteFolder(knowledgeChild.id));

  assert.equal(await repositories.deleteExercise(firstExercise.id), true);
  assert.equal(repositories.getScratch(firstExercise.id), null);
  assert.deepEqual(
    repositories.getKnowledge(knowledge.id)?.relatedExercises.map((item) => item.id),
    [secondExercise.id],
  );

  assert.equal(repositories.deleteScratch(secondExercise.id), false);
  assert.equal(await repositories.deleteExercise(secondExercise.id), true);
  assert.equal(repositories.deleteKnowledge(knowledge.id), true);
  assert.equal(repositories.deleteFolder(knowledgeChild.id), true);
  assert.equal(repositories.deleteFolder(knowledgeRoot.id), true);
  assert.equal(repositories.deleteFolder(exerciseRoot.id), true);
});
