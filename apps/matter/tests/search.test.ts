import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import type { SearchResultsDto } from "../src/lib/types";

let temporaryDirectory = "";
let database: typeof import("../src/lib/db/client");
let repositories: typeof import("../src/lib/repositories");
let searchRoute: typeof import("../src/app/api/search/route");

before(async () => {
  temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "matter-search-test-"));
  process.env.MATTER_DATABASE_PATH = path.join(temporaryDirectory, "sqlite.db");
  database = await import("../src/lib/db/client");
  migrate(database.db, { migrationsFolder: path.join(process.cwd(), "drizzle") });
  [repositories, searchRoute] = await Promise.all([
    import("../src/lib/repositories"),
    import("../src/app/api/search/route"),
  ]);
});

after(() => {
  database.sqlite.close();
  const resolved = path.resolve(temporaryDirectory);
  const temporaryRoot = path.resolve(os.tmpdir());
  assert.ok(resolved.startsWith(`${temporaryRoot}${path.sep}matter-search-test-`));
  rmSync(resolved, { recursive: true, force: true });
});

test("Knowledge and Exercise keep independent relevance tiers", () => {
  const knowledgeFolder = repositories.createFolder({
    type: "knowledge",
    name: "Search tiers knowledge",
  });
  const exerciseFolder = repositories.createFolder({
    type: "exercise",
    name: "Search tiers exercises",
  });
  const query = "Matter tier C++ 7f3";
  const exactKnowledge = repositories.createKnowledge({
    folderId: knowledgeFolder.id,
    title: query,
  });
  const prefixKnowledge = repositories.createKnowledge({
    folderId: knowledgeFolder.id,
    title: `${query} prefix`,
  });
  const tagKnowledge = repositories.createKnowledge({
    folderId: knowledgeFolder.id,
    title: "Knowledge exact tag",
    tags: [query],
  });
  const titleKnowledge = repositories.createKnowledge({
    folderId: knowledgeFolder.id,
    title: `Before ${query} after`,
  });
  const metadataKnowledge = repositories.createKnowledge({
    folderId: knowledgeFolder.id,
    title: "Knowledge tag contains",
    tags: [`tag-${query}-tag`],
  });
  const bodyKnowledge = repositories.createKnowledge({
    folderId: knowledgeFolder.id,
    title: "Knowledge body",
    contentMd: `Only content contains ${query}.`,
  });

  const exactExercise = createExercise(exerciseFolder.id, query, "exact");
  const prefixExercise = createExercise(exerciseFolder.id, `${query} prefix`, "prefix");
  const tagExercise = createExercise(exerciseFolder.id, "Exercise exact tag", "exact-tag", {
    tags: [query],
  });
  const titleExercise = createExercise(
    exerciseFolder.id,
    `Before ${query} after`,
    "title-contains",
  );
  const metadataExercise = createExercise(
    exerciseFolder.id,
    "Exercise tag contains",
    "tag-contains",
    { tags: [`tag-${query}-tag`] },
  );
  const bodyExercise = createExercise(exerciseFolder.id, "Exercise solution", "solution", {
    solutionMd: `Only solution contains ${query}.`,
  });

  const results = repositories.searchArchive(query);

  assert.deepEqual(results.knowledge.map(({ id }) => id), [
    exactKnowledge.id,
    prefixKnowledge.id,
    tagKnowledge.id,
    titleKnowledge.id,
    metadataKnowledge.id,
    bodyKnowledge.id,
  ]);
  assert.deepEqual(results.exercises.map(({ id }) => id), [
    exactExercise.id,
    prefixExercise.id,
    tagExercise.id,
    titleExercise.id,
    metadataExercise.id,
    bodyExercise.id,
  ]);
  assert.deepEqual(results.knowledge[0]?.match.matchedFields, ["title"]);
  assert.equal(results.knowledge[0]?.match.snippet.field, "title");
  assert.deepEqual(results.knowledge[2]?.match.matchedFields, ["tags"]);
  assert.equal(results.knowledge[2]?.match.snippet.field, "tags");
  assert.deepEqual(results.exercises[5]?.match.matchedFields, ["solution"]);
  assert.equal(results.exercises[5]?.match.snippet.field, "solution");
});

test("Knowledge and Exercise paginate independently without changing rank order", () => {
  const knowledgeFolder = repositories.createFolder({
    type: "knowledge",
    name: "Paged knowledge",
  });
  const exerciseFolder = repositories.createFolder({
    type: "exercise",
    name: "Paged exercises",
  });
  const query = "matter-pagination-needle";
  const exactKnowledge = repositories.createKnowledge({
    folderId: knowledgeFolder.id,
    title: query,
  });
  const bodyKnowledge = repositories.createKnowledge({
    folderId: knowledgeFolder.id,
    title: "Paged knowledge body",
    contentMd: query,
  });
  const exactExercise = createExercise(
    exerciseFolder.id,
    query,
    "paged-exact",
  );
  const bodyExercise = createExercise(
    exerciseFolder.id,
    "Paged exercise body",
    "paged-body",
    { solutionMd: query },
  );

  const first = repositories.searchArchive(query, { limit: 1 });
  const second = repositories.searchArchive(query, {
    limit: 1,
    knowledgeOffset: 1,
    exerciseOffset: 1,
  });
  assert.equal(first.knowledgeTotal, 2);
  assert.equal(first.exerciseTotal, 2);
  assert.deepEqual(first.knowledge.map(({ id }) => id), [exactKnowledge.id]);
  assert.deepEqual(first.exercises.map(({ id }) => id), [exactExercise.id]);
  assert.deepEqual(second.knowledge.map(({ id }) => id), [bodyKnowledge.id]);
  assert.deepEqual(second.exercises.map(({ id }) => id), [bodyExercise.id]);
});

