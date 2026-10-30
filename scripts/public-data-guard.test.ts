import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const guardPath = path.join(root, "scripts", "check-public-data.mjs");

async function createRepository(t: { after: (fn: () => Promise<unknown>) => void }) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "babel-public-data-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const git = (args: string[], input?: string) => execFileSync("git", args, {
    cwd: directory,
    input,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  });
  git(["init", "--quiet"]);
  git(["config", "core.hooksPath", ".git/hooks"]);
  git(["config", "core.quotePath", "true"]);
  // Index-only fixtures exercise Git's full path format without creating
  // control-character names that the Windows filesystem cannot represent.
  git(["config", "core.protectNTFS", "false"]);
  git(["config", "commit.gpgSign", "false"]);
  git(["config", "user.name", "Babel guard test"]);
  git(["config", "user.email", "babel-guard@example.invalid"]);
  await mkdir(path.join(directory, "scripts"));
  await copyFile(guardPath, path.join(directory, "scripts", "check-public-data.mjs"));
  const hookPath = path.join(directory, ".git", "hooks", "pre-commit");
  await copyFile(path.join(root, ".githooks", "pre-commit"), hookPath);
  await chmod(hookPath, 0o755);

  const blob = git(["hash-object", "-w", "--stdin"], "disposable fixture\n").trim();
  const stage = (paths: string[]) => git(
    ["update-index", "-z", "--index-info"],
    paths.map((filePath) => `100644 ${blob}\t${filePath}\0`).join(""),
  );
  const guard = (mode: "--staged" | "--tracked") => spawnSync(
    process.execPath,
    [path.join(directory, "scripts", "check-public-data.mjs"), mode],
    { cwd: directory, encoding: "utf8" },
  );
  return { directory, git, stage, guard };
}

test("the hook and tracked-file guard reject unquoted Unicode and control-character paths", async (t) => {
  const repository = await createRepository(t);
  const blockedPaths = [
    "export/笔记.db",
    "export/带 空格.sqlite",
    "export/笔记.db.backup",
    "export/笔记\t草稿.sqlite-wal",
    "export/笔记\n草稿.db-shm",
    "export/日志-journal",
    "DATA/笔记.md",
    "apps/vali/data/笔记.json",
    "uploads/notes/图片.PNG",
    "apps/vali/uploads/imports/originals/原件.docx",
    "upload/嵌套/PDF/文档.pdf",
    "uploads/原件.txt",
  ];
  repository.stage(blockedPaths);
  assert.match(repository.git(["diff", "--cached", "--name-only"]), /\\[0-7]{3}/);
  for (const mode of ["--staged", "--tracked"] as const) {
    const result = repository.guard(mode);
    assert.equal(result.status, 1, result.stderr);
    for (const filePath of blockedPaths) {
      assert.ok(result.stderr.includes(JSON.stringify(filePath)), `${mode}: ${JSON.stringify(filePath)}\n${result.stderr}`);
    }
  }

  const commit = spawnSync("git", ["commit", "--quiet", "-m", "Must reject fixture"], {
    cwd: repository.directory,
    encoding: "utf8",
  });
  assert.notEqual(commit.status, 0);
  assert.match(commit.stderr, /Refusing user data or SQLite files/);
  assert.throws(() => repository.git(["rev-parse", "--verify", "HEAD"]));
});

test("the hook permits upload route source, ordinary assets and removal of private paths", async (t) => {
  const repository = await createRepository(t);
  repository.stage([
    "apps/vali/src/app/api/uploads/notes/[filename]/route.ts",
    "templates/mirror-app/src/app/api/uploads/notes/[filename]/route.ts",
    "apps/vali/src/app/api/imports/documents/originals/[id]/route.ts",
    "apps/vali/public/图 标.png",
    "docs/说明.md",
    "scripts/public-data-guard.test.ts",
  ]);
  for (const mode of ["--staged", "--tracked"] as const) {
    const result = repository.guard(mode);
    assert.equal(result.status, 0, result.stderr);
  }
  repository.git(["commit", "--quiet", "-m", "Allow public source"]);

  // Build an old private-data commit directly, without disabling the hook, so
  // the normal pre-commit path can prove it still permits removing leaked data.
  repository.stage(["export/旧笔记.db"]);
  const tree = repository.git(["write-tree"]).trim();
  const parent = repository.git(["rev-parse", "HEAD"]).trim();
  const commit = repository.git(["commit-tree", tree, "-p", parent], "old fixture\n").trim();
  repository.git(["update-ref", "HEAD", commit]);
  repository.git(["update-index", "--force-remove", "--", "export/旧笔记.db"]);
  repository.git(["commit", "--quiet", "-m", "Remove private fixture"]);
  assert.equal(repository.guard("--tracked").status, 0);
});

test("renaming public content to a private-data path is rejected", async (t) => {
  const repository = await createRepository(t);
  repository.stage(["docs/example.txt"]);
  repository.git(["commit", "--quiet", "-m", "Public fixture"]);
  repository.git(["update-index", "--force-remove", "--", "docs/example.txt"]);
  repository.stage(["uploads/originals/重命名.pdf"]);
  assert.match(repository.git(["diff", "--cached", "--name-status"]), /^R100\t/);
  const result = repository.guard("--staged");
  assert.equal(result.status, 1);
  assert.ok(result.stderr.includes(JSON.stringify("uploads/originals/重命名.pdf")));
});

test("CI uses the same guard and Git failures fail closed", async (t) => {
  const workflow = await readFile(path.join(root, ".github", "workflows", "repository-checks.yml"), "utf8");
  assert.match(workflow, /run: node scripts\/check-public-data\.mjs --tracked/);
  const directory = await mkdtemp(path.join(os.tmpdir(), "babel-public-data-no-git-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const result = spawnSync(process.execPath, [guardPath, "--tracked"], {
    cwd: directory,
    encoding: "utf8",
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Unable to inspect Git paths/);
});
