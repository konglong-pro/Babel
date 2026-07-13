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
  assert.equal(manifest.dependencies["@babel-apps/platform"], "0.1.0");
  assert.equal(manifest.scripts["db:check"], "tsx scripts/check-database.ts");
  assert.match(
    await readFile(path.join(generatedRoot, "src", "app", "api", "health", "route.ts"), "utf8"),
    /assertAppDatabaseReady\(\)/,
  );
  await access(path.join(generatedRoot, "scripts", "check-database.ts"));
  assert.match(
    await readFile(
      path.join(generatedRoot, "src", "lib", "db", "readiness.ts"),
      "utf8",
    ),
    /requiredColumns: \{ note: \["parent_id"\] \}/,
  );
  await access(
    path.join(generatedRoot, "drizzle", "0000_mirror-notes_notes.sql"),
  );
  await access(path.join(generatedRoot, "src", "components", "markdown.tsx"));
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
  assert.match(
    await readFile(
      path.join(generatedRoot, "drizzle", "0000_mirror-notes_notes.sql"),
      "utf8",
    ),
    /`parent_id` integer/,
  );
  const globalStyles = await readFile(
    path.join(generatedRoot, "src", "app", "globals.css"),
    "utf8",
  );
  assert.match(globalStyles, /\.folder-node-row/);
  assert.match(globalStyles, /\.folder-disclosure/);
  assert.match(globalStyles, /\.note-disclosure/);
  const generatedRepository = await readFile(
    path.join(generatedRoot, "src", "lib", "repositories", "notes.ts"),
    "utf8",
  );
  assert.match(generatedRepository, /assertNoteParent/);
  assert.match(generatedRepository, /noteSubtreeIds/);
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
  assert.match(generatedBackendTests, /guarded hierarchy/);
  assert.match(generatedBackendTests, /reject cyclic or non-empty mutations/);
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
