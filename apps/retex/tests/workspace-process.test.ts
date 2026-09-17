import assert from "node:assert/strict";
import test from "node:test";
import {
  createWorkspaceProcessRouteTargetTracker,
  pageBelongsToWorkspaceProcess,
  workspaceProcessRouteTargetShouldApply,
  workspaceProcessPageKey,
} from "@babel-apps/platform/pages/react";

import {
  isRetexWorkspaceDestination,
  retexWorkspaceProcess,
  retexWorkspaceRegistration,
  scratchExerciseId,
} from "@/lib/workspace-process";

const pages = [
  {
    key: "canvas:4",
    kind: "Canvas",
    title: "C1",
    href: "/canvases?canvas=4",
    scope: "canvases",
  },
  {
    key: "knowledge:1",
    kind: "Knowledge",
    title: "K1",
    href: "/knowledge?item=1",
    scope: "knowledge",
  },
  {
    key: "exercise:2",
    kind: "Exercise",
    title: "E1",
    href: "/exercise?item=2",
    scope: "exercise",
  },
  {
    key: "scratch:2",
    kind: "Scratch",
    title: "S2",
    href: "/exercise/2/scratch",
    scope: "scratch:2",
  },
  {
    key: "knowledge:3",
    kind: "Knowledge",
    title: "K2",
    href: "/knowledge?item=3",
    scope: "knowledge",
  },
];

test("ReTex recognizes Canvas, archive, and dynamic Scratch workspace processes", () => {
  assert.equal(retexWorkspaceProcess("/canvases"), "canvases");
  assert.equal(retexWorkspaceProcess("/knowledge"), "knowledge");
  assert.equal(retexWorkspaceProcess("/exercise/"), "exercise");
  assert.equal(retexWorkspaceProcess("/exercise/27/scratch"), "scratch:27");
  assert.equal(retexWorkspaceProcess("/exercise/0/scratch"), null);
  assert.equal(retexWorkspaceProcess("/search"), null);
  assert.equal(scratchExerciseId("scratch:27"), 27);
  assert.equal(scratchExerciseId("exercise"), null);
  assert.equal(isRetexWorkspaceDestination("/exercise/27/scratch?mode=edit"), true);
  assert.equal(isRetexWorkspaceDestination("/canvases?canvas=4"), true);
  assert.equal(isRetexWorkspaceDestination("/search?q=lemma"), false);
});

test("each ReTex process restores its remembered page independently", () => {
  assert.equal(workspaceProcessPageKey(
    pages,
    retexWorkspaceRegistration("canvases"),
    null,
  ), "canvas:4");
  assert.equal(workspaceProcessPageKey(
    pages,
    retexWorkspaceRegistration("knowledge"),
    "knowledge:1",
  ), "knowledge:1");
  assert.equal(workspaceProcessPageKey(
    pages,
    retexWorkspaceRegistration("knowledge"),
    "missing",
  ), "knowledge:3");
  assert.equal(workspaceProcessPageKey(
    pages,
    retexWorkspaceRegistration("exercise"),
    "knowledge:1",
  ), "exercise:2");
  assert.equal(workspaceProcessPageKey(
    pages,
    retexWorkspaceRegistration("scratch:2"),
    null,
  ), "scratch:2");
  assert.equal(workspaceProcessPageKey(
    pages,
    retexWorkspaceRegistration("scratch:9"),
    null,
  ), null);
});

test("legacy descriptors without scope remain assigned to their process", () => {
  assert.equal(pageBelongsToWorkspaceProcess(
    { key: "knowledge:4", kind: "Knowledge" },
    retexWorkspaceRegistration("knowledge"),
  ), true);
  assert.equal(pageBelongsToWorkspaceProcess(
    { key: "scratch:4", kind: "Scratch" },
    retexWorkspaceRegistration("scratch:4"),
  ), true);
  assert.equal(pageBelongsToWorkspaceProcess(
    { key: "scratch:4", kind: "Scratch" },
    retexWorkspaceRegistration("scratch:5"),
  ), false);
});

test("ReTex preserves archive context when a process returns through a bare route", () => {
  const tracker = createWorkspaceProcessRouteTargetTracker();

  assert.equal(workspaceProcessRouteTargetShouldApply(tracker, true, ""), true);
  assert.equal(workspaceProcessRouteTargetShouldApply(tracker, false, ""), false);
  assert.equal(workspaceProcessRouteTargetShouldApply(tracker, true, ""), false);
  assert.equal(
    workspaceProcessRouteTargetShouldApply(tracker, true, "folder=7"),
    true,
  );
});
