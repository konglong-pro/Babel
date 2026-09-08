export interface PickerFolder {
  id: number;
  parentId: number | null;
  name: string;
  position?: number;
}

export interface PickerFolderNode {
  folder: PickerFolder;
  parentId: number | null;
  path: string;
  parentPath: string;
  depth: number;
  siblingIndex: number;
  siblingCount: number;
  children: PickerFolderNode[];
}

export interface PickerFolderTree {
  roots: PickerFolderNode[];
  nodes: PickerFolderNode[];
  byId: ReadonlyMap<number, PickerFolderNode>;
}

/** Group the server's ordered siblings without alphabetizing or flattening their hierarchy. */
export function buildPickerFolderTree(folders: readonly PickerFolder[]): PickerFolderTree {
  const foldersById = new Map(folders.map((folder) => [folder.id, folder]));
  const childrenByParent = new Map<number | null, PickerFolder[]>();
  for (const folder of folders) {
    const parentId = folder.parentId !== folder.id && foldersById.has(folder.parentId as number)
      ? folder.parentId
      : null;
    const siblings = childrenByParent.get(parentId) ?? [];
    siblings.push(folder);
    childrenByParent.set(parentId, siblings);
  }

  const nodes: PickerFolderNode[] = [];
  const byId = new Map<number, PickerFolderNode>();
  function append(folder: PickerFolder, parent: PickerFolderNode | null, index: number, count: number) {
    if (byId.has(folder.id)) return null;
    const node: PickerFolderNode = {
      folder,
      parentId: parent?.folder.id ?? null,
      path: parent ? `${parent.path} / ${folder.name}` : folder.name,
      parentPath: parent?.path ?? "",
      depth: parent ? parent.depth + 1 : 0,
      siblingIndex: index,
      siblingCount: count,
      children: [],
    };
    byId.set(folder.id, node);
    nodes.push(node);
    const children = childrenByParent.get(folder.id) ?? [];
    for (const [childIndex, child] of children.entries()) {
      const childNode = append(child, node, childIndex, children.length);
      if (childNode) node.children.push(childNode);
    }
    return node;
  }

  const roots: PickerFolderNode[] = [];
  const rootFolders = childrenByParent.get(null) ?? [];
  for (const [index, folder] of rootFolders.entries()) {
    const root = append(folder, null, index, rootFolders.length);
    if (root) roots.push(root);
  }
  // Keep a malformed/orphaned branch reachable without following cycles indefinitely.
  for (const folder of folders) {
    if (byId.has(folder.id)) continue;
    const root = append(folder, null, roots.length, roots.length + 1);
    if (root) roots.push(root);
  }
  for (const root of roots) root.siblingCount = roots.length;
  return { roots, nodes, byId };
}

export function pickerAncestorIds(tree: PickerFolderTree, id: number | null): Set<number> {
  const result = new Set<number>();
  let node = id === null ? undefined : tree.byId.get(id);
  while (node?.parentId !== null && node?.parentId !== undefined) {
    result.add(node.parentId);
    node = tree.byId.get(node.parentId);
  }
  return result;
}

export function visiblePickerFolders(
  tree: PickerFolderTree,
  expandedIds: ReadonlySet<number>,
  query: string,
): PickerFolderNode[] {
  const tokens = query.trim().toLocaleLowerCase().split(/\s+/u).filter(Boolean);
  if (tokens.length) {
    return tree.nodes.filter((node) => {
      const path = node.path.toLocaleLowerCase();
      return tokens.every((token) => path.includes(token));
    });
  }
  const result: PickerFolderNode[] = [];
  function append(nodes: readonly PickerFolderNode[]) {
    for (const node of nodes) {
      result.push(node);
      if (expandedIds.has(node.folder.id)) append(node.children);
    }
  }
  append(tree.roots);
  return result;
}
