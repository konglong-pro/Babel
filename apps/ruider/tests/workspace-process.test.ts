import assert from "node:assert/strict";
import test from "node:test";
import {
  pageBelongsToWorkspaceProcess,
  workspaceProcessPageKey,
} from "@babel-apps/platform/pages/react";

import {
  isRuiderWorkspaceDestination,
  RUIDER_WORKSPACE_PROCESSES,
  ruiderWorkspaceProcess,
  ruiderWorkspaceRegistration,
} from "@/lib/workspace-process";

const pages = [
  {
    key: "canvas:1",
    kind: "Canvas",
    scope: "canvases",
    title: "Map",
    href: "/canvases?canvas=1",
  },
  {
    key: "note:2",
    kind: "Note",
    scope: "notes",
    title: "Draft",
    href: "/notes?note=2",
  },
  {
    key: "canvas:3",
    kind: "Canvas",
    scope: "canvases",
    title: "Second map",
    href: "/canvases?canvas=3",
  },
];

test("Ruider recognizes only its stateful workspace routes", () => {
  assert.equal(ruiderWorkspaceProcess("/canvases"), "canvases");
  assert.equal(ruiderWorkspaceProcess("/notes/"), "notes");
  assert.equal(ruiderWorkspaceProcess("/search"), null);
  assert.equal(isRuiderWorkspaceDestination("/notes?note=2"), true);
  assert.equal(isRuiderWorkspaceDestination("/search?q=map"), false);
  assert.deepEqual(
    RUIDER_WORKSPACE_PROCESSES.map(({ key, scope }) => [key, scope]),
    [["canvases", "canvases"], ["notes", "notes"]],
  );
});

test("each Ruider workspace restores its remembered page independently", () => {
  assert.equal(workspaceProcessPageKey(
    pages,
    ruiderWorkspaceRegistration("canvases"),
    "canvas:1",
  ), "canvas:1");
  assert.equal(workspaceProcessPageKey(
    pages,
    ruiderWorkspaceRegistration("canvases"),
    "missing",
  ), "canvas:3");
  assert.equal(workspaceProcessPageKey(
    pages,
    ruiderWorkspaceRegistration("notes"),
    "canvas:1",
  ), "note:2");
});

test("legacy Ruider descriptors without scope retain kind-based ownership", () => {
  assert.equal(pageBelongsToWorkspaceProcess(
    { key: "canvas:4", kind: "Canvas" },
    ruiderWorkspaceRegistration("canvases"),
  ), true);
  assert.equal(pageBelongsToWorkspaceProcess(
    { key: "note:5", kind: "Note" },
    ruiderWorkspaceRegistration("notes"),
  ), true);
  assert.equal(pageBelongsToWorkspaceProcess(
    { key: "note:5", kind: "Note" },
    ruiderWorkspaceRegistration("canvases"),
  ), false);
});
