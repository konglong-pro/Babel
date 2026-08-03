import assert from "node:assert/strict";
import test from "node:test";
import {
  pageBelongsToWorkspaceProcess,
  workspaceProcessPageKey,
} from "@babel-apps/platform/pages/react";

import {
  isValiWorkspaceDestination,
  valiWorkspaceProcess,
  valiWorkspaceRegistration,
} from "@/lib/workspace-process";

const pages = [
  {
    key: "note:1",
    kind: "Note",
    title: "N1",
    href: "/notes?note=1",
    scope: "notes",
  },
  {
    key: "reflection:2040-01-02",
    kind: "Reflection",
    title: "2040-01-02",
    href: "/reflection?date=2040-01-02",
    scope: "reflection",
  },
  {
    key: "note:2",
    kind: "Note",
    title: "N2",
    href: "/notes?note=2",
    scope: "notes",
  },
];

test("Vali recognizes Notes and Reflection workspace destinations", () => {
  assert.equal(valiWorkspaceProcess("/notes"), "notes");
  assert.equal(valiWorkspaceProcess("/notes/"), "notes");
  assert.equal(valiWorkspaceProcess("/reflection"), "reflection");
  assert.equal(valiWorkspaceProcess("/search"), null);
  assert.equal(isValiWorkspaceDestination("/notes?folder=3&note=8"), true);
  assert.equal(isValiWorkspaceDestination("/reflection?date=2040-01-02"), true);
  assert.equal(isValiWorkspaceDestination("/search?q=needle"), false);
});

test("each Vali workspace restores its remembered page independently", () => {
  assert.equal(workspaceProcessPageKey(
    pages,
    valiWorkspaceRegistration("notes"),
    "note:1",
  ), "note:1");
  assert.equal(workspaceProcessPageKey(
    pages,
    valiWorkspaceRegistration("notes"),
    "missing",
  ), "note:2");
  assert.equal(workspaceProcessPageKey(
    pages,
    valiWorkspaceRegistration("reflection"),
    "note:1",
  ), "reflection:2040-01-02");
});

test("legacy Vali descriptors without scope remain assigned by kind", () => {
  assert.equal(pageBelongsToWorkspaceProcess(
    { key: "note:3", kind: "Note" },
    valiWorkspaceRegistration("notes"),
  ), true);
  assert.equal(pageBelongsToWorkspaceProcess(
    { key: "reflection:2040-01-03", kind: "Reflection" },
    valiWorkspaceRegistration("reflection"),
  ), true);
  assert.equal(pageBelongsToWorkspaceProcess(
    { key: "note:3", kind: "Note" },
    valiWorkspaceRegistration("reflection"),
  ), false);
});
