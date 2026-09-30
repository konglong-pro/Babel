import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  MARKDOWN_FOLDER_MAX_NOTE_BYTES,
  MarkdownFolderImportError,
  analyzeMarkdownFolder,
  preflightMarkdownFolder,
  renderMarkdownFolderNote,
  type FolderImportFileLike,
  type MarkdownFolderCommitManifest,
} from "../src/imports/core";
import {
  cleanupMarkdownFolderImportSession,
  createMarkdownFolderImportSession,
  deleteMarkdownFolderImportSession,
  prepareMarkdownFolderImport,
  readMarkdownFolderImportSession,
  rethrowAfterMarkdownFolderImportCleanup,
  uploadMarkdownFolderImportFile,
} from "../src/imports/server";

class MemoryFile implements FolderImportFileLike {
  readonly size: number;

  constructor(
    readonly name: string,
    private readonly bytes: Uint8Array,
    readonly type: string,
    readonly webkitRelativePath = name,
  ) {
    this.size = bytes.byteLength;
  }

  async arrayBuffer(): Promise<ArrayBuffer> {
    return this.bytes.buffer.slice(
      this.bytes.byteOffset,
      this.bytes.byteOffset + this.bytes.byteLength,
    ) as ArrayBuffer;
  }
}

const encoder = new TextEncoder();

