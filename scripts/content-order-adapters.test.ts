import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

interface RegistryDocument {
  apps: Array<{ id: string; workspace: string }>;
}

interface Journal {
  entries: Array<{ tag: string }>;
}

const root = path.resolve(import.meta.dirname, "..");
const registry = JSON.parse(
  await readFile(path.join(root, "babel.apps.json"), "utf8"),
) as RegistryDocument;
const targets = [
  ...registry.apps.map(({ id, workspace }) => ({ id, workspace })),
  { id: "mirror-app", workspace: "templates/mirror-app" },
];

async function migrations(targetRoot: string): Promise<string> {
  const drizzleRoot = path.join(targetRoot, "drizzle");
  const journal = JSON.parse(
    await readFile(path.join(drizzleRoot, "meta/_journal.json"), "utf8"),
  ) as Journal;
  return (await Promise.all(journal.entries.map(({ tag }) =>
    readFile(path.join(drizzleRoot, `${tag}.sql`), "utf8")
  ))).join("\n");
}

test("every content adapter persists sibling order and drags from its selection surface", async (t) => {
  for (const target of targets) {
    await t.test(target.id, async () => {
      const targetRoot = path.join(root, target.workspace);
      const schema = await readFile(path.join(targetRoot, "src/lib/db/schema.ts"), "utf8");
      const types = await readFile(path.join(targetRoot, "src/lib/types.ts"), "utf8");
      const apiClient = await readFile(path.join(targetRoot, "src/lib/api-client.ts"), "utf8");
      const readiness = await readFile(path.join(targetRoot, "src/lib/db/readiness.ts"), "utf8");
      const migrationSource = await migrations(targetRoot);

      if (target.id === "neum") {
        const [repository, route, list, workspace] = await Promise.all([
          readFile(path.join(targetRoot, "src/lib/repositories/entries.ts"), "utf8"),
          readFile(path.join(targetRoot, "src/app/api/entries/[id]/route.ts"), "utf8"),
          readFile(path.join(targetRoot, "src/components/entry-list.tsx"), "utf8"),
          readFile(path.join(targetRoot, "src/components/entries-workspace.tsx"), "utf8"),
        ]);
        assert.match(schema, /entry_scope_position_idx/);
        assert.match(types, /interface EntrySummaryDto[\s\S]*?position\?: number/);
        assert.match(repository, /position\?: number/);
        assert.match(repository, /entries\.position} \+ 1/);
        assert.match(repository, /position: 0/);
        assert.match(repository, /orderBy\(asc\(entries\.position\)/);
        assert.match(route, /optionalNonNegativeInteger\(payload, "position"\)/);
        assert.match(apiClient, /function reorderEntry/);
        assert.match(list, /@babel-apps\/platform\/items\/react/);
        assert.match(list, /\.selectionProps\(entry\.id\)/);
        assert.match(workspace, /handleReorderEntry/);
        assert.match(readiness, /entry: \["parent_id", "position"\]/);
        assert.match(migrationSource, /ALTER TABLE `entry` ADD `position`/);
        assert.match(migrationSource, /PARTITION BY `kind`, `folder_id`, `parent_id`/);
        return;
      }

      if (target.id === "retex" || target.id === "matter") {
        const [knowledge, exercises, knowledgeRoute, exerciseRoute, list, workspace] =
          await Promise.all([
            readFile(path.join(targetRoot, "src/lib/repositories/knowledge.ts"), "utf8"),
            readFile(path.join(targetRoot, "src/lib/repositories/exercises.ts"), "utf8"),
            readFile(path.join(targetRoot, "src/app/api/knowledge/[id]/route.ts"), "utf8"),
            readFile(path.join(targetRoot, "src/app/api/exercises/[id]/route.ts"), "utf8"),
            readFile(path.join(targetRoot, "src/components/item-list.tsx"), "utf8"),
            readFile(path.join(targetRoot, "src/components/archive-workspace.tsx"), "utf8"),
          ]);
        assert.match(schema, /knowledge_scope_position_idx/);
        assert.match(schema, /exercise_folder_position_idx/);
        assert.match(types, /interface KnowledgeSummaryDto[\s\S]*?position\?: number/);
        assert.match(types, /interface ExerciseSummaryDto[\s\S]*?position\?: number/);
        for (const repository of [knowledge, exercises]) {
          assert.match(repository, /position\?: number/);
          assert.match(repository, /position: 0/);
          assert.match(repository, /\.position} \+ 1/);
        }
        assert.match(knowledgeRoute, /optionalNonNegativeInteger\(payload, "position"\)/);
        assert.match(exerciseRoute, /optionalNonNegativeInteger\(body, "position"\)/);
        assert.match(apiClient, /function reorderKnowledge/);
        assert.match(apiClient, /function reorderExercise/);
        assert.match(list, /@babel-apps\/platform\/items\/react/);
        assert.match(list, /\.selectionProps\(item\.id\)/);
        assert.match(workspace, /handleReorderItem/);
        assert.match(readiness, /knowledge_note: \["parent_id", "position"\]/);
        assert.match(readiness, /exercise: \[[^\]]*"position"/);
        assert.match(migrationSource, /ALTER TABLE `knowledge_note` ADD `position`/);
        assert.match(migrationSource, /ALTER TABLE `exercise` ADD `position`/);
        return;
      }

      const [repository, route, list, workspace] = await Promise.all([
        readFile(path.join(targetRoot, "src/lib/repositories/notes.ts"), "utf8"),
        readFile(path.join(targetRoot, "src/app/api/notes/[id]/route.ts"), "utf8"),
        readFile(path.join(targetRoot, "src/components/note-list.tsx"), "utf8"),
        readFile(path.join(targetRoot, "src/components/notes-workspace.tsx"), "utf8"),
      ]);
      assert.match(schema, /note_scope_position_idx/);
      assert.match(types, /interface NoteSummaryDto[\s\S]*?position\?: number/);
      assert.match(repository, /position\?: number/);
      assert.match(repository, /notes\.position} \+ 1/);
      assert.match(repository, /position: 0/);
      assert.match(repository, /orderBy\(asc\(notes\.position\)/);
      assert.match(route, /optionalNonNegativeInteger\(payload, "position"\)/);
      assert.match(apiClient, /function reorderNote/);
      assert.match(list, /@babel-apps\/platform\/items\/react/);
      assert.match(list, /\.selectionProps\(note\.id\)/);
      assert.match(workspace, /handleReorderNote/);
      assert.match(readiness, /note: \["parent_id", "position"\]/);
      assert.match(migrationSource, /ALTER TABLE `note` ADD `position`/);
      assert.match(migrationSource, /PARTITION BY `folder_id`, `parent_id`/);
    });
  }
});

