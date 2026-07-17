import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");

const editorTargets = [
  ["ReTex Knowledge", "apps/retex/src/components/knowledge-detail.tsx"],
  ["ReTex Exercise", "apps/retex/src/components/exercise-detail.tsx"],
  ["Vali Notes", "apps/vali/src/components/note-detail.tsx"],
  ["Vali Reflection", "apps/vali/src/components/reflection-workspace.tsx"],
  ["Neum", "apps/neum/src/components/entry-detail.tsx"],
  ["Esperanto", "apps/esperanto/src/components/note-detail.tsx"],
  ["Herodotus", "apps/herodotus/src/components/note-detail.tsx"],
  ["Leviathan", "apps/leviathan/src/components/note-detail.tsx"],
  ["mirror-app template", "templates/mirror-app/src/components/note-detail.tsx"],
] as const;

test("every edit-mode Markdown surface uses the focused editor window", async () => {
  for (const [label, relativePath] of editorTargets) {
    const source = await readFile(path.join(root, relativePath), "utf8");
    assert.match(
      source,
      /from "@babel-apps\/markdown\/detached-editor"/,
      `${label} must import the shared detached editor seam`,
    );
    assert.equal(
      (source.match(/<DetachedEditorWindow/g) ?? []).length,
      1,
      `${label} must render exactly one focused editor host`,
    );
    assert.match(
      source,
      /prepareDetachedEditorWindow\(\{[\s\S]*?closest<HTMLElement>\("\.detail-panel"\)/,
      `${label} must pre-open the editor against its detail panel during Edit`,
    );
    assert.match(
      source,
      /onSave=\{(?:onSave|\(\) => formRef\.current\?\.requestSubmit\(\))\}/,
      `${label} must preserve the save shortcut from the focused window`,
    );
    assert.doesNotMatch(
      source,
      /footerExtras=/,
      `${label} must keep metadata and auxiliary fields out of the focused window`,
    );
  }
});

test("specialized editors keep relationship and code metadata in the main form", async () => {
  const [knowledge, exercise, neum] = await Promise.all([
    readFile(path.join(root, "apps/retex/src/components/knowledge-detail.tsx"), "utf8"),
    readFile(path.join(root, "apps/retex/src/components/exercise-detail.tsx"), "utf8"),
    readFile(path.join(root, "apps/neum/src/components/entry-detail.tsx"), "utf8"),
  ]);

  assert.ok(
    knowledge.indexOf("</DetachedEditorWindow>") < knowledge.indexOf('legend="Link Exercises"'),
    "ReTex Knowledge relationships must remain after the focused editor host",
  );
  assert.match(exercise, /className="babel-detached-editor-sections"/);
  assert.ok(
    exercise.indexOf("</ExerciseEditorHost>") < exercise.indexOf('legend="Link Knowledge"'),
    "ReTex Exercise relationships must remain after the focused editor host",
  );
  assert.ok(
    neum.indexOf("</DetachedEditorWindow>") < neum.indexOf('aria-label="Code snippet fields"'),
    "Neum snippet metadata must remain after the focused editor host",
  );
});
