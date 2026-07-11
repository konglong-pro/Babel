import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

import { openDatabase } from "../src/lib/db/client";
import {
  assertVaultSnapshotsEqual,
  type VaultAuditReport,
} from "../src/lib/exchange/audit";
import {
  readDatabaseSnapshot,
  restoreSnapshot,
} from "../src/lib/exchange/database";
import { readLegacyVault } from "../src/lib/exchange/legacy-reader";
import type { VaultSnapshot } from "../src/lib/exchange/types";
import {
  assertExportDestinationReady,
  DEFAULT_EXPORT_PATH,
  writeSnapshotExport,
} from "./export-vault";
import { DEFAULT_DATABASE_PATH } from "./migrate";

export const DEFAULT_SOURCE_PATH = "sample-vault";
export const DEFAULT_REPORT_PATH = path.join("output", "migration-report.json");

export interface ImportOptions {
  source?: string;
  target?: string;
  dryRun?: boolean;
  export?: string;
  report?: string;
}

interface ImportPaths {
  source: string;
  target: string;
  export: string;
  report: string;
}

export interface DryRunReport {
  reportVersion: 1;
  status: "validated";
  dryRun: true;
  generatedAt: string;
  paths: ImportPaths;
  validation: VaultAuditReport;
}

export interface MigrationReport {
  reportVersion: 1;
  status: "completed";
  dryRun: false;
  generatedAt: string;
  paths: ImportPaths;
  audits: {
    sourceToDatabase: VaultAuditReport;
    sourceToExport: VaultAuditReport;
  };
}

export type ImportResult = DryRunReport | MigrationReport;

export async function importLegacyVault(
  options: ImportOptions = {},
): Promise<ImportResult> {
  const paths = resolveImportPaths(options);
  const sourceSnapshot = await readLegacyVault(paths.source);

  if (options.dryRun === true) {
    return {
      reportVersion: 1,
      status: "validated",
      dryRun: true,
      generatedAt: new Date().toISOString(),
      paths,
      validation: assertVaultSnapshotsEqual(sourceSnapshot, sourceSnapshot),
    };
  }

  assertWritePathsDoNotTouchSource(paths);
  assertDistinctWritePaths(paths);
  await assertExportDestinationReady(paths.export);

  const database = openDatabase(paths.target);
  let databaseSnapshot: VaultSnapshot;
  let sourceToDatabase: VaultAuditReport;
  try {
    restoreSnapshot(database, sourceSnapshot);
    databaseSnapshot = readDatabaseSnapshot(database);
    sourceToDatabase = assertVaultSnapshotsEqual(
      sourceSnapshot,
      databaseSnapshot,
    );
  } finally {
    database.close();
  }

  await writeSnapshotExport(databaseSnapshot, paths.export);
  const exportedSnapshot = await readLegacyVault(paths.export);
  const sourceToExport = assertVaultSnapshotsEqual(
    sourceSnapshot,
    exportedSnapshot,
  );
  const report: MigrationReport = {
    reportVersion: 1,
    status: "completed",
    dryRun: false,
    generatedAt: new Date().toISOString(),
    paths,
    audits: { sourceToDatabase, sourceToExport },
  };
  await writeMigrationReport(report, paths.report);
  return report;
}

export function parseImportArguments(args: readonly string[]): Required<ImportOptions> {
  const { positionals, values } = parseArgs({
    args: [...args],
    allowPositionals: true,
    strict: true,
    options: {
      source: { type: "string" },
      target: { type: "string" },
      "dry-run": { type: "boolean", default: false },
      export: { type: "string" },
      report: { type: "string" },
    },
  });
  let positionalIndex = 0;
  const source = values.source ?? positionals[positionalIndex++] ?? DEFAULT_SOURCE_PATH;
  const target = values.target ?? positionals[positionalIndex++] ?? DEFAULT_DATABASE_PATH;
  if (positionalIndex < positionals.length) {
    throw new Error(
      "Usage: import-legacy-vault.ts [source] [target] [--dry-run] [--export <path>] [--report <path>]",
    );
  }
  return {
    source,
    target,
    dryRun: values["dry-run"],
    export: values.export ?? DEFAULT_EXPORT_PATH,
    report: values.report ?? DEFAULT_REPORT_PATH,
  };
}

export async function main(
  args: readonly string[] = process.argv.slice(2),
): Promise<ImportResult> {
  const result = await importLegacyVault(parseImportArguments(args));
  console.log(JSON.stringify(result, null, 2));
  return result;
}

async function writeMigrationReport(
  report: MigrationReport,
  filename: string,
): Promise<void> {
  await mkdir(path.dirname(filename), { recursive: true });
  await writeFile(filename, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

function resolveImportPaths(options: ImportOptions): ImportPaths {
  const target = options.target ?? DEFAULT_DATABASE_PATH;
  return {
    source: path.resolve(options.source ?? DEFAULT_SOURCE_PATH),
    target: target === ":memory:" ? target : path.resolve(target),
    export: path.resolve(options.export ?? DEFAULT_EXPORT_PATH),
    report: path.resolve(options.report ?? DEFAULT_REPORT_PATH),
  };
}

function assertWritePathsDoNotTouchSource(paths: ImportPaths): void {
  for (const [label, candidate] of [
    ["Target database", paths.target],
    ["Export destination", paths.export],
    ["Report", paths.report],
  ] as const) {
    if (candidate !== ":memory:" && isWithin(candidate, paths.source)) {
      throw new Error(`${label} cannot be inside the source vault: ${candidate}`);
    }
  }
}

function assertDistinctWritePaths(paths: ImportPaths): void {
  if (paths.target !== ":memory:" && samePath(paths.target, paths.report)) {
    throw new Error("Migration report cannot overwrite the target database");
  }
  if (isWithin(paths.report, paths.export)) {
    throw new Error("Migration report cannot be inside the export vault");
  }
  if (paths.target !== ":memory:" && samePath(paths.target, paths.export)) {
    throw new Error("Export destination cannot be the target database");
  }
}

function isWithin(candidate: string, parent: string): boolean {
  const relative = path.relative(parent, candidate);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))
  );
}

function samePath(left: string, right: string): boolean {
  return process.platform === "win32"
    ? left.toLowerCase() === right.toLowerCase()
    : left === right;
}

function isMainModule(): boolean {
  const invokedPath = process.argv[1];
  return (
    invokedPath !== undefined &&
    pathToFileURL(path.resolve(invokedPath)).href === import.meta.url
  );
}

if (isMainModule()) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
