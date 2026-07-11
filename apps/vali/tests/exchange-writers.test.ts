import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  assertVaultSnapshotsEqual,
  auditVaultSnapshots,
  VaultAuditError,
} from "../src/lib/exchange/audit";
import {
  serializeCategoriesJson,
  serializeValiJson,
} from "../src/lib/exchange/json-writer";
import { readLegacyVault } from "../src/lib/exchange/legacy-reader";
import {
  planTrashMarkdownFiles,
  serializeEntryMarkdown,
  writeLegacyVault,
} from "../src/lib/exchange/markdown-writer";
import type { VaultSnapshot } from "../src/lib/exchange/types";

const snapshot: VaultSnapshot = {
  config: {
    name: "估值库 Vali",
    version: 1,
    createdAt: "2026-07-11T01:02:03Z",
    defaultCategoryId: "cat_watchlist",
  },
  categories: [
    {
      id: "cat_owned",
      name: "Owned",
      order: 2,
      content: "# 已持有\n",
      createdAt: "2026-07-11T01:02:03Z",
      updatedAt: "2026-07-11T02:00:00Z",
    },
    {
      id: "cat_watchlist",
      name: "观察清单",
      order: 1,
      content: "说明末尾空行保留\n\n",
      createdAt: "2026-07-11T01:02:03Z",
      updatedAt: "2026-07-11T01:30:00Z",
    },
  ],
  entries: [
    {
      id: "ent_unicode",
      title: "台積電 \"先进制程\"",
      aliases: ["TSM", "2330", "臺灣積體電路"],
      categoryId: "cat_watchlist",
      order: 7,
      content: "  leading spaces stay\n\n尾行的空格保留  \n\n",
      createdAt: "2026-07-11T03:04:05Z",
      updatedAt: "2026-07-11T06:07:08Z",
    },
  ],
  reflections: [
    { date: "2026-07-11", content: "# 今日反思\n\nExact trailing lines.\n\n" },
    { date: "2026-07-10", content: "" },
  ],
  trash: [
    {
      sourceName: "ent_old.md",
      originalEntryId: "ent_old",
      deletedAt: null,
      entry: {
        id: "ent_old",
        title: "旧档案",
        aliases: ["legacy", "旧"],
        categoryId: "cat_owned",
        order: 3,
        content: "Archived exactly.\n",
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-02T00:00:00Z",
      },
    },
    {
      sourceName: null,
      originalEntryId: "ent_repeat",
      deletedAt: "2026-07-11T11:22:33Z",
      entry: {
        id: "ent_repeat",
        title: "Repeated deletion A",
        aliases: ["first", "second"],
        categoryId: "cat_watchlist",
        order: 4,
        content: "First occurrence\n\n",
        createdAt: "2026-02-01T00:00:00Z",
        updatedAt: "2026-07-11T11:20:00Z",
      },
    },
    {
      sourceName: null,
      originalEntryId: "ent_repeat",
      deletedAt: "2026-07-11T11:22:33Z",
      entry: {
        id: "ent_repeat",
        title: "Repeated deletion B",
        aliases: ["first", "second"],
        categoryId: "cat_watchlist",
        order: 5,
        content: "Second occurrence\n",
        createdAt: "2026-03-01T00:00:00Z",
        updatedAt: "2026-07-11T11:21:00Z",
      },
    },
  ],
};

test("deterministic JSON uses legacy fields, canonical category order, and Unicode", () => {
  assert.equal(
    serializeValiJson(snapshot.config),
    `${JSON.stringify(
      {
        name: "估值库 Vali",
        version: 1,
        createdAt: "2026-07-11T01:02:03Z",
        defaultCategoryId: "cat_watchlist",
      },
      null,
      2,
    )}\n`,
  );

  const categoryJson = serializeCategoriesJson(snapshot.categories);
  assert.deepEqual(
    JSON.parse(categoryJson),
    [snapshot.categories[1], snapshot.categories[0]],
  );
  assert.ok(categoryJson.includes("观察清单"));
  assert.ok(categoryJson.endsWith("\n"));
});

test("entry frontmatter is deterministic without trimming or normalizing its body", () => {
  const entry = snapshot.entries[0];
  const rendered = serializeEntryMarkdown(entry);
  const expectedFrontmatter = [
    "---",
    'id: "ent_unicode"',
    'title: "台積電 \\"先进制程\\""',
    "aliases:",
    '  - "TSM"',
    '  - "2330"',
    '  - "臺灣積體電路"',
    'categoryId: "cat_watchlist"',
    "order: 7",
    'createdAt: "2026-07-11T03:04:05Z"',
    'updatedAt: "2026-07-11T06:07:08Z"',
    "---",
  ].join("\n");

  assert.equal(rendered, `${expectedFrontmatter}\n\n${entry.content}`);
  assert.ok(rendered.endsWith(entry.content));
});

test("trash planning preserves legacy names and deterministically avoids collisions", () => {
  const planned = planTrashMarkdownFiles(snapshot.trash);
  assert.deepEqual(
    planned.map((file) => file.fileName),
    [
      "ent_old.md",
      "ent_repeat_20260711112233.md",
      "ent_repeat_20260711112233_2.md",
    ],
  );
  assert.equal(planned[1].trash.entry.title, "Repeated deletion A");
  assert.equal(planned[2].trash.entry.title, "Repeated deletion B");

  const undated = structuredClone(snapshot.trash[0]);
  undated.sourceName = null;
  assert.equal(
    planTrashMarkdownFiles([undated])[0].fileName,
    "ent_old_00000000000000.md",
  );
});

