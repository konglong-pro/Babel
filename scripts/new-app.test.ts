import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  deriveAppIdentity,
  findNextFreePort,
  scaffoldApp,
  type CommandInvocation,
} from "./new-app";

test("derives safe app identifiers", () => {
  assert.deepEqual(deriveAppIdentity("ReTex"), {
    name: "ReTex",
    id: "retex",
    envPrefix: "RETEX",
  });
  assert.deepEqual(deriveAppIdentity("  My   Notes  "), {
    name: "My Notes",
    id: "my-notes",
    envPrefix: "MY_NOTES",
  });

  for (const name of ["", "../escape", "name/slash", "name\\slash", "Café", "two\ttabs"]) {
    assert.throws(() => deriveAppIdentity(name), /safe ASCII app name/i);
  }
});

test("selects the smallest free registry port", () => {
  assert.equal(findNextFreePort([3000, 3002]), 3001);
  assert.equal(findNextFreePort([3000, 3001, 3002]), 3003);
  assert.throws(
    () => findNextFreePort(Array.from({ length: 1000 }, (_, index) => 3000 + index)),
    /No free app ports/i,
  );
});

test("renders a mirror app and updates registry metadata", async (t) => {
  const fixture = await createFixture();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  const templateRoot = path.join(fixture.root, "templates", "mirror-app");
  await mkdir(path.join(templateRoot, ".next", "node_modules"), {
    recursive: true,
  });
  await mkdir(path.join(templateRoot, "node_modules"), { recursive: true });
  await mkdir(path.join(templateRoot, "public", "_typst"), { recursive: true });
  await writeFile(path.join(templateRoot, "tsconfig.tsbuildinfo"), "generated");
  await writeFile(path.join(templateRoot, "build.log"), "generated");
  await writeFile(
    path.join(templateRoot, "public", "_typst", "runtime.js"),
    "generated",
  );

  const commands: CommandInvocation[] = [];
  const result = await scaffoldApp("My Notes", {
    root: fixture.root,
    runCommand: async (invocation) => {
      commands.push(invocation);
      if (invocation.args[0] === "install") {
        await writeFile(fixture.lockPath, "lock updated by npm\n", "utf8");
      }
    },
  });

  assert.deepEqual(result, {
    name: "My Notes",
    id: "my-notes",
    envPrefix: "MY_NOTES",
    port: 3001,
    workspace: "apps/my-notes",
  });
  assert.deepEqual(
    commands.map(({ args, cwd }) => ({ args, cwd })),
    [
      {
        args: [
          "install",
          "--package-lock-only",
          "--ignore-scripts",
          "--no-audit",
          "--no-fund",
        ],
        cwd: fixture.root,
      },
      {
        args: ["run", "registry:check"],
        cwd: fixture.root,
      },
    ],
  );
  assert.ok(commands.every(({ command }) => command === (process.platform === "win32" ? "npm.cmd" : "npm")));

  const generatedRoot = path.join(fixture.root, "apps", "my-notes");
  const generatedManifest = await readJson<{
    name: string;
    scripts: { dev: string; start: string };
  }>(path.join(generatedRoot, "package.json"));
  assert.equal(generatedManifest.name, "@babel-apps/my-notes");
  assert.match(generatedManifest.scripts.dev, /-p 3001$/);
  assert.match(generatedManifest.scripts.start, /-p 3001$/);
  assert.equal(
    await readFile(path.join(generatedRoot, "src", "my-notes.txt"), "utf8"),
    "My Notes|my-notes|MY_NOTES|3001\n",
  );
  await access(path.join(generatedRoot, "src", "components", "markdown.tsx"));
  await access(path.join(generatedRoot, "src", "lib", "repositories", "index.ts"));
  for (const generatedPath of [
    ".next",
    "node_modules",
    "public/_typst",
    "tsconfig.tsbuildinfo",
    "build.log",
  ]) {
    await assert.rejects(access(path.join(generatedRoot, generatedPath)), {
      code: "ENOENT",
    });
  }

  const registry = await readJson<{
    apps: Array<Record<string, unknown>>;
  }>(fixture.registryPath);
  assert.deepEqual(registry.apps.at(-1), {
    name: "My Notes",
    id: "my-notes",
    workspace: "apps/my-notes",
    port: 3001,
    healthPath: "/api/health",
    identityPath: "/notes",
    identityText: "My Notes",
    readyTimeoutSeconds: 60,
    env: {
      MY_NOTES_DATABASE_PATH: "data/my-notes/sqlite.db",
      MY_NOTES_UPLOAD_DIRECTORY: "data/my-notes/uploads/notes",
    },
    requiredDataPaths: [
      "data/my-notes/sqlite.db",
      "data/my-notes/uploads/notes",
    ],
  });

  const rootPackage = await readJson<{ scripts: Record<string, string> }>(fixture.packagePath);
  assert.equal(rootPackage.scripts["dev:my-notes"], "npm run dev -w @babel-apps/my-notes");
  assert.equal(await readFile(fixture.lockPath, "utf8"), "lock updated by npm\n");
});

