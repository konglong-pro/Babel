import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import type { EntryImageUpload } from "../src/lib/storage";

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

test("storage recovery preserves trash-owned images and removes generated orphans", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "neum-recovery-"));
  const uploadDirectory = path.join(root, "uploads");
  process.env.NEUM_DATABASE_PATH = path.join(root, "sqlite.db");
  process.env.NEUM_UPLOAD_DIRECTORY = uploadDirectory;
  await mkdir(uploadDirectory, { recursive: true });

  const [{ getNeumDatabase }, repositories, storage] = await Promise.all([
    import("../src/lib/db/client"),
    import("../src/lib/repositories"),
    import("../src/lib/storage"),
  ]);
  const { db, sqlite } = getNeumDatabase();
  migrate(db, { migrationsFolder: path.resolve(import.meta.dirname, "..", "drizzle") });
  t.after(async () => {
    sqlite.close();
    delete process.env.NEUM_DATABASE_PATH;
    delete process.env.NEUM_UPLOAD_DIRECTORY;
    await rm(root, { recursive: true, force: true });
  });

  const staged = await storage.stageEntryImages(
    "![Owned](neum-upload://owned)",
    new Map([["owned", imageUpload(png)]]),
  );
  const entry = repositories.createEntry(
    {
      folderId: repositories.listFolders()[0].id,
      kind: "knowledge",
      title: "Recovery owner",
      notesMd: staged.notesMd,
      tags: [],
    },
    staged.imagePaths,
  );
  assert.ok(repositories.moveEntryToTrash(entry.id, entry.version));

  await storage.quarantineEntryImages(staged.imagePaths);
  await assert.rejects(storage.readEntryImage(staged.imagePaths[0]), {
    code: "NOT_FOUND",
  });
  await storage.recoverEntryImageStorage();
  assert.deepEqual((await storage.readEntryImage(staged.imagePaths[0])).data, png);

  const orphanPath = await storage.saveEntryImage(imageUpload(png));
  const personalPath = path.join(uploadDirectory, "personal.png");
  await writeFile(personalPath, png);
  await storage.recoverEntryImageStorage();

  await assert.rejects(storage.readEntryImage(orphanPath), { code: "NOT_FOUND" });
  assert.deepEqual((await storage.readEntryImage("personal.png")).data, png);
});

function imageUpload(data: Buffer): EntryImageUpload {
  return {
    type: "image/png",
    size: data.byteLength,
    async arrayBuffer() {
      return Uint8Array.from(data).buffer;
    },
  };
}
