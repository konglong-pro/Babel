import assert from "node:assert/strict";
import test from "node:test";

import { createHttpErrorHandlers } from "../src/http/errors";
import {
  createFolderCollectionRoute,
  createFolderItemRoute,
} from "../src/http/folder-routes";

const { handleApi } = createHttpErrorHandlers({
  errorStatuses: {},
  imageErrorStatuses: {},
  isImageStorageError: (error): error is never => {
    void error;
    return false;
  },
});

test("folder route factories preserve the standard collection and item contract", async () => {
  const folders = [{ id: 1, name: "Inbox", parentId: null as number | null }];
  const collection = createFolderCollectionRoute({
    handleApi,
    listFolders: () => folders,
    createFolder: (input) => {
      const folder = { id: folders.length + 1, ...input, parentId: input.parentId ?? null };
      folders.push(folder);
      return folder;
    },
  });
  const item = createFolderItemRoute({
    handleApi,
    getFolder: (id) => folders.find((folder) => folder.id === id) ?? null,
    updateFolder: (id, patch) => {
      const folder = folders.find((candidate) => candidate.id === id);
      if (!folder) throw new Error("missing");
      Object.assign(folder, patch);
      return folder;
    },
    deleteFolder: (id) => {
      const index = folders.findIndex((folder) => folder.id === id);
      if (index < 0) return false;
      folders.splice(index, 1);
      return true;
    },
  });

  assert.deepEqual(await (await collection.GET()).json(), folders);
  const created = await collection.POST(new Request("http://localhost/api/folders", {
    method: "POST",
    body: JSON.stringify({ name: "Child", parentId: 1 }),
  }));
  assert.equal(created.status, 201);
  assert.equal((await created.json()).name, "Child");

  const context = { params: Promise.resolve({ id: "2" }) };
  assert.equal((await item.GET(new Request("http://localhost"), context)).status, 200);
  const patched = await item.PATCH(new Request("http://localhost/api/folders/2", {
    method: "PATCH",
    body: JSON.stringify({ name: "Renamed" }),
  }), context);
  assert.equal((await patched.json()).name, "Renamed");
  const reordered = await item.PATCH(new Request("http://localhost/api/folders/2", {
    method: "PATCH",
    body: JSON.stringify({ position: 0 }),
  }), context);
  assert.equal((await reordered.json()).position, 0);
  assert.equal(
    (await item.DELETE(new Request("http://localhost/api/folders/2", {
      method: "DELETE",
    }), context)).status,
    204,
  );
  assert.equal(
    (await item.GET(new Request("http://localhost"), context)).status,
    404,
  );
});

test("folder route factories reject foreign origins and empty patches", async () => {
  const collection = createFolderCollectionRoute({
    handleApi,
    listFolders: () => [],
    createFolder: (input) => ({ id: 1, ...input }),
  });
  const item = createFolderItemRoute({
    handleApi,
    getFolder: () => ({ id: 1 }),
    updateFolder: () => ({ id: 1 }),
    deleteFolder: () => true,
  });

  const foreign = await collection.POST(new Request("http://localhost/api/folders", {
    method: "POST",
    headers: { origin: "https://attacker.example" },
    body: JSON.stringify({ name: "Blocked" }),
  }));
  assert.equal(foreign.status, 403);

  const emptyPatch = await item.PATCH(new Request("http://localhost/api/folders/1", {
    method: "PATCH",
    body: "{}",
  }), { params: Promise.resolve({ id: "1" }) });
  assert.equal(emptyPatch.status, 400);

  const invalidPosition = await item.PATCH(new Request("http://localhost/api/folders/1", {
    method: "PATCH",
    body: JSON.stringify({ position: -1 }),
  }), { params: Promise.resolve({ id: "1" }) });
  assert.equal(invalidPosition.status, 400);
});
