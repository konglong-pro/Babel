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
    problemMd: "Repository problem 1",
    answerMd: "$1/3$",
    solutionMd: "解法关键词 solution-substitution-token",
    tags: ["经典", "换元"],
  });
  const secondExercise = repositories.createExercise({
    folderId: exerciseRoot.id,
    title: "经典换元积分题 002",
    problemMd: "Repository problem 2",
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

test("knowledge notes form a parent-child tree inside one folder", () => {
  const folder = repositories.createFolder({ type: "knowledge", name: "Page tree" });
  const parent = repositories.createKnowledge({
    folderId: folder.id,
    title: "Parent page",
  });
  const child = repositories.createKnowledge({
    folderId: folder.id,
    parentId: parent.id,
    title: "Child page",
  });

  assert.equal(parent.parentId, null);
  assert.equal(child.parentId, parent.id);
  assert.equal(repositories.listKnowledge(folder.id).find((item) => item.id === child.id)?.parentId, parent.id);
});

test("knowledge and exercises are created first and persist manual order", async () => {
  const knowledgeFolder = repositories.createFolder({
    type: "knowledge",
    name: "Knowledge item order",
  });
  const firstKnowledge = repositories.createKnowledge({
    folderId: knowledgeFolder.id,
    title: "First knowledge",
  });
  const secondKnowledge = repositories.createKnowledge({
    folderId: knowledgeFolder.id,
    title: "Second knowledge",
  });
  assert.deepEqual(
    repositories.listKnowledge(knowledgeFolder.id).map(({ id, position }) => ({ id, position })),
    [{ id: secondKnowledge.id, position: 0 }, { id: firstKnowledge.id, position: 1 }],
  );
  repositories.updateKnowledge(firstKnowledge.id, { position: 0 });
  assert.deepEqual(
    repositories.listKnowledge(knowledgeFolder.id).map(({ id }) => id),
    [firstKnowledge.id, secondKnowledge.id],
  );

  const exerciseFolder = repositories.createFolder({
    type: "exercise",
    name: "Exercise item order",
  });
  const firstExercise = repositories.createExercise({
    folderId: exerciseFolder.id,
    title: "First exercise",
    problemMd: "Problem one",
  });
  const secondExercise = repositories.createExercise({
    folderId: exerciseFolder.id,
    title: "Second exercise",
    problemMd: "Problem two",
  });
  repositories.updateExercise(firstExercise.id, { position: 0 });
  assert.deepEqual(
    repositories.listExercises(exerciseFolder.id).map(({ id, position }) => ({ id, position })),
    [{ id: firstExercise.id, position: 0 }, { id: secondExercise.id, position: 1 }],
  );
  assert.throws(
    () => repositories.updateExercise(firstExercise.id, { position: -1 }),
    /position must be a non-negative integer/i,
  );

  assert.equal(repositories.deleteKnowledge(firstKnowledge.id), true);
  assert.equal(repositories.getKnowledge(secondKnowledge.id)?.position, 0);
  assert.equal(repositories.deleteKnowledge(secondKnowledge.id), true);
  assert.equal(await repositories.deleteExercise(firstExercise.id), true);
  assert.equal(repositories.getExercise(secondExercise.id)?.position, 0);
  assert.equal(await repositories.deleteExercise(secondExercise.id), true);
  assert.equal(repositories.deleteFolder(knowledgeFolder.id), true);
  assert.equal(repositories.deleteFolder(exerciseFolder.id), true);
});

test("folder positions remain contiguous within each type and parent", () => {
  const knowledgeScope = repositories.createFolder({
    type: "knowledge",
    name: "Order knowledge scope",
  });
  const knowledgeA = repositories.createFolder({
    type: "knowledge",
    parentId: knowledgeScope.id,
    name: "Order A",
  });
  const knowledgeB = repositories.createFolder({
    type: "knowledge",
    parentId: knowledgeScope.id,
    name: "Order B",
  });
  const knowledgeC = repositories.createFolder({
    type: "knowledge",
    parentId: knowledgeScope.id,
    name: "Order C",
  });
  const sourceParent = repositories.createFolder({
    type: "knowledge",
    parentId: knowledgeScope.id,
    name: "Order source parent",
  });
  const childA = repositories.createFolder({
    type: "knowledge",
    parentId: sourceParent.id,
    name: "Order child A",
  });
  const childB = repositories.createFolder({
    type: "knowledge",
    parentId: sourceParent.id,
    name: "Order child B",
  });
  const targetParent = repositories.createFolder({
    type: "knowledge",
    parentId: knowledgeScope.id,
    name: "Order target parent",
  });
  const targetChild = repositories.createFolder({
    type: "knowledge",
    parentId: targetParent.id,
    name: "Order target child",
  });
  const exerciseScope = repositories.createFolder({
    type: "exercise",
    name: "Order exercise scope",
  });
  const exerciseA = repositories.createFolder({
    type: "exercise",
    parentId: exerciseScope.id,
    name: "Order A",
  });
  const exerciseB = repositories.createFolder({
    type: "exercise",
    parentId: exerciseScope.id,
    name: "Order B",
  });

  repositories.updateFolder(knowledgeC.id, { position: 0 });
  assert.deepEqual(
    foldersUnder("knowledge", knowledgeScope.id).map(({ id }) => id),
    [knowledgeC.id, knowledgeA.id, knowledgeB.id, sourceParent.id, targetParent.id],
  );
  assert.deepEqual(
    foldersUnder("knowledge", knowledgeScope.id).map(({ position }) => position),
    [0, 1, 2, 3, 4],
  );
  assert.deepEqual(
    foldersUnder("exercise", exerciseScope.id).map(({ id, position }) => [id, position]),
    [[exerciseA.id, 0], [exerciseB.id, 1]],
  );

  repositories.updateFolder(childB.id, { position: 0 });
  assert.deepEqual(
    childFolders(sourceParent.id).map(({ id, position }) => [id, position]),
    [[childB.id, 0], [childA.id, 1]],
  );
  assert.throws(
    () => repositories.updateFolder(childB.id, { position: -1 }),
    /non-negative integer/i,
  );
  assert.throws(
    () => repositories.updateFolder(childB.id, { position: 0.5 }),
    /non-negative integer/i,
  );
  assert.throws(
    () => repositories.updateFolder(childB.id, { position: 99 }),
    /sibling range/i,
  );
  assert.deepEqual(
    childFolders(sourceParent.id).map(({ id, position }) => [id, position]),
    [[childB.id, 0], [childA.id, 1]],
  );

  const moved = repositories.updateFolder(childB.id, { parentId: targetParent.id });
  assert.equal(moved.position, 1);
  assert.deepEqual(
    childFolders(sourceParent.id).map(({ id, position }) => [id, position]),
    [[childA.id, 0]],
  );
  assert.deepEqual(
    childFolders(targetParent.id).map(({ id, position }) => [id, position]),
    [[targetChild.id, 0], [childB.id, 1]],
  );

  repositories.updateFolder(childB.id, { position: 0 });
  assert.equal(repositories.deleteFolder(targetChild.id), true);
  assert.deepEqual(
    childFolders(targetParent.id).map(({ id, position }) => [id, position]),
    [[childB.id, 0]],
  );
});

function foldersUnder(type: "knowledge" | "exercise", parentId: number) {
  return repositories.listFolders(type).filter((folder) => folder.parentId === parentId);
}

function childFolders(parentId: number) {
  return repositories.listFolders("knowledge").filter((folder) => folder.parentId === parentId);
}

test("knowledge page moves preserve tree invariants", () => {
  const source = repositories.createFolder({ type: "knowledge", name: "Tree source" });
  const target = repositories.createFolder({ type: "knowledge", name: "Tree target" });
  const root = repositories.createKnowledge({ folderId: source.id, title: "Tree root" });
  const child = repositories.createKnowledge({
    folderId: source.id,
    parentId: root.id,
    title: "Tree child",
  });
  const grandchild = repositories.createKnowledge({
    folderId: source.id,
    parentId: child.id,
    title: "Tree grandchild",
  });

  assert.throws(
    () => repositories.updateKnowledge(root.id, { parentId: grandchild.id }),
    /cycle|itself|descendant/i,
  );
  assert.throws(
    () => repositories.createKnowledge({ folderId: target.id, parentId: root.id, title: "Wrong folder" }),
    /same folder/i,
  );
  assert.throws(() => repositories.deleteKnowledge(root.id), /cannot be deleted|child/i);

  const moved = repositories.updateKnowledge(root.id, { folderId: target.id });
  assert.equal(moved.parentId, null);
  assert.deepEqual(
    [root.id, child.id, grandchild.id].map((id) => repositories.getKnowledge(id)?.folderId),
    [target.id, target.id, target.id],
  );
  assert.equal(repositories.getKnowledge(child.id)?.parentId, root.id);
  assert.equal(repositories.getKnowledge(grandchild.id)?.parentId, child.id);

  const sourceParent = repositories.createKnowledge({ folderId: source.id, title: "Source parent" });
  const detached = repositories.createKnowledge({
    folderId: source.id,
    parentId: sourceParent.id,
    title: "Detach on move",
  });
  const detachedChild = repositories.createKnowledge({
    folderId: source.id,
    parentId: detached.id,
    title: "Move with parent",
  });
  assert.equal(repositories.updateKnowledge(detached.id, { folderId: target.id }).parentId, null);
  assert.equal(repositories.getKnowledge(detachedChild.id)?.folderId, target.id);
  assert.equal(
    repositories.updateKnowledge(detached.id, { parentId: root.id }).parentId,
    root.id,
  );
});

test("search ranks exact titles before newer body matches within each group", () => {
  const knowledgeFolder = repositories.createFolder({
    type: "knowledge",
    name: "Search ranking knowledge",
  });
  const exerciseFolder = repositories.createFolder({
    type: "exercise",
    name: "Search ranking exercises",
  });
  const query = "Zeta rank before pagination";
  const exactKnowledge = repositories.createKnowledge({
    folderId: knowledgeFolder.id,
    title: query,
  });
  repositories.createKnowledge({
    folderId: knowledgeFolder.id,
    title: "A newer knowledge body match",
    contentMd: `This body contains ${query}.`,
  });
  const exactExercise = repositories.createExercise({
    folderId: exerciseFolder.id,
    title: query,
    problemMd: "Exact-title problem",
  });
  repositories.createExercise({
    folderId: exerciseFolder.id,
    title: "A newer exercise solution match",
    problemMd: "Body-match problem",
    solutionMd: `This solution contains ${query}.`,
  });

  const results = repositories.searchArchive(query);

  assert.equal(results.knowledge[0]?.id, exactKnowledge.id);
  assert.equal(results.exercises[0]?.id, exactExercise.id);
});
