import assert from "node:assert/strict";
import test from "node:test";

import {
  isNeumWorkspaceDestination,
  NEUM_WORKSPACE_PROCESSES,
  neumWorkspaceProcess,
  neumWorkspaceProcessKind,
} from "@/lib/workspace-process";

test("Neum recognizes its stateful entry and Canvas routes as workspace processes", () => {
  assert.equal(neumWorkspaceProcess("/canvases")?.key, "canvases");
  assert.equal(neumWorkspaceProcessKind("/knowledge"), "knowledge");
  assert.equal(neumWorkspaceProcessKind("/code"), "snippet");
  assert.equal(neumWorkspaceProcessKind("/search"), null);
  assert.equal(isNeumWorkspaceDestination("/code?entry=2"), true);
  assert.equal(isNeumWorkspaceDestination("/canvases?canvas=4"), true);
  assert.equal(isNeumWorkspaceDestination("/search?q=map"), false);
  assert.deepEqual(
    NEUM_WORKSPACE_PROCESSES.map(({ key, scope }) => [key, scope]),
    [["canvases", "canvases"], ["knowledge", "knowledge"], ["snippet", "snippet"]],
  );
});