function textFile(path: string, content: string): MemoryFile {
  return new MemoryFile(path.replace(/^.*\//u, ""), encoder.encode(content), "text/markdown", path);
}

function pngFile(path: string): MemoryFile {
  return new MemoryFile(
    path.replace(/^.*\//u, ""),
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    "image/png",
    path,
  );
}

test("preflight strips the selected root and includes only referenced local images", async () => {
  const result = await preflightMarkdownFolder([
    textFile("Vault/index.md", "[Child](sub/child.md)\n\n![Logo](assets/logo.png)"),
    textFile("Vault/sub/child.md", "![Again](../assets/logo.png)"),
    pngFile("Vault/assets/logo.png"),
    pngFile("Vault/assets/unused.png"),
  ]);

  assert.equal(result.rootName, "Vault");
  assert.deepEqual(result.notes.map(({ sourcePath }) => sourcePath), ["index.md", "sub/child.md"]);
  assert.deepEqual(result.assets.map(({ path }) => path), ["assets/logo.png"]);
  assert.deepEqual(result.uploads.map(({ path }) => path), [
    "index.md",
    "sub/child.md",
    "assets/logo.png",
  ]);
  assert.equal(result.issues.length, 0);
});

test("preflight keeps unreadable and oversized Markdown visible but never uploads it", async () => {
  const oversized: FolderImportFileLike = {
    name: "oversized.md",
    size: MARKDOWN_FOLDER_MAX_NOTE_BYTES + 1,
    type: "text/markdown",
    webkitRelativePath: "Vault/oversized.md",
    async arrayBuffer() {
      throw new Error("oversized files must not be read");
    },
  };
  const result = await preflightMarkdownFolder([
    new MemoryFile(
      "invalid.md",
      new Uint8Array([0xff]),
      "text/markdown",
      "Vault/invalid.md",
    ),
    oversized,
  ]);

  assert.deepEqual(result.notes.map(({ sourcePath }) => sourcePath), [
    "invalid.md",
    "oversized.md",
  ]);
  assert.ok(result.notes[0].issues.some(({ code }) => code === "INVALID_UTF8"));
  assert.ok(result.notes[1].issues.some(({ code }) => code === "FILE_TOO_LARGE"));
  assert.deepEqual(result.uploads, []);
  assert.ok(result.issues.every(({ code }) => code !== "NO_MARKDOWN"));
});

test("preflight rejects an oversized batch from metadata without reading content", async () => {
  let reads = 0;
  const files: FolderImportFileLike[] = Array.from({ length: 26 }, (_, index) => ({
    name: `${index}.md`,
    size: MARKDOWN_FOLDER_MAX_NOTE_BYTES,
    type: "text/markdown",
    webkitRelativePath: `Vault/${index}.md`,
    async arrayBuffer() {
      reads += 1;
      return new ArrayBuffer(0);
    },
  }));
  const result = await preflightMarkdownFolder(files);

  assert.equal(reads, 0);
  assert.equal(result.notes.length, files.length);
  assert.deepEqual(result.uploads, []);
  assert.ok(result.issues.some(({ code }) => code === "TOTAL_TOO_LARGE"));
});

test("renderer rewrites batch Markdown links, wikilinks, and referenced images", () => {
  const contentMd = [
    "[Open child](sub/child.md)",
    "[[child]]",
    "![Logo][asset]",
    "",
    "[asset]: assets/logo.png",
  ].join("\n");
  const rendered = renderMarkdownFolderNote({
    sourcePath: "index.md",
    contentMd,
    titlesBySourcePath: new Map([
      ["index.md", "Index"],
      ["sub/child.md", "Renamed Child"],
    ]),
    uploadPlaceholderPrefix: "test-upload://",
  });

  assert.match(rendered.contentMd, /\[\[Renamed Child\|Open child\]\]/u);
  assert.match(rendered.contentMd, /\[\[Renamed Child\]\]/u);
  assert.match(rendered.contentMd, /\[asset\]: test-upload:\/\/folder-[0-9a-f]{16}/u);
  assert.deepEqual(rendered.images.map(({ path }) => path), ["assets/logo.png"]);
});

test("renderer preserves Markdown labels and wikilink aliases", () => {
  const rendered = renderMarkdownFolderNote({
    sourcePath: "index.md",
    contentMd: "[Same](child.md)\n[[child| Same ]]",
    titlesBySourcePath: new Map([
      ["index.md", "Index"],
      ["child.md", "Same"],
    ]),
    uploadPlaceholderPrefix: "test-upload://",
  });

  assert.equal(rendered.contentMd, "[[Same|Same]]\n[[Same| Same ]]");
});

test("ambiguous wikilinks require an explicit target or preserve decision", () => {
  const sources = [
    { path: "index.md", contentMd: "[[topic]]", size: 9 },
    { path: "a/topic.md", contentMd: "A", size: 1 },
    { path: "b/topic.md", contentMd: "B", size: 1 },
  ];
  const analysis = analyzeMarkdownFolder(sources, sources);
  const linkIssue = analysis.notes[0].linkIssues[0];
  assert.deepEqual(linkIssue.candidateSourcePaths, ["a/topic.md", "b/topic.md"]);
  const base = {
    sourcePath: "index.md",
    contentMd: "[[topic]]",
    titlesBySourcePath: new Map([
      ["index.md", "Index"],
      ["a/topic.md", "Topic A"],
      ["b/topic.md", "Topic B"],
    ]),
    uploadPlaceholderPrefix: "test-upload://",
  };
  assert.throws(
    () => renderMarkdownFolderNote(base),
    (error) => error instanceof MarkdownFolderImportError && error.code === "AMBIGUOUS_LINK",
  );
  assert.equal(
    renderMarkdownFolderNote({
      ...base,
      linkDecisions: { [linkIssue.id]: "preserve" },
    }).contentMd,
    "[[topic]]",
  );
  assert.equal(
    renderMarkdownFolderNote({
      ...base,
      linkDecisions: { [linkIssue.id]: "b/topic.md" },
    }).contentMd,
    "[[Topic B]]",
  );
});

test("image parent segments are allowed only while they remain inside the selected root", () => {
  const sources = [
    {
      path: "sub/note.md",
      contentMd: [
        "![ok](../assets/ok.png)",
        "![bad](../../bad.png)",
        "![drive](C:\\outside.png)",
        "![file](file:///outside.png)",
        "![remote](https://example.com/remote.png)",
      ].join("\n"),
      size: 150,
    },
  ];
  const analysis = analyzeMarkdownFolder(sources, [
    ...sources,
    { path: "assets/ok.png", size: 8, type: "image/png" },
  ]);
  assert.deepEqual(analysis.notes[0].imagePaths, ["assets/ok.png"]);
  assert.equal(
    analysis.notes[0].issues.filter(({ code }) => code === "INVALID_PATH").length,
    3,
  );
  assert.ok(analysis.notes[0].issues.every(({ message }) => !message.includes("remote.png")));
});

test("server stages files one-by-one and revalidates the complete manifest", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "babel-folder-import-"));
  let sessionId = "";
  try {
    sessionId = (await createMarkdownFolderImportSession(root)).id;
    await uploadMarkdownFolderImportFile(
      root,
      sessionId,
      "note.md",
      "markdown",
      textFile("note.md", "![Logo](assets/logo.png)"),
    );
    await uploadMarkdownFolderImportFile(
      root,
      sessionId,
      "assets/logo.png",
      "image",
      pngFile("assets/logo.png"),
    );
    const manifest: MarkdownFolderCommitManifest = {
      baseFolderId: 7,
      records: [{
        sourcePath: "note.md",
        title: "Imported Note",
        folder: { kind: "mapped", path: "" },
        parent: null,
        tags: ["imported"],
        linkDecisions: {},
      }],
    };
    const prepared = await prepareMarkdownFolderImport(root, sessionId, manifest, {
      existingTitles: [],
      uploadPlaceholderPrefix: "test-upload://",
    });
    assert.equal(prepared.records.length, 1);
    assert.match(prepared.records[0].contentMd, /test-upload:\/\/folder-/u);
    assert.equal(prepared.records[0].images[0].path, "assets/logo.png");

    await assert.rejects(
      () => prepareMarkdownFolderImport(root, sessionId, manifest, {
        existingTitles: ["Imported Note"],
        uploadPlaceholderPrefix: "test-upload://",
      }),
      (error) => error instanceof MarkdownFolderImportError && error.code === "TITLE_CONFLICT",
    );
  } finally {
    if (sessionId) await deleteMarkdownFolderImportSession(root, sessionId);
    await rm(root, { recursive: true, force: true });
  }
});

test("server rejects traversal before writing a staged file", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "babel-folder-import-"));
  try {
    const session = await createMarkdownFolderImportSession(root);
    await assert.rejects(
      () => uploadMarkdownFolderImportFile(
        root,
        session.id,
        "../outside.md",
        "markdown",
        textFile("outside.md", "outside"),
      ),
    );
    assert.equal((await readMarkdownFolderImportSession(root, session.id)).files.length, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rollback cleanup ignores malformed session ids without resolving a target", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "babel-folder-import-"));
  try {
    await cleanupMarkdownFolderImportSession(root, "../outside");
    await cleanupMarkdownFolderImportSession(root, "not-a-session");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rollback helper runs every cleanup step and preserves all failures", async () => {
  const cause = new Error("commit failed");
  const cleanupFailure = new Error("image cleanup failed");
  const calls: string[] = [];
  await assert.rejects(
    rethrowAfterMarkdownFolderImportCleanup(cause, [
      async () => {
        calls.push("images");
        throw cleanupFailure;
      },
      async () => {
        calls.push("session");
      },
    ]),
    (error) => error instanceof AggregateError &&
      error.errors[0] === cause &&
      error.errors[1] === cleanupFailure,
  );
  assert.deepEqual(calls, ["images", "session"]);
});
