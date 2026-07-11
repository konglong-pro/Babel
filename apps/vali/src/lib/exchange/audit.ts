import { planTrashMarkdownFiles } from "./markdown-writer";
import type { VaultSnapshot } from "./types";

type SnapshotCategory = VaultSnapshot["categories"][number];
type SnapshotEntry = VaultSnapshot["entries"][number];
type SnapshotReflection = VaultSnapshot["reflections"][number];
type SnapshotTrash = VaultSnapshot["trash"][number];

export type AuditSeverity = "error" | "warning";

export interface AuditIssue {
  severity: AuditSeverity;
  code: string;
  path: string;
  message: string;
  expected?: unknown;
  actual?: unknown;
}

export interface AuditEntityCounts {
  config: number;
  categories: number;
  entries: number;
  reflections: number;
  trash: number;
}

export interface AuditCounts {
  source: AuditEntityCounts;
  target: AuditEntityCounts;
  compared: AuditEntityCounts;
  errors: number;
  warnings: number;
}

export interface VaultAuditReport {
  equal: boolean;
  ok: boolean;
  errors: AuditIssue[];
  warnings: AuditIssue[];
  counts: AuditCounts;
}

export class VaultAuditError extends Error {
  readonly report: VaultAuditReport;

  constructor(report: VaultAuditReport) {
    super(
      `Vault semantic audit failed with ${report.errors.length} error${
        report.errors.length === 1 ? "" : "s"
      }`,
    );
    this.name = "VaultAuditError";
    this.report = report;
  }
}

export function auditVaultSnapshots(
  source: VaultSnapshot,
  target: VaultSnapshot,
): VaultAuditReport {
  const errors: AuditIssue[] = [];
  const warnings: AuditIssue[] = [];
  const compared: AuditEntityCounts = {
    config: 1,
    categories: 0,
    entries: 0,
    reflections: 0,
    trash: 0,
  };

  validateSnapshot(source, "source", errors);
  validateSnapshot(target, "target", errors);
  compareConfig(source, target, errors);
  compared.categories = compareCategories(source.categories, target.categories, errors);
  compared.entries = compareEntries(source.entries, target.entries, errors);
  compared.reflections = compareReflections(
    source.reflections,
    target.reflections,
    errors,
  );
  compared.trash = compareTrash(source.trash, target.trash, errors);

  errors.sort(compareIssues);
  warnings.sort(compareIssues);
  const equal = errors.length === 0;
  return {
    equal,
    ok: equal,
    errors,
    warnings,
    counts: {
      source: entityCounts(source),
      target: entityCounts(target),
      compared,
      errors: errors.length,
      warnings: warnings.length,
    },
  };
}

export function assertVaultSnapshotsEqual(
  source: VaultSnapshot,
  target: VaultSnapshot,
): VaultAuditReport {
  const report = auditVaultSnapshots(source, target);
  if (!report.equal) {
    throw new VaultAuditError(report);
  }
  return report;
}

function compareConfig(
  source: VaultSnapshot,
  target: VaultSnapshot,
  errors: AuditIssue[],
): void {
  compareFields(
    source.config,
    target.config,
    ["name", "version", "createdAt", "defaultCategoryId"],
    "config",
    "config.field_mismatch",
    errors,
  );
}

function compareCategories(
  source: readonly SnapshotCategory[],
  target: readonly SnapshotCategory[],
  errors: AuditIssue[],
): number {
  const sourceById = indexFirst(source, (category) => category.id);
  const targetById = indexFirst(target, (category) => category.id);
  let compared = 0;

  for (const [id, expected] of sourceById) {
    const actual = targetById.get(id);
    if (actual === undefined) {
      addIssue(errors, "error", "category.missing", `categories.${id}`, "Category is missing", expected);
      continue;
    }
    compared += 1;
    compareFields(
      expected,
      actual,
      ["id", "name", "order", "content", "createdAt", "updatedAt"],
      `categories.${id}`,
      "category.field_mismatch",
      errors,
    );
  }
  for (const [id, actual] of targetById) {
    if (!sourceById.has(id)) {
      addIssue(errors, "error", "category.extra", `categories.${id}`, "Unexpected category", undefined, actual);
    }
  }
  return compared;
}

function compareEntries(
  source: readonly SnapshotEntry[],
  target: readonly SnapshotEntry[],
  errors: AuditIssue[],
): number {
  const sourceById = indexFirst(source, (entry) => entry.id);
  const targetById = indexFirst(target, (entry) => entry.id);
  let compared = 0;

  for (const [id, expected] of sourceById) {
    const actual = targetById.get(id);
    if (actual === undefined) {
      addIssue(errors, "error", "entry.missing", `entries.${id}`, "Entry is missing", expected);
      continue;
    }
    compared += 1;
    compareEntry(expected, actual, `entries.${id}`, errors);
  }
  for (const [id, actual] of targetById) {
    if (!sourceById.has(id)) {
      addIssue(errors, "error", "entry.extra", `entries.${id}`, "Unexpected entry", undefined, actual);
    }
  }
  return compared;
}

