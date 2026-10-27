import { htmlBridgeSource } from "./bridge";

export const HTML_FRAME_SANDBOX = "allow-scripts";

/** Applied to /html-reader before inert parsing; inherited by its blob frame. */
export const HTML_READER_CONTENT_SECURITY_POLICY = "default-src 'none'; script-src 'self' blob: 'unsafe-inline' 'unsafe-eval'; style-src 'self' blob: 'unsafe-inline'; img-src 'self' blob: data:; font-src 'self' blob: data:; media-src 'self' blob: data:; connect-src 'self' blob:; frame-src blob:; worker-src 'none'; object-src 'none'; base-uri 'self'; form-action 'none'; manifest-src 'none'";

export interface HtmlDocumentOptions {
  html: string;
  entryPath: string;
  assetBaseUrl: string;
  channelId: string;
  documentId: string;
}
export interface HtmlDocumentSource { html: string; warnings: string[] }

/** Only the immutable resource namespace for this document may enter child CSP. */
export function htmlAssetBase(value: string): URL {
  const url = new URL(value);
  if (!/^https?:$/u.test(url.protocol) || url.username || url.password || url.search || url.hash ||
    !/^\/api\/html\/documents\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/assets\/$/u.test(url.pathname)) {
    throw new Error("The HTML resource location is invalid.");
  }
  return url;
}

export function htmlDocumentPolicy(assetBaseUrl: string): string {
  const base = htmlAssetBase(assetBaseUrl).href;
  return `default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' blob: ${base}; style-src 'unsafe-inline' blob: ${base}; img-src data: blob: ${base}; font-src data: blob: ${base}; media-src data: blob: ${base}; connect-src blob: ${base}; frame-src 'none'; worker-src 'none'; object-src 'none'; base-uri ${base}; form-action 'none'; manifest-src 'none'`;
}

function entryDirectory(entryPath: string): string {
  if (!entryPath || entryPath.length > 1_024 || entryPath.startsWith("/") || /[\\\u0000-\u001f\u007f]/u.test(entryPath) ||
    entryPath.split("/").some((segment) => !segment || segment === "." || segment === "..") || !/\.html?$/iu.test(entryPath)) {
    throw new Error("The HTML document path is invalid.");
  }
  return entryPath.split("/").slice(0, -1).map(encodeURIComponent).join("/");
}

/** Browser-only inert parsing. The caller must use the reader response CSP above. */
export function buildHtmlDocument(options: HtmlDocumentOptions): HtmlDocumentSource {
  const base = htmlAssetBase(options.assetBaseUrl);
  const directory = entryDirectory(options.entryPath);
  if (!/^[A-Za-z0-9_-]{16,128}$/u.test(options.channelId) || !/^[0-9a-f-]{36}$/u.test(options.documentId)) throw new Error("The HTML reading session is invalid.");
  if (options.html.length > 64 * 1024 * 1024) throw new Error("The HTML document exceeds the 64 MiB reading limit.");
  const parsed = new DOMParser().parseFromString(options.html, "text/html");
  const warnings = new Set<string>();
  for (const element of parsed.querySelectorAll("base, meta[http-equiv], iframe, frame, frameset, object, embed, portal")) {
    if (!element.matches("base,meta")) warnings.add("Embedded frames and plug-ins are disabled in the offline reader.");
    element.remove();
  }
  for (const element of parsed.querySelectorAll("link")) {
    if (/(?:^|\s)(?:preconnect|dns-prefetch|prefetch|prerender|manifest)(?:\s|$)/iu.test(element.getAttribute("rel") ?? "")) element.remove();
  }
  for (const element of parsed.querySelectorAll("[ping]")) element.removeAttribute("ping");
  for (const element of parsed.querySelectorAll("[target]")) element.removeAttribute("target");
  const documentBase = new URL(directory ? `${directory}/` : "", base);
  for (const element of parsed.querySelectorAll("[src],link[href],video[poster],input[formaction],form[action]")) {
    for (const attribute of ["src", "href", "poster", "formaction", "action"]) {
      const value = element.getAttribute(attribute);
      if (!value || value.startsWith("#") || /^data:/iu.test(value)) continue;
      let resolved: URL;
      try { resolved = value.startsWith("/") && !value.startsWith("//") ? new URL(value.slice(1), base) : new URL(value, documentBase); }
      catch { warnings.add("Some resources have invalid paths and cannot be loaded."); continue; }
      if (!resolved.href.startsWith(base.href)) warnings.add("Offline mode blocks external or missing resources. Include required scripts, stylesheets and images in the imported folder.");
      else element.setAttribute(attribute, resolved.href);
    }
    if (element.matches("script[src],link[rel~='stylesheet'],img,video,audio")) element.setAttribute("crossorigin", "anonymous");
  }
  const policy = parsed.createElement("meta");
  policy.httpEquiv = "Content-Security-Policy";
  policy.content = htmlDocumentPolicy(base.href);
  const charset = parsed.createElement("meta");
  charset.setAttribute("charset", "utf-8");
  const referrer = parsed.createElement("meta");
  referrer.name = "referrer";
  referrer.content = "no-referrer";
  const baseElement = parsed.createElement("base");
  baseElement.href = documentBase.href;
  const bridge = parsed.createElement("script");
  bridge.setAttribute("data-babel-html-bridge", "");
  bridge.textContent = htmlBridgeSource({ channelId: options.channelId, documentId: options.documentId, assetBaseUrl: base.href, entryPath: options.entryPath });
  parsed.head.prepend(charset, policy, referrer, baseElement, bridge);
  return { html: `<!doctype html>\n${parsed.documentElement.outerHTML}`, warnings: [...warnings] };
}
