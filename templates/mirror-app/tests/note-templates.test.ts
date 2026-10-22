import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { after, before } from "node:test";

import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import type * as TemplateCollectionRoute from "@/app/api/templates/route";
import type * as TemplateItemRoute from "@/app/api/templates/[id]/route";
import type * as DatabaseModule from "@/lib/db/client";
import type * as RepositoryModule from "@/lib/repositories";

let temporaryRoot = "";
let database: typeof DatabaseModule;
let repositories: typeof RepositoryModule;
let collectionRoute: typeof TemplateCollectionRoute;
let itemRoute: typeof TemplateItemRoute;

before(async () => {
  temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "__APP_ID__-templates-test-"));
  process.env.__APP_ENV_PREFIX___DATABASE_PATH = path.join(temporaryRoot, "sqlite.db");
  process.env.__APP_ENV_PREFIX___UPLOAD_DIRECTORY = path.join(temporaryRoot, "uploads");
  database = await import("@/lib/db/client");
  migrate(database.db, { migrationsFolder: path.resolve(process.cwd(), "drizzle") });
  [repositories, collectionRoute, itemRoute] = await Promise.all([
    import("@/lib/repositories"),
    import("@/app/api/templates/route"),
    import("@/app/api/templates/[id]/route"),
  ]);
});

after(async () => {
  database.sqlite.close();
  await rm(temporaryRoot, { recursive: true, force: true });
});

test("note template CRUD and copy semantics", async (t) => {
  await t.test("routes preserve static Markdown and enforce names", async () => {
    const contentMd = [
      "# Session title",
      "",
      "## Summary",
      "",
      "- Key point",
      "",
      "$ integral_0^1 x dif x $",
    ].join("\n");
    const createdResponse = await collectionRoute.POST(
      jsonRequest("http://localhost/api/templates", "POST", {
        name: "Study Session",
        contentMd,
      }),
    );
    assert.equal(createdResponse.status, 201);
    const created = (await createdResponse.json()) as {
      id: number;
      name: string;
      contentMd: string;
      createdAt: string;
      updatedAt: string;
    };
    assert.equal(created.name, "Study Session");
    assert.equal(created.contentMd, contentMd);
    assert.ok(created.createdAt);
    assert.ok(created.updatedAt);

    const duplicate = await collectionRoute.POST(
      jsonRequest("http://localhost/api/templates", "POST", {
        name: "study session",
        contentMd: "",
      }),
    );
    assert.equal(duplicate.status, 409);
    assert.equal(
      ((await duplicate.json()) as { error: { code: string } }).error.code,
      "CONFLICT",
    );

    const tooLong = await collectionRoute.POST(
      jsonRequest("http://localhost/api/templates", "POST", {
        name: "x".repeat(121),
        contentMd: "",
      }),
    );
    assert.equal(tooLong.status, 400);

    const patchResponse = await itemRoute.PATCH(
      jsonRequest(`http://localhost/api/templates/${created.id}`, "PATCH", {
        name: "Review Session",
        contentMd: `${contentMd}\n\n## Questions`,
      }),
      routeContext(created.id),
    );
    assert.equal(patchResponse.status, 200);
    const patched = (await patchResponse.json()) as {
      name: string;
      contentMd: string;
    };
    assert.equal(patched.name, "Review Session");
    assert.match(patched.contentMd, /## Questions$/);

    const listed = (await (await collectionRoute.GET()).json()) as Array<{
      id: number;
    }>;
    assert.deepEqual(listed.map(({ id }) => id), [created.id]);
  });

  await t.test("managed note images are rejected", async () => {
    for (const contentMd of [
      "![Pending](__APP_ID__-upload://image-token)",
      "![Owned](/api/uploads/notes/owned.png)",
    ]) {
      const response = await collectionRoute.POST(
        jsonRequest("http://localhost/api/templates", "POST", {
          name: `Invalid ${contentMd.length}`,
          contentMd,
        }),
      );
      assert.equal(response.status, 400);
      assert.equal(
        ((await response.json()) as { error: { code: string } }).error.code,
        "VALIDATION",
      );
    }
  });

  await t.test("deleting or changing a template never changes copied notes", async () => {
    const template = repositories.listNoteTemplates()[0];
    assert.ok(template);
    const folder = repositories.listFolders()[0];
    const note = repositories.createNote({
      folderId: folder.id,
      title: "Copied from template",
      contentMd: template.contentMd,
    });

    repositories.updateNoteTemplate(template.id, {
      contentMd: "# A changed template",
    });
    assert.equal(repositories.getNote(note.id)?.contentMd, template.contentMd);

    const deleted = await itemRoute.DELETE(
      new Request(`http://localhost/api/templates/${template.id}`, {
        method: "DELETE",
      }),
      routeContext(template.id),
    );
    assert.equal(deleted.status, 204);
    assert.equal(repositories.getNote(note.id)?.contentMd, template.contentMd);
  });
});

function jsonRequest(url: string, method: string, body: unknown): Request {
  return new Request(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function routeContext(id: number): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id: String(id) }) };
}
