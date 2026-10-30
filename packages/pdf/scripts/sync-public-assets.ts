import { copyFile, cp, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const target = process.argv[2];
if (!target?.trim()) throw new Error("Usage: assets:sync <app-public-directory>");
const destination = path.resolve(target, "_pdf");
const source = path.dirname(fileURLToPath(import.meta.resolve("pdfjs-dist/package.json")));
const { version } = JSON.parse(await readFile(path.join(source, "package.json"), "utf8")) as { version: string };
await mkdir(destination, { recursive: true });
await copyFile(path.join(source, "build", "pdf.worker.min.mjs"), path.join(destination, "pdf.worker.min.mjs"));
await copyFile(path.join(source, "LICENSE"), path.join(destination, "LICENSE-pdfjs.txt"));
for (const directory of ["cmaps", "standard_fonts", "wasm"]) {
  await cp(path.join(source, directory), path.join(destination, directory), { recursive: true });
}
await writeFile(path.join(destination, "manifest.json"), `${JSON.stringify({ engine: "pdfjs-dist", version, license: "Apache-2.0" })}\n`);
await cp(path.join(source, "web", "images"), path.join(destination, "images"), { recursive: true });
console.log(`PDF runtime assets copied to ${destination}`);
