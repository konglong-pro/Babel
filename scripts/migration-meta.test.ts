import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

type Journal = {
  dialect: string;
  entries: Array<{
    idx: number;
    tag: string;
    version: string;
    when: number;
  }>;
};

type Snapshot = {
  dialect: string;
  id: string;
  prevId: string;
  version: string;
};

const root = path.resolve(import.meta.dirname, "..");
const registry = JSON.parse(
  await readFile(path.join(root, "babel.apps.json"), "utf8"),
) as { apps: Array<{ id: string; workspace: string }> };

test("migration journals, SQL files, and snapshots stay in one lineage", async (t) => {
  const migrationRoots = [
    ...registry.apps.map((app) => ({
      label: app.id,
      directory: path.join(root, app.workspace, "drizzle"),
    })),
    {
      label: "mirror-app template",
      directory: path.join(root, "templates", "mirror-app", "drizzle"),
    },
  ];

  for (const migrationRoot of migrationRoots) {
    await t.test(migrationRoot.label, async () => {
      const metaDirectory = path.join(migrationRoot.directory, "meta");
      const journal = JSON.parse(
        await readFile(path.join(metaDirectory, "_journal.json"), "utf8"),
      ) as Journal;
      let previousSnapshot: Snapshot | undefined;
      let previousMigrationTime = Number.NEGATIVE_INFINITY;
      const snapshotIds = new Set<string>();

      for (const [position, entry] of journal.entries.entries()) {
        assert.equal(entry.idx, position);
        assert.match(entry.tag, new RegExp(`^${String(entry.idx).padStart(4, "0")}_`));
        assert.equal(Number.isSafeInteger(entry.when), true);
        assert.ok(entry.when > previousMigrationTime);
        previousMigrationTime = entry.when;
        await access(path.join(migrationRoot.directory, `${entry.tag}.sql`));
        const snapshot = JSON.parse(
          await readFile(
            path.join(
              metaDirectory,
              `${String(entry.idx).padStart(4, "0")}_snapshot.json`,
            ),
            "utf8",
          ),
        ) as Snapshot;

        assert.equal(snapshot.version, entry.version);
        assert.equal(snapshot.dialect, journal.dialect);
        assert.equal(snapshotIds.has(snapshot.id), false);
        snapshotIds.add(snapshot.id);
        assert.equal(
          snapshot.prevId,
          previousSnapshot?.id ?? "00000000-0000-0000-0000-000000000000",
        );
        previousSnapshot = snapshot;
      }
    });
  }
});
