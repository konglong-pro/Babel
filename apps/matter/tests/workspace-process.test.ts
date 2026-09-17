import assert from "node:assert/strict";
import test from "node:test";
import {
  createWorkspaceProcessRouteTargetTracker,
  pageBelongsToWorkspaceProcess,
  workspaceProcessRouteTargetShouldApply,
  workspaceProcessPageKey,
} from "@babel-apps/platform/pages/react";

import {
  isMatterWorkspaceDestination,
  matterWorkspaceProcess,
  matterWorkspaceRegistration,
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

test("Matter recognizes Canvas, archive, and dynamic Scratch workspace processes", () => {
  assert.equal(matterWorkspaceProcess("/canvases"), "canvases");
  assert.equal(matterWorkspaceProcess("/knowledge"), "knowledge");
  assert.equal(matterWorkspaceProcess("/exercise/"), "exercise");
  assert.equal(matterWorkspaceProcess("/exercise/27/scratch"), "scratch:27");
  assert.equal(matterWorkspaceProcess("/exercise/0/scratch"), null);
  assert.equal(matterWorkspaceProcess("/search"), null);
  assert.equal(scratchExerciseId("scratch:27"), 27);
  assert.equal(scratchExerciseId("exercise"), null);
  assert.equal(isMatterWorkspaceDestination("/exercise/27/scratch?mode=edit"), true);
  assert.equal(isMatterWorkspaceDestination("/canvases?canvas=4"), true);
  assert.equal(isMatterWorkspaceDestination("/search?q=gravity"), false);
});

test("each Matter process restores its remembered page independently", () => {
  assert.equal(workspaceProcessPageKey(
    pages,
    matterWorkspaceRegistration("canvases"),
    null,
  ), "canvas:4");
  assert.equal(workspaceProcessPageKey(
    pages,
    matterWorkspaceRegistration("knowledge"),
    "knowledge:1",
  ), "knowledge:1");
  assert.equal(workspaceProcessPageKey(
    pages,
    matterWorkspaceRegistration("knowledge"),
    "missing",
  ), "knowledge:3");
  assert.equal(workspaceProcessPageKey(
    pages,
    matterWorkspaceRegistration("exercise"),
    "knowledge:1",
  ), "exercise:2");
  assert.equal(workspaceProcessPageKey(
    pages,
    matterWorkspaceRegistration("scratch:2"),
    null,
  ), "scratch:2");
  assert.equal(workspaceProcessPageKey(
    pages,
    matterWorkspaceRegistration("scratch:9"),
    null,
  ), null);
});

test("legacy Scratch descriptors match only their exact dynamic process", () => {
  assert.equal(pageBelongsToWorkspaceProcess(
    { key: "knowledge:4", kind: "Knowledge" },
    matterWorkspaceRegistration("knowledge"),
  ), true);
  assert.equal(pageBelongsToWorkspaceProcess(
    { key: "scratch:4", kind: "Scratch" },
    matterWorkspaceRegistration("scratch:4"),
  ), true);
  assert.equal(pageBelongsToWorkspaceProcess(
    { key: "scratch:4", kind: "Scratch" },
    matterWorkspaceRegistration("scratch:5"),
  ), false);
});

test("Matter preserves archive context when a process returns through a bare route", () => {
  const tracker = createWorkspaceProcessRouteTargetTracker();

  assert.equal(workspaceProcessRouteTargetShouldApply(tracker, true, ""), true);
  assert.equal(workspaceProcessRouteTargetShouldApply(tracker, false, ""), false);
  assert.equal(workspaceProcessRouteTargetShouldApply(tracker, true, ""), false);
  assert.equal(
    workspaceProcessRouteTargetShouldApply(tracker, true, "folder=7"),
    true,
  );
});
