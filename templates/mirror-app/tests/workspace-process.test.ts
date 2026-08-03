import assert from "node:assert/strict";
import test from "node:test";

import {
  APP_WORKSPACE_PROCESSES,
  appWorkspaceProcess,
  isAppWorkspaceDestination,
} from "@/lib/workspace-process";

test("the scaffold registers Notes as a persistent workspace process", () => {
  assert.equal(appWorkspaceProcess("/notes")?.key, "notes");
  assert.equal(appWorkspaceProcess("/notes/")?.key, "notes");
  assert.equal(appWorkspaceProcess("/search"), null);
  assert.equal(isAppWorkspaceDestination("/notes?folder=2&note=3"), true);
  assert.equal(isAppWorkspaceDestination("/notes/?folder=2&note=3"), true);
  assert.equal(isAppWorkspaceDestination("/search?q=syntax"), false);
  assert.deepEqual(APP_WORKSPACE_PROCESSES.map(({ key, scope }) => [key, scope]), [
    ["notes", "notes"],
  ]);
});
