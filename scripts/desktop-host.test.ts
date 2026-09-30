import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import ts from "typescript";

const execFileAsync = promisify(execFile);
const root = path.resolve(import.meta.dirname, "..");
const sdkInstalled = existsSync(path.join(root, "launcher/.webview2/1.0.3537.50/lib_manual/netcoreapp3.0/Microsoft.Web.WebView2.Core.dll"));
const skipReason = process.platform !== "win32"
  ? "The native desktop host requires Windows."
  : !sdkInstalled ? "Run npm run launcher:setup to enable the real WebView2 smoke test." : false;

test("desktop host runs isolated fixture pages in actual WebView2 controls", { skip: skipReason, timeout: 60_000 }, async context => {
  // Run the actual detached-reader document preparation in the native fixture.
  // Extracting these private declarations avoids loading React or the full app.
  const readerSource = await readFile(path.join(root, "packages/markdown/src/react.tsx"), "utf8");
  const readerModule = ts.createSourceFile("reader.tsx", readerSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const prepareReader = readerModule.statements.find(statement => ts.isFunctionDeclaration(statement) && statement.name?.text === "prepareDetachedReaderDocument");
  const readerStyle = readerModule.statements.find(statement => ts.isVariableStatement(statement) && statement.declarationList.declarations.some(declaration => ts.isIdentifier(declaration.name) && declaration.name.text === "DETACHED_READER_STYLE"));
  assert.ok(prepareReader && readerStyle, "Detached reader fixture declarations must exist.");
  const readerFixtureScript = ts.transpileModule(`${readerStyle.getText(readerModule)}\n${prepareReader.getText(readerModule)}\nwindow.prepareFixtureReader = prepareDetachedReaderDocument;`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText.replace(/<\/script/gi, "<\\/script");
  const server = createServer((request, response) => {
    if (request.url === "/abort") {
      response.destroy();
      return;
    }
    if (request.url === "/redirect") {
      const address = server.address();
      assert.ok(address && typeof address === "object");
      response.writeHead(302, { location: `http://127.0.0.2:${address.port}/outside` });
      response.end();
      return;
    }
    response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    response.end(`<!doctype html><html><head><title>Babel desktop test fixture</title><script>
      window.earlyDesktop = window.__BABEL_DESKTOP__ === true;
      window.fixtureName = ${JSON.stringify(request.url)};
      window.fixtureState = 0;
      window.fixtureDirty = false;
      window.shortcutEvents = 0;
      window.addEventListener('babel:shortcuts-changed', () => window.shortcutEvents++);
      window.addEventListener('beforeunload', event => { if (window.fixtureDirty) event.preventDefault(); });
      if (window.fixtureName === '/hang') window.addEventListener('beforeunload', () => { while (true) {} });
      ${readerFixtureScript}
    </script></head><body>Isolated Babel desktop fixture</body></html>`);
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const { stdout, stderr } = await execFileAsync("pwsh.exe", [
      "-NoLogo", "-NoProfile", "-STA", "-ExecutionPolicy", "Bypass", "-File",
      path.join(root, "launcher/Test-BabelDesktop.ps1"), "-FixtureOrigin", `http://127.0.0.1:${address.port}`,
    ], { timeout: 58_000 });
    assert.equal(stderr, "");
    assert.equal((stdout.match(/^PASS /gm) ?? []).length, 10, stdout);
    context.diagnostic("Native accelerator settings verified; physical keyboard delivery was not tested. CDP key injection was not delivered by the fixture runtime.");
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
