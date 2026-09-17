import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");

const targets = [
  { label: "Bio", workspace: "apps/bio" },
  { label: "Esperanto", workspace: "apps/esperanto" },
  { label: "Herodotus", workspace: "apps/herodotus" },
  { label: "KLsche", workspace: "apps/klsche" },
  { label: "Leviathan", workspace: "apps/leviathan" },
  { label: "Ruider", workspace: "apps/ruider" },
  { label: "mirror-app template", workspace: "templates/mirror-app" },
] as const;

test("two-space app headers keep tabs and search in explicit responsive tracks", async () => {
  for (const target of targets) {
    const workspace = path.join(root, target.workspace);
    const styleDirectory = path.join(workspace, "src", "app");
    const [header, styleEntries] = await Promise.all([
      readFile(path.join(workspace, "src", "components", "app-header.tsx"), "utf8"),
      readdir(styleDirectory, { withFileTypes: true }),
    ]);
    const styles = (
      await Promise.all(
        styleEntries
          .filter((entry) => entry.isFile() && entry.name.endsWith(".css"))
          .map((entry) => readFile(path.join(styleDirectory, entry.name), "utf8")),
      )
    ).join("\n");

    assert.match(
      header,
      /import \{ usePathname \} from "next\/navigation"/,
      `${target.label} must derive its active tab from the current route`,
    );
    assert.match(
      header,
      /aria-current=\{pathname\.startsWith\("\/notes"\) \? "page" : undefined\}/,
      `${target.label} must expose the active Notes tab`,
    );
    assert.match(
      header,
      /aria-current=\{pathname\.startsWith\("\/canvases"\) \? "page" : undefined\}/,
      `${target.label} must expose the active Canvases tab`,
    );
    assert.ok(
      header.indexOf('className="app-nav"') < header.indexOf('className="global-search"'),
      `${target.label} must place its tab group before the rightmost search control`,
    );
    assert.match(
      styles,
      /\.app-header\s*\{[^}]*grid-template-columns:\s*[^;]+\sauto\s[^;]+;/,
      `${target.label} must reserve three explicit desktop header tracks`,
    );
    assert.match(
      styles,
      /\.app-nav a\[aria-current="page"\]\s*\{/,
      `${target.label} must visibly distinguish the active tab`,
    );
    assert.match(
      styles,
      /@media \(max-width: 760px\) \{[\s\S]*?\.app-header\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) auto;/,
      `${target.label} must keep the brand and tabs on the compact header row`,
    );
    assert.match(
      styles,
      /@media \(max-width: 760px\) \{[\s\S]*?\.global-search\s*\{[^}]*grid-column:\s*1 \/ -1;/,
      `${target.label} must give search its own full-width compact row`,
    );
    assert.doesNotMatch(
      styles,
      /\.app-header\s*\{[^}]*grid-template-columns:\s*minmax\([^;]+\)\s+minmax\([^;]+\);/,
      `${target.label} must not reintroduce a two-track desktop header override`,
    );
    assert.doesNotMatch(
      styles,
      /\.app-header\s*\{[^}]*grid-template-columns:\s*1fr;/,
      `${target.label} must not collapse three header children into one implicit column`,
    );
  }
});
