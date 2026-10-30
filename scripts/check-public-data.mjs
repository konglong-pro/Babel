import { spawnSync } from "node:child_process";

const mode = process.argv[2];
if (process.argv.length !== 3 || !["--staged", "--tracked"].includes(mode)) {
  console.error("Usage: node scripts/check-public-data.mjs --staged|--tracked");
  process.exit(1);
}

// NUL-separated names are never quoted by Git and can contain tabs or newlines.
const args = mode === "--staged"
  ? ["diff", "--cached", "--name-only", "--diff-filter=ACMRT", "-z"]
  : ["ls-files", "--cached", "-z"];
const result = spawnSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
if (result.error || result.status !== 0) {
  console.error("Unable to inspect Git paths for private data.");
  console.error(result.error?.message ?? result.stderr);
  process.exit(1);
}

const blocked = result.stdout.split("\0").filter((filePath) => {
  if (!filePath) return false;
  if (/(^|\/)data(?:\/|$)|\.(?:db|sqlite)(?:[-.]|$)|-(?:wal|shm|journal)$/i.test(filePath)) {
    return true;
  }
  if (!/(^|\/)uploads?\//i.test(filePath)) return false;

  // Next.js upload endpoints are source code; uploaded originals and other
  // attachments belong in private data regardless of their file extensions.
  return !/^(?:apps|templates)\/[^/]+\/src\/app\/api\/uploads\/(?:[^/]+\/)*route\.ts$/.test(filePath);
});

if (blocked.length > 0) {
  console.error("Refusing user data or SQLite files in the public Babel repository:");
  for (const filePath of blocked) console.error(JSON.stringify(filePath));
  console.error("User data must live only in the private babel-data repository.");
  process.exit(1);
}
