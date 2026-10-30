import { normalizeHtmlAssetPath } from "@babel-apps/platform/html/core";

// A stable stand-in for the same resource namespace used by the reader.
const inspectionBase = "https://babel-html.invalid/api/html/documents/00000000-0000-4000-8000-000000000000/assets/";

export type HtmlResourceLocation = { kind: "inline" | "outside" | "invalid" } | { kind: "local"; path: string };

/** Match the browser's URL resolution, but never turn a URL into a disk path. */
export function resolveHtmlResource(reference: string, entryPath: string, assetBaseUrl = inspectionBase): HtmlResourceLocation {
  const value = reference.trim();
  if (!value || value.startsWith("#") || /^(?:data|blob):/iu.test(value)) return { kind: "inline" };
  try {
    const base = new URL(assetBaseUrl);
    const directory = entryPath.split("/").slice(0, -1).map(encodeURIComponent).join("/");
    const documentBase = new URL(directory ? `${directory}/` : "", base);
    const resolved = value.startsWith("/") && !value.startsWith("//") ? new URL(value.slice(1), base) : new URL(value, documentBase);
    if (!resolved.href.startsWith(base.href)) return { kind: "outside" };
    const path = normalizeHtmlAssetPath(decodeURIComponent(resolved.pathname.slice(base.pathname.length)));
    return path === null ? { kind: "invalid" } : { kind: "local", path };
  } catch { return { kind: "invalid" }; }
}

export function htmlResourceWarnings(references: Iterable<string>, entryPath: string, availablePaths: Iterable<string>, assetBaseUrl = inspectionBase): string[] {
  const available = new Set(Array.from(availablePaths, (path) => path.normalize("NFC")));
  const warnings = new Set<string>();
  for (const reference of references) {
    const location = resolveHtmlResource(reference, entryPath, assetBaseUrl);
    const label = reference.trim().slice(0, 240);
    if (location.kind === "local" && !available.has(location.path)) warnings.add(`Missing local resource: ${label}`);
    else if (location.kind === "outside") warnings.add(`Blocked resource outside the imported folder: ${label}`);
    else if (location.kind === "invalid") warnings.add(`Invalid resource path: ${label}`);
  }
  return [...warnings];
}

/** Inert inspection only; source scripts are never executed here. */
export function inspectHtmlResources(document: Document | DocumentFragment, entryPath: string, availablePaths: Iterable<string>, assetBaseUrl = inspectionBase): string[] {
  const references: string[] = [];
  for (const element of document.querySelectorAll("script[src],link[rel~='stylesheet'][href],img[src],source[src],video[src],video[poster],audio[src],track[src],input[type='image'][src]")) {
    for (const attribute of ["src", "href", "poster"]) {
      const reference = element.getAttribute(attribute);
      if (reference) references.push(reference);
    }
  }
  return htmlResourceWarnings(references, entryPath, availablePaths, assetBaseUrl);
}