test("writeLegacyVault creates all legacy files and preserves exact Markdown", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "vali-exchange-"));
  try {
    await writeLegacyVault(snapshot, root);

    assert.equal(
      await readFile(path.join(root, "vali.json"), "utf8"),
      serializeValiJson(snapshot.config),
    );
    assert.equal(
      await readFile(path.join(root, "categories.json"), "utf8"),
      serializeCategoriesJson(snapshot.categories),
    );
    assert.equal(
      await readFile(path.join(root, "entries", "ent_unicode.md"), "utf8"),
      serializeEntryMarkdown(snapshot.entries[0]),
    );
    assert.equal(
      await readFile(path.join(root, "reflections", "2026-07-11.md"), "utf8"),
      snapshot.reflections[0].content,
    );
    assert.equal(
      await readFile(path.join(root, "reflections", "2026-07-10.md"), "utf8"),
      "",
    );
    assert.deepEqual((await readdir(path.join(root, "trash"))).sort(), [
      "ent_old.md",
      "ent_repeat_20260711112233.md",
      "ent_repeat_20260711112233_2.md",
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("written legacy output preserves trash deletion timestamps", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "vali-exchange-roundtrip-"));
  try {
    await writeLegacyVault(snapshot, root);
    const roundTripped = await readLegacyVault(root);
    const report = assertVaultSnapshotsEqual(snapshot, roundTripped);

    assert.deepEqual(
      roundTripped.trash.map((item) => item.deletedAt),
      snapshot.trash.map((item) => item.deletedAt),
    );
    assert.equal(report.equal, true);
    assert.equal(report.errors.length, 0);
    assert.equal(report.warnings.length, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("written legacy output preserves leading Markdown newlines", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "vali-exchange-leading-newlines-"));
  const withLeadingNewlines = structuredClone(snapshot);
  withLeadingNewlines.entries[0].content = "\n\n# Heading\n";

  try {
    await writeLegacyVault(withLeadingNewlines, root);
    const roundTripped = await readLegacyVault(root);

    assert.equal(
      roundTripped.entries[0].content,
      withLeadingNewlines.entries[0].content,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("semantic audit compares every entity and ordered aliases", () => {
  const identical = structuredClone(snapshot);
  const successful = assertVaultSnapshotsEqual(snapshot, identical);
  assert.equal(successful.equal, true);
  assert.deepEqual(successful.errors, []);
  assert.deepEqual(successful.warnings, []);
  assert.deepEqual(successful.counts.source, {
    config: 1,
    categories: 2,
    entries: 1,
    reflections: 2,
    trash: 3,
  });
  assert.deepEqual(successful.counts.compared, successful.counts.source);

  const changed = structuredClone(snapshot);
  changed.config.name = "Changed";
  changed.categories[1].content = "changed category body";
  changed.entries[0].aliases = ["2330", "TSM", "臺灣積體電路"];
  changed.entries[0].categoryId = "cat_missing";
  changed.reflections[0].content = "changed reflection";
  changed.trash[0].sourceName = "renamed.md";
  changed.trash[1].entry.content = "changed trash body";

  const report = auditVaultSnapshots(snapshot, changed);
  const codes = new Set(report.errors.map((issue) => issue.code));
  assert.equal(report.equal, false);
  assert.ok(codes.has("config.field_mismatch"));
  assert.ok(codes.has("category.field_mismatch"));
  assert.ok(codes.has("entry.alias_order_mismatch"));
  assert.ok(codes.has("entry.field_mismatch"));
  assert.ok(codes.has("reflection.field_mismatch"));
  assert.ok(codes.has("relationship.entry_category_missing"));
  assert.ok(codes.has("trash.missing"));
  assert.ok(codes.has("trash.extra"));
  assert.equal(report.counts.errors, report.errors.length);

  assert.throws(
    () => assertVaultSnapshotsEqual(snapshot, changed),
    (error) => error instanceof VaultAuditError && error.report.errors.length > 0,
  );
});

test("audit rejects missing trash deletion timestamps", () => {
  const exportedAndRead = structuredClone(snapshot);
  const plans = planTrashMarkdownFiles(snapshot.trash);
  for (const plan of plans) {
    if (snapshot.trash[plan.sourceIndex].sourceName === null) {
      exportedAndRead.trash[plan.sourceIndex].sourceName = plan.fileName;
      exportedAndRead.trash[plan.sourceIndex].deletedAt = null;
    }
  }

  const report = auditVaultSnapshots(snapshot, exportedAndRead);
  assert.equal(report.equal, false);
  assert.equal(report.errors.length, 2);
  assert.equal(report.warnings.length, 0);
  assert.ok(
    report.errors.every(
      (error) => error.code === "trash.deleted_at_mismatch",
    ),
  );
  assert.throws(
    () => assertVaultSnapshotsEqual(snapshot, exportedAndRead),
    (error) => error instanceof VaultAuditError,
  );
});
