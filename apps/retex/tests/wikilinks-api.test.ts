import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

import { migrate } from "drizzle-orm/better-sqlite3/migrator";

let temporaryDirectory = "";
let database: typeof import("../src/lib/db/client");
let repositories: typeof import("../src/lib/repositories");
let knowledgeRoute: typeof import("../src/app/api/knowledge/[id]/route");
let exerciseRoute: typeof import("../src/app/api/exercises/[id]/route");
let knowledgeBacklinksRoute:
  typeof import("../src/app/api/knowledge/[id]/backlinks/route");
let exerciseBacklinksRoute:
  typeof import("../src/app/api/exercises/[id]/backlinks/route");
let titlesRoute: typeof import("../src/app/api/titles/route");

before(async () => {
  temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "retex-links-api-test-"));
  process.env.RETEX_DATABASE_PATH = path.join(temporaryDirectory, "sqlite.db");
  database = await import("../src/lib/db/client");
  migrate(database.db, { migrationsFolder: path.join(process.cwd(), "drizzle") });
  repositories = await import("../src/lib/repositories");
  knowledgeRoute = await import("../src/app/api/knowledge/[id]/route");
  exerciseRoute = await import("../src/app/api/exercises/[id]/route");
  knowledgeBacklinksRoute = await import(
    "../src/app/api/knowledge/[id]/backlinks/route"
  );
  exerciseBacklinksRoute = await import(
    "../src/app/api/exercises/[id]/backlinks/route"
  );
  titlesRoute = await import("../src/app/api/titles/route");
});

after(() => {
  database.sqlite.close();
  const resolved = path.resolve(temporaryDirectory);
  assert.ok(
    resolved.startsWith(`${path.resolve(os.tmpdir())}${path.sep}retex-links-api-test-`),
  );
  rmSync(resolved, { recursive: true, force: true });
});

function context(id: number): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id: String(id) }) };
}

test("detail, backlinks, and titles APIs expose polymorphic wikilinks", async () => {
  const knowledgeFolder = repositories.createFolder({
    type: "knowledge",
    name: "API link knowledge",
  });
  const exerciseFolder = repositories.createFolder({
    type: "exercise",
    name: "API link exercises",
  });
  const knowledgeTarget = repositories.createKnowledge({
    folderId: knowledgeFolder.id,
    title: "API knowledge target",
  });
  const exerciseTarget = repositories.createExercise({
    folderId: exerciseFolder.id,
    title: "API exercise target",
    problemMd: "API target problem",
  });
  const knowledgeSource = repositories.createKnowledge({
    folderId: knowledgeFolder.id,
    title: "API knowledge source",
    contentMd: "[[API knowledge target]] [[API exercise target]]",
  });
  const exerciseSource = repositories.createExercise({
    folderId: exerciseFolder.id,
    title: "API exercise source",
    problemMd: "[[API knowledge target]]",
  });

  const knowledgeDetailResponse = await knowledgeRoute.GET(
    new Request(`http://localhost/api/knowledge/${knowledgeSource.id}`),
    context(knowledgeSource.id),
  );
  assert.equal(knowledgeDetailResponse.status, 200);
  const knowledgeDetail = (await knowledgeDetailResponse.json()) as {
    links: Array<{ titleKey: string; targetKind: string | null; targetId: number | null }>;
  };
  assert.deepEqual(knowledgeDetail.links, [
    {
      titleKey: "api exercise target",
      targetKind: "exercise",
      targetId: exerciseTarget.id,
    },
    {
      titleKey: "api knowledge target",
      targetKind: "knowledge",
      targetId: knowledgeTarget.id,
    },
  ]);

  const exerciseDetailResponse = await exerciseRoute.GET(
    new Request(`http://localhost/api/exercises/${exerciseSource.id}`),
    context(exerciseSource.id),
  );
  assert.equal(exerciseDetailResponse.status, 200);
  const exerciseDetail = (await exerciseDetailResponse.json()) as {
    links: Array<{ titleKey: string; targetKind: string | null; targetId: number | null }>;
  };
  assert.deepEqual(exerciseDetail.links, [
    {
      titleKey: "api knowledge target",
      targetKind: "knowledge",
      targetId: knowledgeTarget.id,
    },
  ]);

  const knowledgeBacklinksResponse = await knowledgeBacklinksRoute.GET(
    new Request(`http://localhost/api/knowledge/${knowledgeTarget.id}/backlinks`),
    context(knowledgeTarget.id),
  );
  assert.equal(knowledgeBacklinksResponse.status, 200);
  const knowledgeBacklinks = (await knowledgeBacklinksResponse.json()) as {
    knowledge: Array<{ id: number }>;
    exercises: Array<{ id: number }>;
  };
  assert.deepEqual(knowledgeBacklinks.knowledge.map(({ id }) => id), [knowledgeSource.id]);
  assert.deepEqual(knowledgeBacklinks.exercises.map(({ id }) => id), [exerciseSource.id]);

  const exerciseBacklinksResponse = await exerciseBacklinksRoute.GET(
    new Request(`http://localhost/api/exercises/${exerciseTarget.id}/backlinks`),
    context(exerciseTarget.id),
  );
  assert.equal(exerciseBacklinksResponse.status, 200);
  const exerciseBacklinks = (await exerciseBacklinksResponse.json()) as {
    knowledge: Array<{ id: number }>;
    exercises: Array<{ id: number }>;
  };
  assert.deepEqual(exerciseBacklinks.knowledge.map(({ id }) => id), [knowledgeSource.id]);
  assert.deepEqual(exerciseBacklinks.exercises, []);

  const titlesResponse = await titlesRoute.GET(
    new Request("http://localhost/api/titles?q=API%20knowledge&limit=20"),
  );
  assert.equal(titlesResponse.status, 200);
  const titles = (await titlesResponse.json()) as Array<{
    id: number;
    title: string;
    kind: string;
  }>;
  assert.deepEqual(
    titles.map(({ title, kind }) => ({ title, kind })),
    [
      { title: "API knowledge source", kind: "knowledge" },
      { title: "API knowledge target", kind: "knowledge" },
    ],
  );

  const invalidLimit = await titlesRoute.GET(
    new Request("http://localhost/api/titles?limit=101"),
  );
  assert.equal(invalidLimit.status, 400);
  const missing = await knowledgeBacklinksRoute.GET(
    new Request("http://localhost/api/knowledge/999999/backlinks"),
    context(999_999),
  );
  assert.equal(missing.status, 404);
});
