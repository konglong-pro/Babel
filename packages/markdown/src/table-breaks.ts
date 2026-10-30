interface MarkdownNode {
  type: string;
  value?: string;
  children?: MarkdownNode[];
}

/** Accept only plain table-cell breaks, without enabling raw HTML rendering. */
export function remarkTableBreaks(): (tree: MarkdownNode) => void {
  return (tree) => replaceTableBreaks(tree, false);
}

function replaceTableBreaks(node: MarkdownNode, inTableCell: boolean): void {
  const isTableCell = inTableCell || node.type === "tableCell";
  for (const child of node.children ?? []) {
    if (isTableCell && child.type === "html" && /^<br[ \t]*\/?>$/iu.test(child.value ?? "")) {
      child.type = "break";
      delete child.value;
    } else {
      replaceTableBreaks(child, isTableCell);
    }
  }
}
