import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

interface RegistryDocument {
  apps: Array<{ id: string; workspace: string }>;
}

interface SaveHandlerTarget {
  label: string;
  filename: string;
  functionName: string;
}

interface EditorStateTarget {
  label: string;
  filename: string;
  formName?: "NoteForm" | "EntryForm" | "KnowledgeForm" | "ExerciseForm";
  canonicalUpdates: RegExp[];
}

const root = path.resolve(import.meta.dirname, "..");

function sourceFunction(source: string, functionName: string): string {
  const startPattern = new RegExp(`\\b(?:async )?function ${functionName}\\(`);
  const start = startPattern.exec(source)?.index ?? -1;
  assert.notEqual(start, -1, `missing ${functionName} function`);

  const remainder = source.slice(start + 1);
  const nextFunction = /\n  (?:async )?function \w+\(/.exec(remainder);
  return nextFunction === null
    ? source.slice(start)
    : source.slice(start, start + 1 + nextFunction.index);
}

function primarySaveHandler(app: { id: string; workspace: string }): SaveHandlerTarget {
  if (app.id === "retex" || app.id === "matter") {
    return {
      label: app.id,
      filename: path.join(app.workspace, "src", "components", "archive-page-session.tsx"),
      functionName: "handleSaved",
    };
  }
  if (app.id === "neum") {
    return {
      label: app.id,
      filename: path.join(app.workspace, "src", "components", "entry-page-session.tsx"),
      functionName: "handleSaved",
    };
  }
  return {
    label: app.id,
    filename: path.join(app.workspace, "src", "components", "note-page-session.tsx"),
    functionName: "handleSaved",
  };
}

const standardNoteUpdates = [
  /setTitle\(saved\.title\)/,
  /setTags\(saved\.tags\.join\(", "\)\)/,
  /setContent\(saved\.contentMd\)/,
  /setFolderId\(saved\.folderId\)/,
  /setParentId\(saved\.parentId\)/,
];

function editorStateTargets(app: { id: string; workspace: string }): EditorStateTarget[] {
  const components = path.join(app.workspace, "src", "components");
  if (app.id === "retex" || app.id === "matter") {
    return [
      {
        label: `${app.id} Knowledge`,
        filename: path.join(components, "knowledge-detail.tsx"),
        formName: "KnowledgeForm",
        canonicalUpdates: [
          /setTitle\(saved\.title\)/,
          /setTags\(saved\.tags\.join\(", "\)\)/,
          /setContent\(saved\.contentMd\)/,
          /setParentId\(saved\.parentId\)/,
          /setExerciseIds\(saved\.relatedExercises\.map\(\(item\) => item\.id\)\)/,
        ],
      },
      {
        label: `${app.id} Exercise`,
        filename: path.join(components, "exercise-detail.tsx"),
        formName: "ExerciseForm",
        canonicalUpdates: [
          /setTitle\(saved\.title\)/,
          /setTags\(saved\.tags\.join\(", "\)\)/,
          /setProblem\(saved\.problemMd\)/,
          /setAnswer\(saved\.answerMd\)/,
          /setSolution\(saved\.solutionMd\)/,
          /setKnowledgeIds\(saved\.relatedKnowledge\.map\(\(item\) => item\.id\)\)/,
        ],
      },
    ];
  }
  if (app.id === "neum") {
    return [{
      label: app.id,
      filename: path.join(components, "entry-detail.tsx"),
      formName: "EntryForm",
      canonicalUpdates: [
        /setTitle\(saved\.title\)/,
        /setTags\(saved\.tags\.join\(", "\)\)/,
        /setNotesMd\(saved\.notesMd\)/,
        /setCode\(saved\.code \?\? ""\)/,
        /setLanguage\(saved\.language \?\? ""\)/,
        /setFilename\(saved\.filename \?\? ""\)/,
        /setFolderId\(saved\.folderId\)/,
        /setParentId\(saved\.parentId\)/,
      ],
    }];
  }

  const targets: EditorStateTarget[] = [{
    label: app.id,
    filename: path.join(components, "note-detail.tsx"),
    formName: "NoteForm",
    canonicalUpdates: standardNoteUpdates,
  }];
  if (app.id === "vali") {
    targets.push({
      label: "Vali Reflection",
      filename: path.join(components, "reflection-page-session.tsx"),
      canonicalUpdates: [/setContent\(saved\.contentMd\)/],
    });
  }
  return targets;
}

test("every persisted document save keeps its editor open", async () => {
  const registry = JSON.parse(
    await readFile(path.join(root, "babel.apps.json"), "utf8"),
  ) as RegistryDocument;
  const targets: SaveHandlerTarget[] = [
    ...registry.apps.map(primarySaveHandler),
    {
      label: "Vali Reflection",
      filename: path.join("apps", "vali", "src", "components", "reflection-page-session.tsx"),
      functionName: "submit",
    },
    {
      label: "mirror-app template",
      filename: path.join("templates", "mirror-app", "src", "components", "note-page-session.tsx"),
      functionName: "handleSaved",
    },
  ];

  for (const target of targets) {
    const source = await readFile(path.join(root, target.filename), "utf8");
    const handler = sourceFunction(source, target.functionName);
    assert.match(
      handler,
      /setMode\(\w*ModeAfterSave\(/,
      `${target.label} must select edit/view mode from whether the item was already persisted`,
    );
    assert.doesNotMatch(
      handler,
      /setMode\("view"\)/,
      `${target.label} must not unconditionally leave edit mode after saving`,
    );
  }
});

test("every editor rebases onto the saved server document without remounting", async () => {
  const registry = JSON.parse(
    await readFile(path.join(root, "babel.apps.json"), "utf8"),
  ) as RegistryDocument;
  const targets: EditorStateTarget[] = [
    ...registry.apps.flatMap(editorStateTargets),
    {
      label: "mirror-app template",
      filename: path.join("templates", "mirror-app", "src", "components", "note-detail.tsx"),
      formName: "NoteForm",
      canonicalUpdates: standardNoteUpdates,
    },
  ];

  for (const target of targets) {
    const source = await readFile(path.join(root, target.filename), "utf8");
    const submit = sourceFunction(source, "submit");
    assert.match(
      submit,
      /for \(const image of stagedRef\.current\) URL\.revokeObjectURL\(image\.previewUrl\);/,
      `${target.label} must release committed preview URLs`,
    );
    assert.match(
      submit,
      /stagedRef\.current = \[\];[\s\S]*?setStagedImages\(\[\]\);/,
      `${target.label} must clear its committed staged images`,
    );
    for (const update of target.canonicalUpdates) {
      assert.match(
        submit,
        update,
        `${target.label} must adopt every canonical field returned by the server`,
      );
    }

    if (target.formName === undefined) continue;
    const form = new RegExp(
      `<${target.formName}\\s+[\\s\\S]*?key=\\{([\\s\\S]*?)\\}\\s+[\\s\\S]*?draftKey=`,
    ).exec(source);
    assert.ok(form, `${target.label} must give its editor form a stable React key`);
    assert.match(form[1], /detail(?:\?\.|\.)id/);
    assert.doesNotMatch(
      form[1],
      /version/,
      `${target.label} must not remount the editor when a save increments its version`,
    );
  }
});
