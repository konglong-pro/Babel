import assert from "node:assert/strict";
import test from "node:test";
import { createPdfExcerptBroker } from "../src/excerpts";

const excerpt = { id: "excerpt-1", title: "Carbon", page: 1, text: "Four covalent bonds" };
type Owner = ReturnType<typeof createPdfExcerptBroker>;

function peer(t: test.TestContext, owner: Owner) {
  const channel = new BroadcastChannel(`babel:pdf:${owner.id}`);
  t.after(() => { channel.close(); owner.channel.close(); });
  return {
    send(message: object) { channel.postMessage({ v: 1, ...message }); },
    result(requestId: string): Promise<{ ok: boolean; error?: string }> {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { channel.removeEventListener("message", listen); reject(new Error("No protocol result")); }, 2000);
        const listen = (event: MessageEvent) => {
          if (event.data.kind !== "result" || event.data.requestId !== requestId) return;
          clearTimeout(timer); channel.removeEventListener("message", listen); resolve(event.data);
        };
        channel.addEventListener("message", listen);
      });
    },
  };
}

test("reader requests reach only their originating notebook window, and retries create one draft", async (t) => {
  const owner = createPdfExcerptBroker(), other = createPdfExcerptBroker();
  const reader = peer(t, owner); t.after(() => other.channel.close());
  let created = 0, otherCreated = 0;
  owner.creations.set("notes", { id: "notes", onCreate: async () => { created++; await new Promise((r) => setTimeout(r, 15)); } });
  other.creations.set("notes", { id: "notes", onCreate: () => { otherCreated++; } });
  const done = reader.result("same-request");
  const message = { kind: "excerpt", requestId: "same-request", mode: "new", excerpt };
  reader.send(message); reader.send(message);
  assert.equal((await done).ok, true);
  const retried = reader.result("same-request"); reader.send(message);
  assert.equal((await retried).ok, true);
  assert.equal(created, 1); assert.equal(otherCreated, 0);
});

test("new-note requests prepare the notebook route and wait for a ready workspace", async (t) => {
  const owner = createPdfExcerptBroker(), reader = peer(t, owner);
  let ready = false, created = 0, preparations = 0;
  owner.prepareCreation = () => {
    preparations++;
    owner.creations.set("notes", { id: "notes", isReady: () => ready, onCreate: () => { created++; } });
    setTimeout(() => { ready = true; }, 20);
  };
  const done = reader.result("new-request"); reader.send({ kind: "excerpt", requestId: "new-request", mode: "new", excerpt });
  assert.equal((await done).ok, true); assert.equal(preparations, 1); assert.equal(created, 1);
});

test("append rejects hidden, changed and saving drafts before delivering to the visible editor", async (t) => {
  const owner = createPdfExcerptBroker(), reader = peer(t, owner);
  let active = false, pending = false, appended = 0;
  owner.editors.set("draft-1", { id: "draft-1", title: "My draft", isActive: () => active, isPending: () => pending, onAppend: () => { appended++; } });
  async function send(id: string, targetId = "draft-1") {
    const done = reader.result(id); reader.send({ kind: "excerpt", requestId: id, mode: "append", targetId, excerpt }); return done;
  }
  assert.match((await send("hidden")).error!, /active draft changed/);
  active = true;
  assert.match((await send("changed", "draft-2")).error!, /active draft changed/);
  pending = true; assert.match((await send("pending")).error!, /saving/);
  pending = false; assert.equal((await send("visible")).ok, true);
  assert.equal(appended, 1);
});

test("malformed selections never enter a note", async (t) => {
  const owner = createPdfExcerptBroker(), reader = peer(t, owner);
  let created = 0;
  owner.creations.set("notes", { id: "notes", onCreate: () => { created++; } });
  const done = reader.result("invalid"); reader.send({ kind: "excerpt", requestId: "invalid", mode: "new", excerpt: { ...excerpt, imageDataUrl: "data:text/html;base64,WA==" } });
  assert.equal((await done).ok, false); assert.equal(created, 0);
});

test("HTML selections use the existing notebook adapters while retaining chapter metadata", async (t) => {
  const owner = createPdfExcerptBroker(), reader = peer(t, owner);
  const html = { ...excerpt, sourceType: "html" as const, location: "Bonding" };
  let received: unknown;
  owner.creations.set("notes", { id: "notes", onCreate: (value) => { received = value; } });
  const done = reader.result("html-request");
  reader.send({ kind: "excerpt", requestId: "html-request", mode: "new", excerpt: html });
  assert.equal((await done).ok, true);
  assert.deepEqual(received, html);
});