function compareEntry(
  expected: SnapshotEntry,
  actual: SnapshotEntry,
  basePath: string,
  errors: AuditIssue[],
): void {
  compareFields(
    expected,
    actual,
    ["id", "title", "categoryId", "order", "content", "createdAt", "updatedAt"],
    basePath,
    "entry.field_mismatch",
    errors,
  );
  if (!arraysEqual(expected.aliases, actual.aliases)) {
    addIssue(
      errors,
      "error",
      "entry.alias_order_mismatch",
      `${basePath}.aliases`,
      "Entry aliases differ in value or order",
      expected.aliases,
      actual.aliases,
    );
  }
}

function compareReflections(
  source: readonly SnapshotReflection[],
  target: readonly SnapshotReflection[],
  errors: AuditIssue[],
): number {
  const sourceByDate = indexFirst(source, (reflection) => reflection.date);
  const targetByDate = indexFirst(target, (reflection) => reflection.date);
  let compared = 0;

  for (const [date, expected] of sourceByDate) {
    const actual = targetByDate.get(date);
    if (actual === undefined) {
      addIssue(errors, "error", "reflection.missing", `reflections.${date}`, "Reflection is missing", expected);
      continue;
    }
    compared += 1;
    compareFields(
      expected,
      actual,
      ["date", "content"],
      `reflections.${date}`,
      "reflection.field_mismatch",
      errors,
    );
  }
  for (const [date, actual] of targetByDate) {
    if (!sourceByDate.has(date)) {
      addIssue(errors, "error", "reflection.extra", `reflections.${date}`, "Unexpected reflection", undefined, actual);
    }
  }
  return compared;
}

function compareTrash(
  source: readonly SnapshotTrash[],
  target: readonly SnapshotTrash[],
  errors: AuditIssue[],
): number {
  const generatedNames = plannedTrashNames(source, errors);
  const usedTargetIndexes = new Set<number>();
  let compared = 0;

  for (const [sourceIndex, expected] of source.entries()) {
    const expectedName = expected.sourceName ?? generatedNames.get(sourceIndex) ?? null;
    const targetIndex = findTrashMatch(
      expected,
      expectedName,
      target,
      usedTargetIndexes,
    );
    const itemPath = `trash.${expectedName ?? sourceIndex}`;
    if (targetIndex === -1) {
      addIssue(
        errors,
        "error",
        "trash.missing",
        itemPath,
        "Trash occurrence is missing",
        expected,
      );
      continue;
    }

    usedTargetIndexes.add(targetIndex);
    compared += 1;
    const actual = target[targetIndex];
    if (expected.originalEntryId !== actual.originalEntryId) {
      addIssue(
        errors,
        "error",
        "trash.original_entry_mismatch",
        `${itemPath}.originalEntryId`,
        "Trash original entry relationship differs",
        expected.originalEntryId,
        actual.originalEntryId,
      );
    }
    compareEntry(expected.entry, actual.entry, `${itemPath}.entry`, errors);
    compareTrashProvenance(
      expected,
      actual,
      expectedName,
      itemPath,
      errors,
    );
  }

  for (const [targetIndex, actual] of target.entries()) {
    if (!usedTargetIndexes.has(targetIndex)) {
      addIssue(
        errors,
        "error",
        "trash.extra",
        `trash.${actual.sourceName ?? targetIndex}`,
        "Unexpected trash occurrence",
        undefined,
        actual,
      );
    }
  }
  return compared;
}

function compareTrashProvenance(
  expected: SnapshotTrash,
  actual: SnapshotTrash,
  expectedName: string | null,
  basePath: string,
  errors: AuditIssue[],
): void {
  if (
    expected.sourceName !== actual.sourceName &&
    !(expected.sourceName === null && actual.sourceName === expectedName)
  ) {
    addIssue(
      errors,
      "error",
      "trash.source_name_mismatch",
      `${basePath}.sourceName`,
      "Trash source filename provenance differs",
      expected.sourceName,
      actual.sourceName,
    );
  }

  if (expected.deletedAt === actual.deletedAt) {
    return;
  }
  addIssue(
    errors,
    "error",
    "trash.deleted_at_mismatch",
    `${basePath}.deletedAt`,
    "Trash deletion timestamp provenance differs",
    expected.deletedAt,
    actual.deletedAt,
  );
}

function findTrashMatch(
  expected: SnapshotTrash,
  expectedName: string | null,
  target: readonly SnapshotTrash[],
  usedIndexes: ReadonlySet<number>,
): number {
  if (expected.sourceName !== null) {
    return target.findIndex(
      (candidate, index) =>
        !usedIndexes.has(index) && candidate.sourceName === expected.sourceName,
    );
  }

  const unchangedIndex = target.findIndex(
    (candidate, index) =>
      !usedIndexes.has(index) &&
      candidate.sourceName === null &&
      candidate.originalEntryId === expected.originalEntryId &&
      candidate.deletedAt === expected.deletedAt,
  );
  if (unchangedIndex !== -1) {
    return unchangedIndex;
  }
  const exportedIndex = target.findIndex(
    (candidate, index) =>
      !usedIndexes.has(index) && candidate.sourceName === expectedName,
  );
  if (exportedIndex !== -1) {
    return exportedIndex;
  }
  return target.findIndex(
    (candidate, index) =>
      !usedIndexes.has(index) &&
      candidate.sourceName === null &&
      candidate.originalEntryId === expected.originalEntryId,
  );
}

