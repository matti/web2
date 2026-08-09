import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";

const repoDir = join(import.meta.dirname, "..");
const cliJs = join(repoDir, "dist/src/cli.js");

const env = {
  ...process.env,
  CDP_PORT: process.env.CDP_PORT || "9222",
};

export const serverUrl = process.env.MOCK_URL!;
export const tmpDir =
  process.env.E2E_TMPDIR || mkdtempSync(join(tmpdir(), "e2e-"));

export interface CliResult {
  stdout: string;
  stderr: string;
  status: number;
}

export function cli(...args: string[]): CliResult {
  return cliWithEnv({}, ...args);
}

export function cliWithEnv(
  envOverrides: Record<string, string>,
  ...args: string[]
): CliResult {
  const r = spawnSync("node", [cliJs, ...args], {
    env: { ...env, ...envOverrides },
    encoding: "utf-8",
    timeout: 10_000,
  });
  return {
    stdout: (r.stdout || "").trim(),
    stderr: (r.stderr || "").trim(),
    status: r.status ?? 1,
  };
}

export function go(path: string): CliResult {
  return cli("go", `${serverUrl}${path}`, "--wait", "commit");
}