test("search tie breakers use field count, capped occurrences, position, updated time, and id", () => {
  const folder = repositories.createFolder({ type: "knowledge", name: "Search ties" });

  const fieldQuery = "Matter field count 8g4";
  const multipleFields = repositories.createKnowledge({
    folderId: folder.id,
    title: fieldQuery,
    contentMd: fieldQuery,
  });
  repositories.createKnowledge({ folderId: folder.id, title: fieldQuery });
  assert.equal(repositories.searchArchive(fieldQuery).knowledge[0]?.id, multipleFields.id);

  const occurrenceQuery = "Matter occurrence 4p2";
  const twice = repositories.createKnowledge({
    folderId: folder.id,
    title: "Two content occurrences",
    contentMd: `${occurrenceQuery} then ${occurrenceQuery}`,
  });
  repositories.createKnowledge({
    folderId: folder.id,
    title: "One content occurrence",
    contentMd: occurrenceQuery,
  });
  assert.equal(repositories.searchArchive(occurrenceQuery).knowledge[0]?.id, twice.id);

  const cappedQuery = "Matter capped count 2k6";
  const earlierPosition = repositories.createKnowledge({
    folderId: folder.id,
    title: "Five capped occurrences",
    contentMd: Array.from({ length: 5 }, () => cappedQuery).join(" "),
  });
  repositories.createKnowledge({
    folderId: folder.id,
    title: "Six later occurrences",
    contentMd: `Padding before. ${Array.from({ length: 6 }, () => cappedQuery).join(" ")}`,
  });
  assert.equal(repositories.searchArchive(cappedQuery).knowledge[0]?.id, earlierPosition.id);

  const stableQuery = "Matter stable order 5m1";
  const first = repositories.createKnowledge({
    folderId: folder.id,
    title: "First stable result",
    contentMd: stableQuery,
  });
  const second = repositories.createKnowledge({
    folderId: folder.id,
    title: "Second stable result",
    contentMd: stableQuery,
  });
  database.sqlite.prepare("UPDATE knowledge_note SET updated_at = ? WHERE id = ?")
    .run("2026-01-02 00:00:00", first.id);
  database.sqlite.prepare("UPDATE knowledge_note SET updated_at = ? WHERE id = ?")
    .run("2026-01-01 00:00:00", second.id);
  assert.equal(repositories.searchArchive(stableQuery).knowledge[0]?.id, first.id);
  database.sqlite.prepare("UPDATE knowledge_note SET updated_at = ? WHERE id IN (?, ?)")
    .run("2026-01-03 00:00:00", first.id, second.id);
  assert.equal(repositories.searchArchive(stableQuery).knowledge[0]?.id, second.id);

  const emojiQuery = "Matter emoji position 9q3";
  const emojiEarlier = repositories.createKnowledge({
    folderId: folder.id,
    title: "Earlier by Unicode text position",
    contentMd: `😀😀😀${emojiQuery}`,
  });
  repositories.createKnowledge({
    folderId: folder.id,
    title: "Later by Unicode text position",
    contentMd: `xxxxx${emojiQuery}`,
  });
  assert.equal(repositories.searchArchive(emojiQuery).knowledge[0]?.id, emojiEarlier.id);
});

