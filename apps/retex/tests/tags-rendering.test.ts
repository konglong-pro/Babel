import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { Tags } from "@/components/shared";

test("Tags keeps a stable search target for empty and populated metadata", () => {
  const empty = renderToStaticMarkup(createElement(Tags, { tags: [] }));
  const populated = renderToStaticMarkup(createElement(Tags, { tags: ["algebra"] }));

  assert.match(empty, /data-search-field="tags"/);
  assert.match(empty, />No tags</);
  assert.match(populated, /data-search-field="tags"/);
  assert.match(populated, />algebra</);
});
