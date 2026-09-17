import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

import { GET as getNoteImage } from "../src/app/api/uploads/notes/[filename]/route";
import {
  deleteNoteImages,
  finalizeQuarantinedNoteImages,
  ImageStorageError,
  assertMarkdownSaveLimits,
  managedImagePathsInMarkdown,
  normalizeStoredNoteImagePath,
  NOTE_IMAGE_DIRECTORY,
  NOTE_IMAGE_MAX_BYTES,
  NOTE_CONTENT_MAX_BYTES,
  NOTE_NEW_IMAGE_MAX_COUNT,
  type NoteImageUpload,
  quarantineNoteImages,
  readNoteImage,
  restoreQuarantinedNoteImages,
  saveNoteImage,
  stageNoteImages,
  stageNoteImagesInMarkdown,
  withNoteImageMutationLock,
} from "../src/lib/storage";

let temporaryRoot = "";
let uploadDirectory = "";
let previousUploadDirectory: string | undefined;

before(async () => {
  temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "retex-note-images-"));
  uploadDirectory = path.join(temporaryRoot, "uploads", "notes");
  previousUploadDirectory = process.env.RETEX_NOTE_UPLOAD_DIRECTORY;
  process.env.RETEX_NOTE_UPLOAD_DIRECTORY = uploadDirectory;
});

after(async () => {
  if (previousUploadDirectory === undefined) {
    delete process.env.RETEX_NOTE_UPLOAD_DIRECTORY;
  } else {
    process.env.RETEX_NOTE_UPLOAD_DIRECTORY = previousUploadDirectory;
  }
  await rm(temporaryRoot, { recursive: true, force: true });
});

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01]);
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0x01]);
const gif = Buffer.from("GIF89a\x01", "binary");
const webp = Buffer.concat([
  Buffer.from("RIFF", "ascii"),
  Buffer.from([0x01, 0x00, 0x00, 0x00]),
  Buffer.from("WEBP", "ascii"),
]);
const invalidPng = Buffer.from("not a png");