function plannedTrashNames(
  source: readonly SnapshotTrash[],
  errors: AuditIssue[],
): Map<number, string> {
  try {
    return new Map(
      planTrashMarkdownFiles(source).map((file) => [file.sourceIndex, file.fileName]),
    );
  } catch (error) {
    addIssue(
      errors,
      "error",
      "trash.filename_plan_failed",
      "source.trash",
      error instanceof Error ? error.message : "Trash filenames could not be planned",
    );
    return new Map();
  }
}

function validateSnapshot(
  snapshot: VaultSnapshot,
  side: "source" | "target",
  errors: AuditIssue[],
): void {
  const categoryIds = collectUnique(
    snapshot.categories,
    (category) => category.id,
    side,
    "category",
    errors,
  );
  collectUnique(
    snapshot.entries,
    (entry) => entry.id,
    side,
    "entry",
    errors,
  );
  collectUnique(
    snapshot.reflections,
    (reflection) => reflection.date,
    side,
    "reflection",
    errors,
  );
  collectUnique(
    snapshot.trash.filter((trash) => trash.sourceName !== null),
    (trash) => trash.sourceName as string,
    side,
    "trash_source_name",
    errors,
  );

  if (!categoryIds.has(snapshot.config.defaultCategoryId)) {
    addIssue(
      errors,
      "error",
      "relationship.default_category_missing",
      `${side}.config.defaultCategoryId`,
      "Default category does not reference an existing category",
      undefined,
      snapshot.config.defaultCategoryId,
    );
  }
  for (const entry of snapshot.entries) {
    if (!categoryIds.has(entry.categoryId)) {
      addIssue(
        errors,
        "error",
        "relationship.entry_category_missing",
        `${side}.entries.${entry.id}.categoryId`,
        "Entry does not reference an existing category",
        undefined,
        entry.categoryId,
      );
    }
  }
  for (const [index, trash] of snapshot.trash.entries()) {
    if (trash.originalEntryId !== trash.entry.id) {
      addIssue(
        errors,
        "error",
        "relationship.trash_entry_id_mismatch",
        `${side}.trash.${trash.sourceName ?? index}.originalEntryId`,
        "Trash originalEntryId does not match its entry snapshot id",
        trash.entry.id,
        trash.originalEntryId,
      );
    }
  }
}

function collectUnique<Item>(
  items: readonly Item[],
  keyFor: (item: Item) => string,
  side: "source" | "target",
  entity: string,
  errors: AuditIssue[],
): Set<string> {
  const keys = new Set<string>();
  for (const item of items) {
    const key = keyFor(item);
    if (keys.has(key)) {
      addIssue(
        errors,
        "error",
        `${entity}.duplicate`,
        `${side}.${entity}.${key}`,
        `Duplicate ${entity.replaceAll("_", " ")} identity`,
        undefined,
        key,
      );
    }
    keys.add(key);
  }
  return keys;
}

function compareFields(
  expected: object,
  actual: object,
  fields: readonly string[],
  basePath: string,
  code: string,
  errors: AuditIssue[],
): void {
  const expectedRecord = expected as Record<string, unknown>;
  const actualRecord = actual as Record<string, unknown>;
  for (const field of fields) {
    if (!Object.is(expectedRecord[field], actualRecord[field])) {
      addIssue(
        errors,
        "error",
        code,
        `${basePath}.${field}`,
        `${field} differs`,
        expectedRecord[field],
        actualRecord[field],
      );
    }
  }
}

function indexFirst<Item>(
  items: readonly Item[],
  keyFor: (item: Item) => string,
): Map<string, Item> {
  const indexed = new Map<string, Item>();
  for (const item of items) {
    const key = keyFor(item);
    if (!indexed.has(key)) {
      indexed.set(key, item);
    }
  }
  return indexed;
}

function arraysEqual(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function entityCounts(snapshot: VaultSnapshot): AuditEntityCounts {
  return {
    config: 1,
    categories: snapshot.categories.length,
    entries: snapshot.entries.length,
    reflections: snapshot.reflections.length,
    trash: snapshot.trash.length,
  };
}

function addIssue(
  destination: AuditIssue[],
  severity: AuditSeverity,
  code: string,
  path: string,
  message: string,
  expected?: unknown,
  actual?: unknown,
): void {
  destination.push({ severity, code, path, message, expected, actual });
}

function compareIssues(left: AuditIssue, right: AuditIssue): number {
  return (
    compareText(left.path, right.path) ||
    compareText(left.code, right.code) ||
    compareText(left.message, right.message)
  );
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
