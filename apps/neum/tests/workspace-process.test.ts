import assert from "node:assert/strict";
import test from "node:test";

import {
  isNeumWorkspaceDestination,
  NEUM_WORKSPACE_PROCESSES,
  neumWorkspaceProcessKind,
} from "@/lib/workspace-process";

test("Neum recognizes only its stateful library routes as workspace processes", () => {
  assert.equal(neumWorkspaceProcessKind("/knowledge"), "knowledge");
  assert.equal(neumWorkspaceProcessKind("/code"), "snippet");
  assert.equal(neumWorkspaceProcessKind("/search"), null);
  assert.equal(isNeumWorkspaceDestination("/code?entry=2"), true);
  assert.equal(isNeumWorkspaceDestination("/search?q=map"), false);
  assert.deepEqual(
    NEUM_WORKSPACE_PROCESSES.map(({ key, scope }) => [key, scope]),
    [["knowledge", "knowledge"], ["snippet", "snippet"]],
  );
});
