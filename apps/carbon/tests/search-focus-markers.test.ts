import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { Tags } from "@/components/shared";

test("tag search targets remain present for empty and populated tags", () => {
  const empty = renderToStaticMarkup(createElement(Tags, { tags: [] }));
  const populated = renderToStaticMarkup(createElement(Tags, { tags: ["one"] }));

  assert.match(empty, /data-search-field="tags"/);
  assert.match(populated, /data-search-field="tags"/);
});
