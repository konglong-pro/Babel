export const CLIPBOARD_MARKDOWN_MAX_BYTES = 10 * 1024 * 1024;

const roleHeading = /^#{1,6}[ \t]+(?:user|assistant|system|developer|tool)[ \t]*#*[ \t]*$/iu;

/** Suggest a short editable title without treating David's role labels as titles. */
export function clipboardMarkdownTitle(markdown: string): string {
  let fence: { character: string; length: number } | null = null;
  for (const line of markdown.replace(/^\uFEFF/u, "").split(/\r?\n/u)) {
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/u.exec(line);
    if (fence) {
      if (marker && marker[1][0] === fence.character && marker[1].length >= fence.length && !marker[2].trim()) fence = null;
      continue;
    }
    if (marker) {
      fence = { character: marker[1][0], length: marker[1].length };
      continue;
    }
    if (!line.trim() || roleHeading.test(line) || /^\s*(?:[-*_]\s*){3,}$/u.test(line)) continue;
    const candidate = line.trim()
      .replace(/^#{1,6}\s+|\s+#+$/gu, "")
      .replace(/^(?:>\s*|[-+*]\s+|\d+[.)]\s+)/u, "")
      .replace(/!?(?:\[([^\]]+)\])\([^)]*\)/gu, "$1")
      .replace(/\\([\\`*_[\]<>$])/gu, "$1")
      .replace(/[`*_~]/gu, "")
      .replace(/[\u0000-\u001f\u007f/\\]/gu, " ")
      .replace(/\s+/gu, " ")
      .trim();
    if (candidate) return Array.from(candidate).slice(0, 120).join("");
  }
  return "Imported Markdown";
}

/** Reuse each notebook's existing Markdown import and unsaved-draft boundary. */
export function prepareClipboardMarkdownFile(markdown: string, title: string): File {
  if (!markdown.trim()) throw new Error("Paste some Markdown before opening a draft.");
  if (new TextEncoder().encode(markdown).byteLength > CLIPBOARD_MARKDOWN_MAX_BYTES) {
    throw new Error("Markdown content must not exceed 10 MiB.");
  }
  const trimmedTitle = title.trim();
  if (!trimmedTitle || trimmedTitle.length > 240 || /[\u0000-\u001f\u007f/\\]/u.test(trimmedTitle)) {
    throw new Error("Enter a title of 1–240 characters without slashes or control characters.");
  }
  return new File([markdown], `${trimmedTitle}.md`, { type: "text/markdown" });
}
