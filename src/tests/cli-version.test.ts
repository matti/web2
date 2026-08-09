import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";

// Resolve the cheapest way to run the CLI. Compiling src/cli.ts and its whole
// command tree through tsx costs ~1.7s and made this the slowest test in the
// suite; the compiled bundle starts in a tenth of that. Fall back to tsx when
// dist/ is missing or stale so the test never asserts against old output.
function cliCommand(): [string, string] {
  const dist = "dist/src/cli.js";
  const src = "src/cli.ts";
  if (existsSync(dist) && statSync(dist).mtimeMs >= statSync(src).mtimeMs) {
    return [process.execPath, dist];
  }
  return ["node_modules/.bin/tsx", src];
}

describe("cli --version", () => {
  it("outputs the version from package.json", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf-8")) as { version: string };
    const [command, entry] = cliCommand();
    const output = execFileSync(command, [entry, "--version"], {
      encoding: "utf-8",
      timeout: 2000,
    }).trim();
    assert.equal(output, pkg.version);
  });
});
