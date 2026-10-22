import assert from "node:assert/strict";
import test from "node:test";

import type { StagedImage } from "@babel-apps/markdown/react";

import {
  createExercise,
  createKnowledge,
  type ExerciseInput,
  type KnowledgeInput,
  updateExercise,
  updateKnowledge,
} from "@/lib/api-client";

const knowledgeInput: KnowledgeInput = {
  folderId: 1,
  parentId: null,
  title: "Limits",
  contentMd: "# Limits",
  tags: ["analysis"],
  exerciseIds: [2],
};

const exerciseInput: ExerciseInput = {
  folderId: 1,
  title: "A limit exercise",
  problemMd: "Problem statement",
  answerMd: "42",
  solutionMd: "# Solution",
  tags: ["analysis"],
  knowledgeIds: [3],
};

test("Markdown mutations keep JSON requests when no images are staged", async (t) => {
  const calls = captureFetch(t);

  await createKnowledge(knowledgeInput);
  await createExercise(exerciseInput);

  assert.equal(calls.length, 2);
  assert.equal(calls[0]?.path, "/api/knowledge");
  assert.equal(calls[0]?.init.method, "POST");
  assert.equal(calls[0]?.init.body, JSON.stringify(knowledgeInput));
  assert.equal(new Headers(calls[0]?.init.headers).get("content-type"), "application/json");
  assert.equal(calls[1]?.path, "/api/exercises");
  assert.equal(calls[1]?.init.body, JSON.stringify(exerciseInput));
  assert.equal(new Headers(calls[1]?.init.headers).get("content-type"), "application/json");
});

test("Markdown mutations send payload and token-keyed image files when staged", async (t) => {
  const calls = captureFetch(t);
  const stagedImage = image("proof-token", "proof.png");

  await updateKnowledge(7, knowledgeInput, [stagedImage]);
  await updateExercise(9, exerciseInput, [stagedImage]);

  assert.equal(calls.length, 2);
  assertMultipartCall(calls[0], "/api/knowledge/7", knowledgeInput, stagedImage);
  assertMultipartCall(calls[1], "/api/exercises/9", exerciseInput, stagedImage);
});

interface FetchCall {
  path: string;
  init: RequestInit;
}

function captureFetch(t: test.TestContext): FetchCall[] {
  const originalFetch = globalThis.fetch;
  const calls: FetchCall[] = [];
  globalThis.fetch = async (input, init = {}) => {
    calls.push({ path: String(input), init });
    return Response.json({});
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  return calls;
}

function image(token: string, name: string): StagedImage {
  return {
    token,
    file: new File(["image bytes"], name, { type: "image/png" }),
    previewUrl: `blob:${token}`,
  };
}

function assertMultipartCall(
  call: FetchCall | undefined,
  path: string,
  payload: unknown,
  stagedImage: StagedImage,
) {
  assert.ok(call);
  assert.equal(call.path, path);
  assert.equal(call.init.method, "PATCH");
  assert.equal(new Headers(call.init.headers).get("content-type"), null);
  assert.ok(call.init.body instanceof FormData);
  assert.equal(call.init.body.get("payload"), JSON.stringify(payload));
  const uploaded = call.init.body.get(`image:${stagedImage.token}`);
  assert.ok(uploaded instanceof File);
  assert.equal(uploaded.name, stagedImage.file.name);
  assert.deepEqual([...call.init.body.keys()].sort(), [
    `image:${stagedImage.token}`,
    "payload",
  ]);
}
