import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const targetArgument = process.argv[2];
if (targetArgument === undefined || targetArgument.trim() === "") {
  throw new Error("Usage: npm run assets:sync -- <app-public-directory>");
}

const targetRoot = resolve(targetArgument, "_typst");
const targetFonts = resolve(targetRoot, "fonts");
await mkdir(targetFonts, { recursive: true });

const wasmFiles = [
  fileURLToPath(import.meta.resolve("@myriaddreamin/typst-ts-web-compiler/wasm")),
  fileURLToPath(import.meta.resolve("@myriaddreamin/typst-ts-renderer/wasm")),
] as const;
const typstPackageEntry = fileURLToPath(import.meta.resolve("@myriaddreamin/typst.ts"));
const typstLicense = resolve(typstPackageEntry, "..", "..", "..", "LICENSE");

const fontNames = [
  "NewCM10-Regular.otf",
  "NewCM10-Italic.otf",
  "NewCM10-Bold.otf",
  "NewCM10-BoldItalic.otf",
  "NewCMMath-Regular.otf",
  "NewCMMath-Book.otf",
  "NewCMMath-Bold.otf",
] as const;

const fontDistributionFiles = [
  "LICENSE-New-Computer-Modern.txt",
  "README.md",
] as const;

for (const source of wasmFiles) {
  await copyFile(source, resolve(targetRoot, basename(source)));
}
await copyFile(typstLicense, resolve(targetRoot, "LICENSE-typst.ts.txt"));

for (const name of fontNames) {
  const source = fileURLToPath(new URL(`../assets/fonts/${name}`, import.meta.url));
  await copyFile(source, resolve(targetFonts, name));
}

for (const name of fontDistributionFiles) {
  const source = fileURLToPath(new URL(`../assets/fonts/${name}`, import.meta.url));
  await copyFile(source, resolve(targetFonts, name));
}

await writeFile(
  resolve(targetRoot, "asset-manifest.json"),
  `${JSON.stringify({
    typstTs: "0.7.0",
    typstLanguage: "0.14.2",
    fontAssets: "typst/typst-assets@v0.13.1",
    wasm: wasmFiles.map((file) => basename(file)),
    runtimeLicense: "LICENSE-typst.ts.txt",
    fonts: fontNames,
    fontDistributionFiles,
  }, null, 2)}\n`,
  "utf8",
);

process.stdout.write(`Typst runtime assets copied to ${targetRoot}\n`);
