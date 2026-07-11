import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import test from "node:test";

import { readLegacyVault } from "../src/lib/exchange/legacy-reader";

test("reads a complete legacy vault without changing the source", async () => {
  const root = await createLegacyVault();

  try {
    const before = await readTree(root);
    const snapshot = await readLegacyVault(root);
    const after = await readTree(root);

    assert.deepEqual(snapshot, {
      config: {
        name: "Vali 測試",
        version: 1,
        createdAt: "2026-07-11T01:02:03Z",
        defaultCategoryId: "cat_watchlist",
      },
      categories: [
        {
          id: "cat_watchlist",
          name: "觀察",
          order: 1,
          content: "",
          createdAt: "2026-07-11T01:02:03Z",
          updatedAt: "2026-07-11T01:02:03Z",
        },
      ],
      entries: [
        {
          id: "ent_active",
          title: "台積電",
          aliases: ["TSM", "2330"],
          categoryId: "cat_watchlist",
          order: 0,
          content: "# Thesis\n\n保留 Unicode。\n",
          createdAt: "2026-07-11T02:00:00Z",
          updatedAt: "2026-07-11T03:00:00Z",
        },
      ],
      reflections: [
        {
          date: "2026-07-10",
          content: "# Reflection\n\n保留內容。\n\n",
        },
      ],
      trash: [
        {
          sourceName: "ent_archived.md",
          originalEntryId: "ent_archived",
          deletedAt: null,
          entry: {
            id: "ent_archived",
            title: "Archived",
            aliases: [],
            categoryId: "cat_watchlist",
            order: 4,
            content: "# Archived\n",
            createdAt: "2026-07-09T01:00:00Z",
            updatedAt: "2026-07-09T02:00:00Z",
          },
        },
      ],
    });
    assert.deepEqual(after, before);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects unknown files instead of silently dropping them", async () => {
  const cases: Array<[string, (root: string) => Promise<void>]> = [
    ["root file", (root) => writeFile(join(root, "unexpected.txt"), "data", "utf8")],
    [
      "entry sidecar",
      (root) => writeFile(join(root, "entries", "unexpected.txt"), "data", "utf8"),
    ],
    ["nested directory", (root) => mkdir(join(root, "trash", "nested"))],
  ];

  for (const [label, mutate] of cases) {
    const root = await createLegacyVault();
    try {
      await mutate(root);
      await assert.rejects(readLegacyVault(root), /unexpected/i, label);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test("rejects unknown config, category, and frontmatter fields", async () => {
  const cases: Array<[string, (root: string) => Promise<void>]> = [
    [
      "config field",
      async (root) => {
        const path = join(root, "vali.json");
        const value = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
        value.unexpected = true;
        await writeFile(path, JSON.stringify(value), "utf8");
      },
    ],
    [
      "category field",
      async (root) => {
        const path = join(root, "categories.json");
        const value = JSON.parse(await readFile(path, "utf8")) as Array<
          Record<string, unknown>
        >;
        value[0].unexpected = true;
        await writeFile(path, JSON.stringify(value), "utf8");
      },
    ],
    [
      "frontmatter field",
      async (root) => {
        const path = join(root, "entries", "ent_active.md");
        const value = await readFile(path, "utf8");
        await writeFile(
          path,
          value.replace('updatedAt: "2026-07-11T03:00:00Z"', 'unexpected: "x"\r\nupdatedAt: "2026-07-11T03:00:00Z"'),
          "utf8",
        );
      },
    ],
  ];

  for (const [label, mutate] of cases) {
    const root = await createLegacyVault();
    try {
      await mutate(root);
      await assert.rejects(readLegacyVault(root), /unknown field/i, label);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test("rejects invalid identities, duplicates, and category relationships", async () => {
  const cases: Array<[string, RegExp, (root: string) => Promise<void>]> = [
    [
      "entry filename mismatch",
      /filename/i,
      (root) =>
        rename(
          join(root, "entries", "ent_active.md"),
          join(root, "entries", "ent_different.md"),
        ),
    ],
    [
      "missing default category",
      /default category/i,
      (root) =>
        updateJson(join(root, "vali.json"), (value) => {
          (value as Record<string, unknown>).defaultCategoryId = "cat_missing";
        }),
    ],
    [
      "duplicate category id",
      /duplicate category id/i,
      (root) =>
        updateJson(join(root, "categories.json"), (value) => {
          const categories = value as Array<Record<string, unknown>>;
          categories.push({ ...categories[0], name: "Another" });
        }),
    ],
    [
      "duplicate category name",
      /duplicate category name/i,
      (root) =>
        updateJson(join(root, "categories.json"), (value) => {
          const categories = value as Array<Record<string, unknown>>;
          categories.push({ ...categories[0], id: "cat_second" });
        }),
    ],
    [
      "duplicate title in one category",
      /duplicate entry title/i,
      async (root) => {
        const source = await readFile(join(root, "entries", "ent_active.md"), "utf8");
        await writeFile(
          join(root, "entries", "ent_second.md"),
          source.replace('id: "ent_active"', 'id: "ent_second"'),
          "utf8",
        );
      },
    ],
    [
      "missing entry category",
      /missing category/i,
      async (root) => {
        const path = join(root, "entries", "ent_active.md");
        const source = await readFile(path, "utf8");
        await writeFile(
          path,
          source.replace('categoryId: "cat_watchlist"', 'categoryId: "cat_missing"'),
          "utf8",
        );
      },
    ],
  ];

  for (const [label, error, mutate] of cases) {
    const root = await createLegacyVault();
    try {
      await mutate(root);
      await assert.rejects(readLegacyVault(root), error, label);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test("rejects invalid ID prefixes and trash source names", async () => {
  const cases: Array<[string, RegExp, (root: string) => Promise<void>]> = [
    [
      "category prefix",
      /category id prefix/i,
      async (root) => {
        await updateJson(join(root, "vali.json"), (value) => {
          (value as Record<string, unknown>).defaultCategoryId = "wrong_category";
        });
        await updateJson(join(root, "categories.json"), (value) => {
          (value as Array<Record<string, unknown>>)[0].id = "wrong_category";
        });
        const path = join(root, "entries", "ent_active.md");
        const source = await readFile(path, "utf8");
        await writeFile(
          path,
          source.replace('categoryId: "cat_watchlist"', 'categoryId: "wrong_category"'),
          "utf8",
        );
      },
    ],
    [
      "entry prefix",
      /entry id prefix/i,
      async (root) => {
        const oldPath = join(root, "entries", "ent_active.md");
        const newPath = join(root, "entries", "wrong_entry.md");
        const source = await readFile(oldPath, "utf8");
        await writeFile(
          newPath,
          source.replace('id: "ent_active"', 'id: "wrong_entry"'),
          "utf8",
        );
        await rm(oldPath);
      },
    ],
    [
      "trash source name",
      /trash filename/i,
      (root) =>
        rename(
          join(root, "trash", "ent_archived.md"),
          join(root, "trash", "ent_unrelated.md"),
        ),
    ],
  ];

  for (const [label, error, mutate] of cases) {
    const root = await createLegacyVault();
    try {
      await mutate(root);
      await assert.rejects(readLegacyVault(root), error, label);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test("rejects noncanonical aliases, invalid dates, and invalid timestamps", async () => {
  const cases: Array<[string, RegExp, (root: string) => Promise<void>]> = [
    [
      "whitespace alias",
      /alias.*trimmed/i,
      (root) =>
        replaceInFile(
          join(root, "entries", "ent_active.md"),
          '  - "TSM"',
          '  - " TSM "',
        ),
    ],
    [
      "duplicate alias",
      /duplicate alias/i,
      (root) =>
        replaceInFile(
          join(root, "entries", "ent_active.md"),
          '  - "2330"',
          '  - "TSM"',
        ),
    ],
    [
      "invalid reflection date",
      /reflection date/i,
      (root) =>
        rename(
          join(root, "reflections", "2026-07-10.md"),
          join(root, "reflections", "2026-02-30.md"),
        ),
    ],
    [
      "invalid config timestamp",
      /timestamp/i,
      (root) =>
        updateJson(join(root, "vali.json"), (value) => {
          (value as Record<string, unknown>).createdAt = "2026-02-30T01:02:03Z";
        }),
    ],
    [
      "invalid category timestamp",
      /timestamp/i,
      (root) =>
        updateJson(join(root, "categories.json"), (value) => {
          (value as Array<Record<string, unknown>>)[0].updatedAt = "not-a-time";
        }),
    ],
    [
      "invalid active-entry timestamp",
      /timestamp/i,
      (root) =>
        replaceInFile(
          join(root, "entries", "ent_active.md"),
          'updatedAt: "2026-07-11T03:00:00Z"',
          'updatedAt: "2026-07-11T25:00:00Z"',
        ),
    ],
    [
      "invalid trash-entry timestamp",
      /timestamp/i,
      (root) =>
        replaceInFile(
          join(root, "trash", "ent_archived.md"),
          'updatedAt: "2026-07-09T02:00:00Z"',
          'updatedAt: "2026-07-09T02:00:00+00:00"',
        ),
    ],
    [
      "unsupported version",
      /version 1/i,
      (root) =>
        updateJson(join(root, "vali.json"), (value) => {
          (value as Record<string, unknown>).version = 2;
        }),
    ],
  ];

  for (const [label, error, mutate] of cases) {
    const root = await createLegacyVault();
    try {
      await mutate(root);
      await assert.rejects(readLegacyVault(root), error, label);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test("preserves collision-safe trash source names without inferring deletion time", async () => {
  const root = await createLegacyVault();
  const sourceName = "ent_archived_20260711010203_2.md";

  try {
    await rename(
      join(root, "trash", "ent_archived.md"),
      join(root, "trash", sourceName),
    );

    const snapshot = await readLegacyVault(root);

    assert.equal(snapshot.trash[0].sourceName, sourceName);
    assert.equal(snapshot.trash[0].deletedAt, null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects BOM-prefixed and invalid UTF-8 source files", async () => {
  const cases: Array<[string, RegExp, (root: string) => Promise<void>]> = [
    [
      "JSON BOM",
      /BOM/i,
      async (root) => {
        const path = join(root, "vali.json");
        const source = await readFile(path);
        await writeFile(path, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), source]));
      },
    ],
    [
      "Markdown BOM",
      /BOM/i,
      async (root) => {
        const path = join(root, "entries", "ent_active.md");
        const source = await readFile(path);
        await writeFile(path, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), source]));
      },
    ],
    [
      "invalid UTF-8",
      /UTF-8/i,
      (root) => writeFile(join(root, "reflections", "2026-07-10.md"), Buffer.from([0xff])),
    ],
  ];

  for (const [label, error, mutate] of cases) {
    const root = await createLegacyVault();
    try {
      await mutate(root);
      await assert.rejects(readLegacyVault(root), error, label);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test("rejects malformed root values, field types, and frontmatter", async () => {
  const cases: Array<[string, RegExp, (root: string) => Promise<void>]> = [
    [
      "config root",
      /vali\.json must contain an object/i,
      (root) => writeFile(join(root, "vali.json"), "[]\n", "utf8"),
    ],
    [
      "missing config field",
      /vali\.json\.name must be a string/i,
      (root) =>
        updateJson(join(root, "vali.json"), (value) => {
          delete (value as Record<string, unknown>).name;
        }),
    ],
    [
      "config field type",
      /vali\.json\.version must be an integer/i,
      (root) =>
        updateJson(join(root, "vali.json"), (value) => {
          (value as Record<string, unknown>).version = "1";
        }),
    ],
    [
      "categories root",
      /categories\.json must contain an array/i,
      (root) => writeFile(join(root, "categories.json"), "{}\n", "utf8"),
    ],
    [
      "category field type",
      /categories\.json\[0\]\.order must be an integer/i,
      (root) =>
        updateJson(join(root, "categories.json"), (value) => {
          (value as Array<Record<string, unknown>>)[0].order = 1.5;
        }),
    ],
    [
      "missing frontmatter field",
      /title must be a string/i,
      (root) =>
        replaceInFile(
          join(root, "entries", "ent_active.md"),
          'title: "台積電"\r\n',
          "",
        ),
    ],
    [
      "frontmatter integer",
      /order must be an integer/i,
      (root) =>
        replaceInFile(
          join(root, "entries", "ent_active.md"),
          'categoryId: "cat_watchlist"',
          'categoryId: "cat_watchlist"\r\norder: 1.0',
        ),
    ],
    [
      "duplicate frontmatter field",
      /duplicate field/i,
      (root) =>
        replaceInFile(
          join(root, "entries", "ent_active.md"),
          'id: "ent_active"',
          'id: "ent_active"\r\nid: "ent_active"',
        ),
    ],
    [
      "unclosed frontmatter",
      /frontmatter is not closed/i,
      async (root) => {
        const path = join(root, "entries", "ent_active.md");
        const source = await readFile(path, "utf8");
        const closing = source.lastIndexOf("\r\n---\r\n");
        assert.notEqual(closing, -1);
        await writeFile(
          path,
          `${source.slice(0, closing)}\r\n${source.slice(closing + "\r\n---\r\n".length)}`,
          "utf8",
        );
      },
    ],
  ];

  for (const [label, error, mutate] of cases) {
    const root = await createLegacyVault();
    try {
      await mutate(root);
      await assert.rejects(readLegacyVault(root), error, label);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});

async function createLegacyVault(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "vali-legacy-reader-"));
  await Promise.all([
    mkdir(join(root, "entries")),
    mkdir(join(root, "reflections")),
    mkdir(join(root, "trash")),
  ]);
  await Promise.all([
    writeFile(
      join(root, "vali.json"),
      JSON.stringify(
        {
          name: "Vali 測試",
          version: 1,
          createdAt: "2026-07-11T01:02:03Z",
          defaultCategoryId: "cat_watchlist",
        },
        null,
        2,
      ) + "\n",
      "utf8",
    ),
    writeFile(
      join(root, "categories.json"),
      JSON.stringify(
        [
          {
            id: "cat_watchlist",
            name: "觀察",
            order: 1,
            createdAt: "2026-07-11T01:02:03Z",
            updatedAt: "2026-07-11T01:02:03Z",
          },
        ],
        null,
        2,
      ) + "\n",
      "utf8",
    ),
    writeFile(
      join(root, "entries", "ent_active.md"),
      [
        "---",
        'id: "ent_active"',
        'title: "台積電"',
        "aliases:",
        '  - "TSM"',
        '  - "2330"',
        'categoryId: "cat_watchlist"',
        'createdAt: "2026-07-11T02:00:00Z"',
        'updatedAt: "2026-07-11T03:00:00Z"',
        "---",
        "",
        "# Thesis",
        "",
        "保留 Unicode。",
        "",
      ].join("\r\n"),
      "utf8",
    ),
    writeFile(
      join(root, "reflections", "2026-07-10.md"),
      "# Reflection\r\n\r\n保留內容。\r\n\r\n",
      "utf8",
    ),
    writeFile(
      join(root, "trash", "ent_archived.md"),
      [
        "---",
        'id: "ent_archived"',
        'title: "Archived"',
        "aliases:",
        'categoryId: "cat_watchlist"',
        "order: 4",
        'createdAt: "2026-07-09T01:00:00Z"',
        'updatedAt: "2026-07-09T02:00:00Z"',
        "---",
        "",
        "# Archived",
        "",
      ].join("\n"),
      "utf8",
    ),
    writeFile(join(root, "trash", ".gitkeep"), "\n", "utf8"),
    writeFile(join(root, "entries", ".gitkeep"), "\n", "utf8"),
    writeFile(join(root, "reflections", ".gitkeep"), "\n", "utf8"),
  ]);
  return root;
}

async function readTree(root: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {};

  async function visit(directory: string): Promise<void> {
    for (const item of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, item.name);
      const name = relative(root, path).replaceAll("\\", "/");
      if (item.isDirectory()) {
        result[`${name}/`] = "directory";
        await visit(path);
      } else {
        result[name] = (await readFile(path)).toString("base64");
      }
    }
  }

  await visit(root);
  return result;
}

async function updateJson(
  path: string,
  mutate: (value: unknown) => void,
): Promise<void> {
  const value = JSON.parse(await readFile(path, "utf8")) as unknown;
  mutate(value);
  await writeFile(path, JSON.stringify(value, null, 2) + "\n", "utf8");
}

async function replaceInFile(
  path: string,
  search: string,
  replacement: string,
): Promise<void> {
  const source = await readFile(path, "utf8");
  assert.ok(source.includes(search), `fixture is missing ${search}`);
  await writeFile(path, source.replace(search, replacement), "utf8");
}