test("search includes problem and answer, excludes scratch, and returns bounded API match data", async () => {
  const knowledgeFolder = repositories.createFolder({
    type: "knowledge",
    name: "Search API knowledge",
  });
  const exerciseFolder = repositories.createFolder({
    type: "exercise",
    name: "Search API exercises",
  });
  const excludedQuery = "excluded-field-token";
  const problemMatch = createExercise(exerciseFolder.id, "Problem field", "problem", {
    problemMd: excludedQuery,
  });
  const answerMatch = createExercise(exerciseFolder.id, "Answer field", "answer", {
    answerMd: excludedQuery,
  });
  const scratchOnly = createExercise(exerciseFolder.id, "Scratch only", "scratch");
  repositories.upsertScratch(scratchOnly.id, excludedQuery);
  const fieldResults = repositories.searchArchive(excludedQuery);
  assert.deepEqual(
    fieldResults.exercises.map(({ id }) => id).sort((left, right) => left - right),
    [problemMatch.id, answerMatch.id].sort((left, right) => left - right),
  );
  assert.deepEqual(
    fieldResults.exercises.find(({ id }) => id === problemMatch.id)?.match.matchedFields,
    ["problem"],
  );
  assert.deepEqual(
    fieldResults.exercises.find(({ id }) => id === answerMatch.id)?.match.matchedFields,
    ["answer"],
  );

  const query = "api-search-only";
  const knowledge = repositories.createKnowledge({
    folderId: knowledgeFolder.id,
    title: query,
  });
  const exercise = createExercise(exerciseFolder.id, query, "api-result");
  const response = await searchRoute.GET(
    new Request(`http://localhost/api/search?q=${encodeURIComponent(query)}`),
  );
  assert.equal(response.status, 200);
  const results = (await response.json()) as SearchResultsDto;
  assert.deepEqual(results.knowledge.map(({ id }) => id), [knowledge.id]);
  assert.deepEqual(results.exercises.map(({ id }) => id), [exercise.id]);
  const knowledgeResult = results.knowledge[0];
  const exerciseResult = results.exercises[0];
  assert.ok(knowledgeResult);
  assert.ok(exerciseResult);
  for (const result of [knowledgeResult, exerciseResult]) {
    assert.equal(Object.hasOwn(result, "contentMd"), false);
    assert.equal(Object.hasOwn(result, "problemMd"), false);
    assert.equal(Object.hasOwn(result, "solutionMd"), false);
    assert.equal(Object.hasOwn(result, "answerMd"), false);
    assert.equal(Object.hasOwn(result, "score"), false);
    assert.equal(Object.hasOwn(result, "rank"), false);
    assert.equal(result.match.snippet.field, "title");
    assert.ok(result.match.title.some(({ highlighted }) => highlighted));
  }
});

test("search keeps special characters literal and highlights tag-only matches", () => {
  const folder = repositories.createFolder({ type: "knowledge", name: "Search literals" });
  const tag = "C++ %_\\ 😀";
  const item = repositories.createKnowledge({
    folderId: folder.id,
    title: "ASCII NEEDLE 中文",
    tags: [tag],
  });

  for (const query of ["ascii needle", "中文", "C++", "%", "_", "\\", "😀"]) {
    assert.ok(repositories.searchArchive(query).knowledge.some(({ id }) => id === item.id));
  }
  const tagMatch = repositories.searchArchive("C++").knowledge.find(({ id }) => id === item.id);
  assert.ok(tagMatch);
  assert.deepEqual(tagMatch.match.matchedFields, ["tags"]);
  assert.equal(tagMatch.match.snippet.field, "tags");
  assert.ok(tagMatch.match.tags[0]?.parts.some(({ highlighted }) => highlighted));
});

test("raw JSON-only tag hits keep compatibility without claiming a title highlight", () => {
  const knowledgeFolder = repositories.createFolder({
    type: "knowledge",
    name: "Raw tag compatibility knowledge",
  });
  const exerciseFolder = repositories.createFolder({
    type: "exercise",
    name: "Raw tag compatibility exercises",
  });
  const knowledge = repositories.createKnowledge({
    folderId: knowledgeFolder.id,
    title: "Knowledge raw tag compatibility",
    tags: ["plain-knowledge-tag"],
  });
  const knowledgeBody = repositories.createKnowledge({
    folderId: knowledgeFolder.id,
    title: "Knowledge body quote compatibility",
    contentMd: 'A body-only " match.',
  });
  const exercise = createExercise(
    exerciseFolder.id,
    "Exercise raw tag compatibility",
    "raw-tag-compatibility",
    { tags: ["plain-exercise-tag"] },
  );
  const exerciseBody = createExercise(
    exerciseFolder.id,
    "Exercise body quote compatibility",
    "body-quote-compatibility",
    { solutionMd: 'A solution-only " match.' },
  );

  const results = repositories.searchArchive('"');
  const knowledgeMatch = results.knowledge.find(({ id }) => id === knowledge.id)?.match;
  const exerciseMatch = results.exercises.find(({ id }) => id === exercise.id)?.match;

  assert.ok(
    results.knowledge.findIndex(({ id }) => id === knowledge.id)
      < results.knowledge.findIndex(({ id }) => id === knowledgeBody.id),
  );
  assert.ok(
    results.exercises.findIndex(({ id }) => id === exercise.id)
      < results.exercises.findIndex(({ id }) => id === exerciseBody.id),
  );

  for (const match of [knowledgeMatch, exerciseMatch]) {
    assert.ok(match);
    assert.deepEqual(match.matchedFields, ["tags"]);
    assert.equal(match.snippet.field, "tags");
    assert.deepEqual(match.snippet.parts, [
      { text: "Tag data match", highlighted: false },
    ]);
    assert.equal(match.title.some(({ highlighted }) => highlighted), false);
    assert.equal(match.tags.some((tag) => tag.parts.some(({ highlighted }) => highlighted)), false);
  }
});

function createExercise(
  folderId: number,
  title: string,
  suffix: string,
  overrides: {
    problemMd?: string;
    answerMd?: string;
    solutionMd?: string;
    tags?: string[];
  } = {},
) {
  return repositories.createExercise({
    folderId,
    title,
    problemMd: overrides.problemMd ?? `Problem for ${suffix}`,
    answerMd: overrides.answerMd,
    solutionMd: overrides.solutionMd,
    tags: overrides.tags,
  });
}
