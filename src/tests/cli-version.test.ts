import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

describe("cli --version", () => {
  it("outputs the version from package.json", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf-8")) as { version: string };
    const output = execFileSync("npx", ["tsx", "src/cli.ts", "--version"], {
      encoding: "utf-8",
      timeout: 2000,
    }).trim();
    assert.equal(output, pkg.version);
  });
});