test("renders the repository mirror template as an independent app", async (t) => {
  const fixture = await createFixture();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));

  await scaffoldApp("Mirror Notes", {
    root: fixture.root,
    templateRoot: path.resolve(import.meta.dirname, "..", "templates", "mirror-app"),
    runCommand: async ({ args }) => {
      if (args[0] === "install") {
        await writeFile(fixture.lockPath, "lock updated by npm\n", "utf8");
      }
    },
  });

  const generatedRoot = path.join(fixture.root, "apps", "mirror-notes");
  const manifest = await readJson<{
    name: string;
    dependencies: Record<string, string>;
    scripts: Record<string, string>;
  }>(path.join(generatedRoot, "package.json"));
  assert.equal(manifest.name, "@babel-apps/mirror-notes");
  assert.equal(manifest.dependencies["@babel-apps/markdown"], "0.1.0");
  assert.equal(manifest.dependencies["@babel-apps/platform"], "0.1.0");
  assert.equal(manifest.dependencies["@babel-apps/typst"], "0.1.0");
  assert.equal(manifest.dependencies["react-markdown"], undefined);
  assert.equal(manifest.dependencies["remark-gfm"], undefined);
  assert.equal(
    manifest.scripts["typst:assets"],
    "tsx ../../packages/typst/scripts/sync-public-assets.ts public",
  );
  assert.equal(manifest.scripts.predev, "npm run typst:assets");
  assert.equal(manifest.scripts.prebuild, "npm run typst:assets");
  assert.equal(manifest.scripts.prestart, "npm run typst:assets");
  assert.equal(manifest.scripts["db:backfill-links"], "tsx scripts/backfill-links.ts");
  assert.equal(manifest.scripts["db:check"], "tsx scripts/check-database.ts");
  assert.equal(manifest.scripts["benchmark:search"], "tsx scripts/benchmark-search.ts");
  assert.equal(manifest.scripts.build, "tsx scripts/build.ts");
  assert.match(
    await readFile(path.join(generatedRoot, "next.config.ts"), "utf8"),
    /transpilePackages:\s*\[[^\]]*["']@babel-apps\/markdown["']/,
  );
  assert.match(
    await readFile(path.join(generatedRoot, "next.config.ts"), "utf8"),
    /transpilePackages:\s*\[[^\]]*["']@babel-apps\/typst["']/,
  );
  assert.match(
    await readFile(path.join(generatedRoot, "src", "app", "api", "health", "route.ts"), "utf8"),
    /assertAppDatabaseReady\(\)/,
  );
  await access(path.join(generatedRoot, "scripts", "check-database.ts"));
  await access(path.join(generatedRoot, "scripts", "build.ts"));
  await access(path.join(generatedRoot, "scripts", "benchmark-search.ts"));
  await access(path.join(generatedRoot, "src", "lib", "markdown-import.ts"));
  await access(path.join(generatedRoot, "src", "lib", "note-limits.ts"));
  await access(path.join(generatedRoot, "src", "lib", "storage", "recovery.ts"));
  const generatedBackfill = await readFile(
    path.join(generatedRoot, "scripts", "backfill-links.ts"),
    "utf8",
  );
  assert.match(generatedBackfill, /Mirror Notes link index rebuilt/);
  assert.doesNotMatch(generatedBackfill, /__APP_|Esperanto/);
  const readinessSource = await readFile(
    path.join(generatedRoot, "src", "lib", "db", "readiness.ts"),
    "utf8",
  );
  assert.match(
    readinessSource,
    /note:\s*\["parent_id"\]/,
  );
  assert.match(
    readinessSource,
    /note_link:\s*\[[\s\S]*?"source_note_id"[\s\S]*?"target_title_key"[\s\S]*?"target_note_id"[\s\S]*?\]/,
  );
  assert.match(readinessSource, /note_search:\s*\["title", "content_md", "tags"\]/);
  assert.match(readinessSource, /name:\s*"note_search"/);
  const initialMigration = await readFile(
    path.join(generatedRoot, "drizzle", "0000_mirror-notes_notes.sql"),
    "utf8",
  );
  assert.match(initialMigration, /CREATE TABLE `note_link`/);
  assert.match(
    initialMigration,
    /FOREIGN KEY \(`source_note_id`\) REFERENCES `note`\(`id`\).*ON DELETE cascade/i,
  );
  assert.match(
    initialMigration,
    /FOREIGN KEY \(`target_note_id`\) REFERENCES `note`\(`id`\).*ON DELETE set null/i,
  );
  assert.match(initialMigration, /CREATE UNIQUE INDEX `note_link_source_title_unique`/);
  assert.match(initialMigration, /CREATE INDEX `note_link_target_idx`/);
  assert.match(initialMigration, /CREATE INDEX `note_link_title_key_idx`/);
  const searchMigration = await readFile(
    path.join(generatedRoot, "drizzle", "0001_mirror-notes_search_trigram.sql"),
    "utf8",
  );
  assert.match(searchMigration, /tokenize='trigram'/);
  assert.match(searchMigration, /CREATE TRIGGER `note_search_au`/);

  const markdownEditor = await readFile(
    path.join(generatedRoot, "src", "components", "markdown-editor.tsx"),
    "utf8",
  );
  assert.match(markdownEditor, /from "@babel-apps\/markdown\/react"/);
  assert.match(markdownEditor, /MarkdownEditor as SharedMarkdownEditor/);
  assert.match(markdownEditor, /MarkdownEditorProps as SharedMarkdownEditorProps/);
  assert.match(markdownEditor, /ACCEPTED_IMAGE_TYPES/);
  assert.match(markdownEditor, /imageFileError/);
  assert.match(markdownEditor, /stageImageFile/);
  assert.match(markdownEditor, /type StagedImage/);
  assert.match(markdownEditor, /fetchScope="mirror-notes:notes"/);
  assert.match(markdownEditor, /uploadScheme="mirror-notes-upload"/);
  assert.doesNotMatch(markdownEditor, /emptyPreviewText=|preview will appear/i);
  assert.doesNotMatch(
    markdownEditor,
    /MAX_IMAGE_BYTES|stageFiles|newImageToken|useWikilinkAutocomplete|WikilinkAutocomplete|MarkdownRenderer|URL\.createObjectURL/,
  );
  assert.doesNotMatch(markdownEditor, /__APP_|Esperanto/i);
  const noteDetail = await readFile(
    path.join(generatedRoot, "src", "components", "note-detail.tsx"),
    "utf8",
  );
  assert.match(noteDetail, /OutlinePanel/);
  assert.equal((noteDetail.match(/<DetachedReaderWindow/g) ?? []).length, 2);
  assert.equal(
    (noteDetail.match(/buttonClassName="babel-reader-title-button"/g) ?? []).length,
    2,
  );
  assert.match(noteDetail, /liveDraft=\{false\}/);
  assert.match(noteDetail, /liveDraft=\{true\}/);
  assert.doesNotMatch(noteDetail, /buttonPortalTargetId|babel-detached-reader-trigger-target/);
  assert.match(noteDetail, /windowKey=\{`mirror-notes-note-/);
  assert.match(noteDetail, /ownerDocument=\{readerDocument\}/);
  assert.match(noteDetail, /const NOTE_HEADING_ID_PREFIX = "mirror-notes-note-heading-"/);
  assert.match(noteDetail, /textareaRef=\{textareaRef\}/);
  assert.match(noteDetail, /footerExtras=/);
  await assert.rejects(
    access(path.join(generatedRoot, "src", "components", "markdown.tsx")),
    { code: "ENOENT" },
  );
  assert.match(
    await readFile(
      path.join(generatedRoot, "src", "lib", "repositories", "links.ts"),
      "utf8",
    ),
    /from "@babel-apps\/markdown\/core"/,
  );
  await access(
    path.join(generatedRoot, "src", "app", "api", "notes", "titles", "route.ts"),
  );
  await access(
    path.join(
      generatedRoot,
      "src",
      "app",
      "api",
      "notes",
      "[id]",
      "backlinks",
      "route.ts",
    ),
  );
  const folderPanel = await readFile(
    path.join(generatedRoot, "src", "components", "folder-panel.tsx"),
    "utf8",
  );
  assert.match(folderPanel, /aria-expanded=/);
  assert.match(folderPanel, /className="folder-disclosure"/);
  assert.doesNotMatch(folderPanel, /folder-disclosure-spacer/);
  assert.match(folderPanel, /New subfolder/);
  await access(
    path.join(generatedRoot, "src", "components", "folder-tree-state.ts"),
  );
  await access(path.join(generatedRoot, "tests", "folder-tree-state.test.ts"));
  const noteList = await readFile(
    path.join(generatedRoot, "src", "components", "note-list.tsx"),
    "utf8",
  );
  assert.match(noteList, /className="note-disclosure"/);
  assert.match(noteList, /New subnote/);
  await access(path.join(generatedRoot, "src", "components", "note-tree-state.ts"));
  await access(path.join(generatedRoot, "tests", "note-tree-state.test.ts"));
  assert.match(initialMigration, /`parent_id` integer/);
  const globalStyles = await readFile(
    path.join(generatedRoot, "src", "app", "globals.css"),
    "utf8",
  );
  assert.match(globalStyles, /\.folder-node-row/);
  assert.match(globalStyles, /\.folder-disclosure/);
  assert.match(globalStyles, /\.note-disclosure/);
  assert.match(globalStyles, /\.document-outline-layout/);
  assert.match(globalStyles, /\.outline-panel/);
  assert.match(globalStyles, /\.outline-panel ol \{[\s\S]*?overflow-y:\s*auto/);
  assert.match(globalStyles, /\.editor-format-tools/);
  assert.match(globalStyles, /\.editor-grid \{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\)/);
  assert.match(
    globalStyles,
    /@media \(max-width: 760px\) \{[\s\S]*?\.document-outline-layout,[\s\S]*?\.editor-outline-layout[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\)/,
  );
  const generatedRepository = await readFile(
    path.join(generatedRoot, "src", "lib", "repositories", "notes.ts"),
    "utf8",
  );
  assert.match(generatedRepository, /requireNoteParent/);
  assert.match(generatedRepository, /noteDescendantIds/);
  assert.match(generatedRepository, /NOT_EMPTY/);
  const generatedCollectionRoute = await readFile(
    path.join(generatedRoot, "src", "app", "api", "notes", "route.ts"),
    "utf8",
  );
  const generatedItemRoute = await readFile(
    path.join(generatedRoot, "src", "app", "api", "notes", "[id]", "route.ts"),
    "utf8",
  );
  assert.match(generatedCollectionRoute, /parentId/);
  assert.match(generatedItemRoute, /parentId/);
  const generatedBackendTests = await readFile(
    path.join(generatedRoot, "tests", "backend.test.ts"),
    "utf8",
  );
  assert.match(
    generatedBackendTests,
    /folder hierarchy prevents cycles and non-empty deletion/,
  );
  assert.match(
    generatedBackendTests,
    /note hierarchy rejects cycles, moves subtrees, and protects parents/,
  );
  assert.match(
    generatedBackendTests,
    /search ranks an exact title above a newer body-only match/,
  );
  assert.match(
    generatedBackendTests,
    /search API returns safe match details without full bodies/,
  );
  assert.match(
    generatedBackendTests,
    /search ranks decoded tags without counting JSON escapes/,
  );
  assert.match(generatedBackendTests, /wire size is rejected before multipart parsing/);

  const generatedSearchRepository = await readFile(
    path.join(generatedRoot, "src", "lib", "repositories", "search.ts"),
    "utf8",
  );
  assert.match(generatedSearchRepository, /@babel-apps\/platform\/search\/text/);
  assert.match(generatedSearchRepository, /@babel-apps\/platform\/search\/page/);
  assert.match(generatedSearchRepository, /note_search/);
  assert.match(generatedSearchRepository, /compareRankedNotes/);
  assert.match(generatedSearchRepository, /hasStoredTagOnlyMatch/);
  assert.match(generatedSearchRepository, /literalTextPosition/);
  const generatedSearchTypes = await readFile(
    path.join(generatedRoot, "src", "lib", "types.ts"),
    "utf8",
  );
  assert.match(generatedSearchTypes, /interface NoteSearchResultDto/);
  assert.match(generatedSearchTypes, /matchedFields: NoteSearchField\[\]/);
  const generatedSearchResults = await readFile(
    path.join(generatedRoot, "src", "components", "search-results.tsx"),
    "utf8",
  );
  assert.match(generatedSearchResults, /<mark/);
  assert.match(generatedSearchResults, /Load more/);
  assert.doesNotMatch(generatedSearchResults, /dangerouslySetInnerHTML/);
  assert.match(globalStyles, /\.search-result-list mark/);
  assert.match(generatedBackendTests, /storage recovery waits for an active image mutation/);
  await access(path.join(generatedRoot, "src", "lib", "repositories", "index.ts"));
});

test("rejects duplicate ids before changing repository files", async (t) => {
  const fixture = await createFixture();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  let commandCount = 0;

  await assert.rejects(
    scaffoldApp("RETEX", {
      root: fixture.root,
      runCommand: () => {
        commandCount += 1;
      },
    }),
    /already registered/i,
  );

  assert.equal(commandCount, 0);
  await assertOriginalFiles(fixture);
});

test("rolls back the app and exact metadata bytes when validation fails", async (t) => {
  const fixture = await createFixture();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));

  await assert.rejects(
    scaffoldApp("Rollback Notes", {
      root: fixture.root,
      runCommand: async ({ args }) => {
        if (args[0] === "install") {
          await writeFile(fixture.lockPath, "npm replaced the lock\n", "utf8");
          return;
        }
        throw new Error("registry check failed");
      },
    }),
    /registry check failed/i,
  );

  await assertOriginalFiles(fixture);
  await assert.rejects(access(path.join(fixture.root, "apps", "rollback-notes")));
});

test("rejects unresolved template tokens without leaving changes", async (t) => {
  const fixture = await createFixture();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  await writeFile(
    path.join(fixture.root, "templates", "mirror-app", "broken.txt"),
    "__APP_UNKNOWN__\n",
    "utf8",
  );

  await assert.rejects(
    scaffoldApp("Broken Notes", {
      root: fixture.root,
      runCommand: () => {
        throw new Error("commands must not run");
      },
    }),
    /Unresolved template token __APP_UNKNOWN__/,
  );

  await assertOriginalFiles(fixture);
  await assert.rejects(access(path.join(fixture.root, "apps", "broken-notes")));
});

test("rejects a concurrent scaffold before it can share a port or rollback", async (t) => {
  const fixture = await createFixture();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));

  let releaseFirst!: () => void;
  const firstCanFinish = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  let firstReachedInstall!: () => void;
  const firstAtInstall = new Promise<void>((resolve) => {
    firstReachedInstall = resolve;
  });
  let firstCommand = true;
  const first = scaffoldApp("First Notes", {
    root: fixture.root,
    runCommand: async () => {
      if (!firstCommand) return;
      firstCommand = false;
      firstReachedInstall();
      await firstCanFinish;
    },
  });

  await firstAtInstall;
  try {
    await assert.rejects(
      scaffoldApp("Second Notes", {
        root: fixture.root,
        runCommand: () => {
          throw new Error("the second scaffold must not run commands");
        },
      }),
      /Another new-app command is already running/,
    );
  } finally {
    releaseFirst();
  }
  await first;

  const registry = await readJson<{
    apps: Array<{ id: string; port: number }>;
  }>(fixture.registryPath);
  assert.equal(registry.apps.at(-1)?.id, "first-notes");
  assert.equal(registry.apps.at(-1)?.port, 3001);
  await assert.rejects(access(path.join(fixture.root, "apps", "second-notes")));
  await assert.rejects(access(path.join(fixture.root, ".new-app.lock")));
});

type Fixture = Awaited<ReturnType<typeof createFixture>>;

async function createFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "babel-new-app-"));
  const templateRoot = path.join(root, "templates", "mirror-app");
  const registryPath = path.join(root, "babel.apps.json");
  const packagePath = path.join(root, "package.json");
  const lockPath = path.join(root, "package-lock.json");

  await mkdir(path.join(root, "apps"), { recursive: true });
  await mkdir(path.join(templateRoot, "src", "components"), { recursive: true });
  await mkdir(path.join(templateRoot, "src", "lib", "repositories"), { recursive: true });
  await writeFile(
    path.join(templateRoot, "package.json"),
    `${JSON.stringify(
      {
        name: "@babel-apps/__APP_ID__",
        version: "0.1.0",
        private: true,
        scripts: {
          dev: "next dev -H 127.0.0.1 -p __APP_PORT__",
          start: "next start -H 127.0.0.1 -p __APP_PORT__",
        },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  await writeFile(
    path.join(templateRoot, "src", "__APP_ID__.txt"),
    "__APP_NAME__|__APP_ID__|__APP_ENV_PREFIX__|__APP_PORT__\n",
    "utf8",
  );
  await writeFile(
    path.join(templateRoot, "src", "components", "markdown.tsx"),
    "export const markdownOwner = \"__APP_ID__\";\n",
    "utf8",
  );
  await writeFile(
    path.join(templateRoot, "src", "lib", "repositories", "index.ts"),
    "export const repositoryOwner = \"__APP_NAME__\";\n",
    "utf8",
  );

  const registryBytes = Buffer.from(
    `${JSON.stringify(
      {
        schemaVersion: 1,
        apps: [
          { name: "ReTex", id: "retex", port: 3000 },
          { name: "Vali", id: "vali", port: 3002 },
        ],
      },
      null,
      2,
    )}\n`,
  );
  const packageBytes = Buffer.from(
    `${JSON.stringify(
      {
        name: "babel-workspace",
        private: true,
        type: "module",
        scripts: {
          check: "npm run registry:check",
          "registry:check": "tsx scripts/check-registry.ts",
        },
      },
      null,
      2,
    )}\n`,
  );
  const lockBytes = Buffer.from("{\r\n  \"lockfileVersion\": 3\r\n}\r\n");
  await writeFile(registryPath, registryBytes);
  await writeFile(packagePath, packageBytes);
  await writeFile(lockPath, lockBytes);

  return {
    root,
    registryPath,
    packagePath,
    lockPath,
    registryBytes,
    packageBytes,
    lockBytes,
  };
}

async function assertOriginalFiles(fixture: Fixture): Promise<void> {
  assert.deepEqual(await readFile(fixture.registryPath), fixture.registryBytes);
  assert.deepEqual(await readFile(fixture.packagePath), fixture.packageBytes);
  assert.deepEqual(await readFile(fixture.lockPath), fixture.lockBytes);
}

async function readJson<T>(filename: string): Promise<T> {
  return JSON.parse(await readFile(filename, "utf8")) as T;
}
