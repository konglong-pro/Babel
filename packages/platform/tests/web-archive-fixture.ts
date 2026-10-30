import type { WebArchive } from "../src/imports/web-archive-core";

export const archivePng = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jwX8AAAAASUVORK5CYII=";

export function archiveFixture(): WebArchive {
  return {
    format: "babel.web-archive", version: 1, title: "Synthetic photo and wave",
    markdown: "## Assistant\n\nA wave and its caption.\n\n![Wave](assets/wave.png)\n\n```js\nconst x = '<tag>';\n```\n",
    source: { url: "https://example.test/conversation", title: "Synthetic conversation", capturedAt: "2026-10-20T13:00:00.000Z" },
    assets: [{ id: "wave", name: "wave.png", mimeType: "image/png", dataBase64: archivePng }],
    snapshot: {
      width: 800, background: "rgb(255, 255, 255)",
      tree: {
        tag: "article", attrs: { "data-role": "assistant" },
        style: { display: "grid", "grid-template-columns": "minmax(0px, 1fr)", gap: "12px", color: "rgb(30, 30, 30)", "font-family": '"Arial", sans-serif' },
        children: [
          { tag: "h2", children: ["Wave <caption> & explanation"] },
          { tag: "figure", children: [
            { tag: "img", attrs: { src: "babel-asset://wave", alt: 'Wave "diagram"' }, style: { width: "200px", transform: "matrix(1, 0, 0, 1, 0, 0)" } },
            { tag: "figcaption", children: ["A synthetic wave."] },
          ] },
          { tag: "pre", children: [{ tag: "code", children: ["const x = '<tag>';\n"] }] },
        ],
      },
    },
    warnings: ["Interactive controls are captured as static content."],
  };
}
