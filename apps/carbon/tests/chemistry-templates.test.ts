import assert from "node:assert/strict";
import test from "node:test";

import { extractWikilinks } from "@babel-apps/markdown/core";

import { shouldConfirmTemplateContentReplacement } from "@/components/note-template-state";
import {
  CHEMISTRY_TEMPLATES,
  resolveNoteTemplateContent,
  type ChemistryTemplateId,
} from "@/lib/chemistry-templates";

test("chemistry starters resolve to editable Markdown drafts without custom templates", () => {
  const expectedIds: ChemistryTemplateId[] = [
    "chemistry:concept",
    "chemistry:reaction",
    "chemistry:experiment",
  ];
  assert.deepEqual(CHEMISTRY_TEMPLATES.map((template) => template.id), expectedIds);

  for (const template of CHEMISTRY_TEMPLATES) {
    const content = resolveNoteTemplateContent(template.id, []);
    assert.equal(content, template.contentMd);
    assert.ok(content?.startsWith(`# ${template.name}\n`));
    assert.ok(template.description.length > 0);
    assert.equal(shouldConfirmTemplateContentReplacement("", content ?? "", false), false);
    assert.equal(shouldConfirmTemplateContentReplacement("My observations", content ?? "", false), true);
    assert.equal(shouldConfirmTemplateContentReplacement("", content ?? "", true), true);
  }
});

test("starter prompts do not create note links before the user authors them", () => {
  for (const template of CHEMISTRY_TEMPLATES) {
    assert.deepEqual(extractWikilinks(template.contentMd), [], template.id);
  }
});

test("built-in starter IDs remain separate from editable custom templates", () => {
  const customTemplates = [
    { id: 1, contentMd: "# My concept template\n\nA personal outline." },
    { id: 2, contentMd: "# My lab template\n\nPersonal fields." },
  ];
  const originalTemplates = structuredClone(customTemplates);

  assert.equal(resolveNoteTemplateContent("1", customTemplates), customTemplates[0].contentMd);
  assert.equal(resolveNoteTemplateContent("2", customTemplates), customTemplates[1].contentMd);
  assert.equal(
    resolveNoteTemplateContent("chemistry:concept", customTemplates),
    CHEMISTRY_TEMPLATES[0].contentMd,
  );
  assert.equal(resolveNoteTemplateContent("", customTemplates), "");
  assert.equal(resolveNoteTemplateContent("chemistry:unknown", customTemplates), undefined);
  assert.equal(resolveNoteTemplateContent("999", customTemplates), undefined);
  assert.equal(resolveNoteTemplateContent("01", customTemplates), undefined);
  assert.deepEqual(customTemplates, originalTemplates);
});