test("ReTex note image storage and GET route", async (t) => {
  await t.test("enforces Markdown, image count, and logical save limits", () => {
    assert.throws(
      () => assertMarkdownSaveLimits(
        ["x".repeat(NOTE_CONTENT_MAX_BYTES), "y"],
        new Map(),
      ),
      hasStorageCode("CONTENT_TOO_LARGE"),
    );

    const tinyUpload: NoteImageUpload = {
      type: "image/png",
      size: 1,
      async arrayBuffer() {
        throw new Error("Limit checks must not read image bodies.");
      },
    };
    assert.throws(
      () => assertMarkdownSaveLimits(
        [""],
        new Map(Array.from(
          { length: NOTE_NEW_IMAGE_MAX_COUNT + 1 },
          (_, index) => [`image-${index}`, tinyUpload] as const,
        )),
      ),
      hasStorageCode("TOO_MANY_IMAGES"),
    );

    const maximumImage: NoteImageUpload = {
      ...tinyUpload,
      size: NOTE_IMAGE_MAX_BYTES,
    };
    assert.throws(
      () => assertMarkdownSaveLimits(
        ["x"],
        new Map(Array.from(
          { length: 10 },
          (_, index) => [`image-${index}`, maximumImage] as const,
        )),
      ),
      hasStorageCode("REQUEST_TOO_LARGE"),
    );
  });

  await t.test("serializes image mutation critical sections", async () => {
    const events: string[] = [];
    let signalStarted!: () => void;
    let releaseFirst!: () => void;
    const started = new Promise<void>((resolve) => {
      signalStarted = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const first = withNoteImageMutationLock(async () => {
      events.push("first-start");
      signalStarted();
      await gate;
      events.push("first-end");
    });
    await started;
    const second = withNoteImageMutationLock(async () => {
      events.push("second-start");
    });
    await Promise.resolve();
    assert.deepEqual(events, ["first-start"]);

    releaseFirst();
    await Promise.all([first, second]);
    assert.deepEqual(events, ["first-start", "first-end", "second-start"]);
  });

  await t.test("stores every supported signature and serves safe immutable responses", async () => {
    const fixtures = [
      { data: png, type: "image/png", extension: "png" },
      { data: jpeg, type: "image/jpeg", extension: "jpg" },
      { data: gif, type: "image/gif", extension: "gif" },
      { data: webp, type: "image/webp", extension: "webp" },
    ] as const;
    const imagePaths: string[] = [];

    for (const fixture of fixtures) {
      const imagePath = await saveNoteImage(upload(fixture.data, fixture.type));
      imagePaths.push(imagePath);
      assert.match(
        imagePath,
        new RegExp(`^data/retex/uploads/notes/[A-Za-z0-9-]+\\.${fixture.extension}$`),
      );
      const stored = await readNoteImage(imagePath);
      assert.equal(stored.contentType, fixture.type);
      assert.deepEqual(stored.data, fixture.data);
    }

    const fileName = imagePaths[0].split("/").at(-1);
    assert.ok(fileName);
    const response = await getNoteImage(
      new Request(`http://localhost/api/uploads/notes/${fileName}`),
      { params: Promise.resolve({ filename: fileName }) },
    );
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "private, max-age=31536000, immutable");
    assert.equal(response.headers.get("content-disposition"), `inline; filename="${fileName}"`);
    assert.equal(response.headers.get("content-length"), String(png.byteLength));
    assert.equal(response.headers.get("content-type"), "image/png");
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), png);

    await deleteNoteImages(imagePaths);
  });

  await t.test("rejects unsafe paths, invalid content, and oversized uploads", async () => {
    await assert.rejects(
      saveNoteImage(upload(png, "image/svg+xml")),
      hasStorageCode("INVALID_TYPE"),
    );
    await assert.rejects(
      saveNoteImage(upload(png, "image/jpeg")),
      hasStorageCode("INVALID_CONTENT"),
    );
    await assert.rejects(
      saveNoteImage(upload(Buffer.alloc(0), "image/png")),
      hasStorageCode("EMPTY_FILE"),
    );

    let oversizedUploadRead = false;
    await assert.rejects(
      saveNoteImage({
        type: "image/png",
        size: NOTE_IMAGE_MAX_BYTES + 1,
        async arrayBuffer() {
          oversizedUploadRead = true;
          return Uint8Array.from(png).buffer;
        },
      }),
      hasStorageCode("FILE_TOO_LARGE"),
    );
    assert.equal(oversizedUploadRead, false);

    await assert.rejects(
      saveNoteImage({
        type: "image/png",
        size: png.byteLength + 1,
        async arrayBuffer() {
          return Uint8Array.from(png).buffer;
        },
      }),
      hasStorageCode("INVALID_CONTENT"),
    );

    assert.equal(
      normalizeStoredNoteImagePath("safe.png"),
      `${NOTE_IMAGE_DIRECTORY}/safe.png`,
    );
    for (const candidate of [
      "../escape.png",
      "/absolute.png",
      "nested/image.png",
      "data/uploads/notes/wrong-root.png",
      "data/retex/uploads/notes/../escape.png",
      "image.png\0",
    ]) {
      assert.throws(
        () => normalizeStoredNoteImagePath(candidate),
        hasStorageCode("INVALID_PATH"),
      );
    }
    assert.throws(
      () => normalizeStoredNoteImagePath("image.svg"),
      hasStorageCode("INVALID_TYPE"),
    );

    const traversal = await getNoteImage(
      new Request("http://localhost/api/uploads/notes/escape.png"),
      { params: Promise.resolve({ filename: "../escape.png" }) },
    );
    assert.equal(traversal.status, 400);
    assert.equal((await traversal.json()).error.code, "INVALID_PATH");

    const missing = await getNoteImage(
      new Request("http://localhost/api/uploads/notes/missing.png"),
      { params: Promise.resolve({ filename: "missing.png" }) },
    );
    assert.equal(missing.status, 404);
    assert.equal((await missing.json()).error.code, "NOT_FOUND");
  });

  await t.test("stages one-to-one tokens and recognizes only managed Markdown URLs", async () => {
    const staged = await stageNoteImages(
      [
        "![First](retex-upload://first)",
        "![Second](retex-upload://second)",
      ].join("\n"),
      new Map<string, NoteImageUpload>([
        ["first", upload(png, "image/png")],
        ["second", upload(gif, "image/gif")],
      ]),
    );
    assert.equal(staged.imagePaths.length, 2);
    assert.equal(staged.contentMd.includes("retex-upload://"), false);
    const fileNames = staged.imagePaths.map((imagePath) => imagePath.split("/").at(-1));
    assert.ok(fileNames[0]);
    assert.ok(fileNames[1]);
    assert.match(staged.contentMd, new RegExp(`/api/uploads/notes/${fileNames[0]}`));
    assert.match(staged.contentMd, new RegExp(`/api/uploads/notes/${fileNames[1]}`));

    assert.deepEqual(
      [...managedImagePathsInMarkdown([
        `![Root](/api/uploads/notes/${fileNames[0]})`,
        `![Relative](api/uploads/notes/${fileNames[0]})`,
        `![Reference][asset]`,
        `[asset]: /api/uploads/notes/${fileNames[1]}`,
        `![External](https://example.com/api/uploads/notes/${fileNames[0]})`,
        `\`![Code](/api/uploads/notes/${fileNames[0]})\``,
      ].join("\n"))],
      staged.imagePaths,
    );

    await assert.rejects(
      stageNoteImages("![Missing](retex-upload://missing)", new Map()),
      hasStorageCode("INVALID_CONTENT"),
    );
    await assert.rejects(
      stageNoteImages(
        "No placeholder.",
        new Map([["extra", upload(png, "image/png")]]),
      ),
      hasStorageCode("INVALID_CONTENT"),
    );
    await assert.rejects(
      stageNoteImages(
        "![Bad](retex-upload://bad.token)",
        new Map([["bad.token", upload(png, "image/png")]]),
      ),
      hasStorageCode("INVALID_CONTENT"),
    );

    await deleteNoteImages(staged.imagePaths);
  });

  await t.test("stages one upload pool across multiple Markdown sources", async () => {
    const staged = await stageNoteImagesInMarkdown(
      [
        "![Shared](retex-upload://shared)",
        "![Shared again](retex-upload://shared) ![Worked](retex-upload://worked)",
      ],
      new Map<string, NoteImageUpload>([
        ["shared", upload(png, "image/png")],
        ["worked", upload(webp, "image/webp")],
      ]),
    );
    assert.equal(staged.imagePaths.length, 2);
    assert.equal(staged.markdownSources.length, 2);
    assert.equal(staged.markdownSources.some((source) => source.includes("retex-upload://")), false);

    const sharedFileName = staged.imagePaths[0].split("/").at(-1);
    const workedFileName = staged.imagePaths[1].split("/").at(-1);
    assert.ok(sharedFileName);
    assert.ok(workedFileName);
    const sharedUrl = `/api/uploads/notes/${sharedFileName}`;
    const workedUrl = `/api/uploads/notes/${workedFileName}`;
    assert.equal(staged.markdownSources[0], `![Shared](${sharedUrl})`);
    assert.equal(
      staged.markdownSources[1],
      `![Shared again](${sharedUrl}) ![Worked](${workedUrl})`,
    );

    await assert.rejects(
      stageNoteImagesInMarkdown(
        [
          "![Answer](retex-upload://answer)",
          "![Missing](retex-upload://missing)",
        ],
        new Map([["answer", upload(png, "image/png")]]),
      ),
      hasStorageCode("INVALID_CONTENT"),
    );

    await deleteNoteImages(staged.imagePaths);
  });

  await t.test("rolls back partial staging and supports quarantine restore and finalize", async () => {
    const before = await uploadContents();
    await assert.rejects(
      stageNoteImages(
        "![Good](retex-upload://good) ![Bad](retex-upload://bad)",
        new Map<string, NoteImageUpload>([
          ["good", upload(png, "image/png")],
          ["bad", upload(invalidPng, "image/png")],
        ]),
      ),
      hasStorageCode("INVALID_CONTENT"),
    );
    assert.deepEqual(await uploadContents(), before);
    assert.deepEqual(await stagingContents(), []);

    const imagePaths = await Promise.all([
      saveNoteImage(upload(jpeg, "image/jpeg")),
      saveNoteImage(upload(gif, "image/gif")),
      saveNoteImage(upload(webp, "image/webp")),
    ]);
    const quarantined = await quarantineNoteImages(imagePaths);
    for (const imagePath of imagePaths) {
      await assert.rejects(readNoteImage(imagePath), hasStorageCode("NOT_FOUND"));
    }
    await restoreQuarantinedNoteImages(quarantined);
    for (const imagePath of imagePaths) {
      assert.ok((await readNoteImage(imagePath)).size > 0);
    }
    assert.deepEqual(await stagingContents(), []);

    const finalized = await quarantineNoteImages(imagePaths);
    await finalizeQuarantinedNoteImages(finalized);
    for (const imagePath of imagePaths) {
      await assert.rejects(readNoteImage(imagePath), hasStorageCode("NOT_FOUND"));
    }
    const missing = await quarantineNoteImages([
      `${NOTE_IMAGE_DIRECTORY}/already-missing.png`,
    ]);
    assert.deepEqual(missing.entries, []);
    await finalizeQuarantinedNoteImages(missing);
    assert.deepEqual(await stagingContents(), []);
  });
});

function upload(data: Buffer, type: string): NoteImageUpload {
  return {
    type,
    size: data.byteLength,
    async arrayBuffer() {
      return Uint8Array.from(data).buffer;
    },
  };
}

function hasStorageCode(code: ImageStorageError["code"]): (error: unknown) => boolean {
  return (error: unknown) => error instanceof ImageStorageError && error.code === code;
}

async function uploadContents(): Promise<string[]> {
  try {
    return (await readdir(uploadDirectory)).sort();
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return [];
    throw error;
  }
}

async function stagingContents(): Promise<string[]> {
  try {
    return (await readdir(path.join(uploadDirectory, ".staging"))).sort();
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return [];
    throw error;
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
