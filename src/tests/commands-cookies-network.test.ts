import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, unlinkSync, existsSync } from "node:fs";

// Route state files to /tmp on the host (production uses /state inside the
// container). Must be set before any dynamic import of network.ts.
process.env.WEB_STATE_DIR = "/tmp";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const NETWORK_LOG = "/tmp/web-network.json";

/** Write test data to the network log, return cleanup fn */
function writeNetworkLog(entries: object[]): () => void {
  writeFileSync(NETWORK_LOG, JSON.stringify(entries));
  return () => {
    try { unlinkSync(NETWORK_LOG); } catch { /* ignore */ }
  };
}

/** Capture console.log lines during fn() */
async function captureStdout(fn: () => Promise<void>): Promise<string[]> {
  const lines: string[] = [];
  const orig = console.log;
  console.log = (...args: unknown[]) => lines.push(args.map(String).join(" "));
  try {
    await fn();
  } finally {
    console.log = orig;
  }
  return lines;
}

/** Capture process.stderr.write output during fn() */
async function captureStderr(fn: () => Promise<void>): Promise<string> {
  const chunks: string[] = [];
  const orig = process.stderr.write.bind(process.stderr);
  (process.stderr as any).write = (chunk: string | Buffer) => {
    chunks.push(typeof chunk === "string" ? chunk : chunk.toString());
    return true;
  };
  try {
    await fn();
  } finally {
    (process.stderr as any).write = orig;
  }
  return chunks.join("");
}

// ---------------------------------------------------------------------------
// network command tests
// network() reads $WEB_STATE_DIR/web-network.json (set to /tmp above).
// ---------------------------------------------------------------------------

describe("network command", () => {
  let cleanup: (() => void) | undefined;

  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
  });

  it("prints no-requests message when log file missing", async () => {
    // Ensure no log file exists
    try { unlinkSync(NETWORK_LOG); } catch { /* ignore */ }

    const { network } = await import("../commands/network.js");
    const lines = await captureStdout(() => network({}));
    assert.ok(
      lines.some((l) => l.includes("No network requests captured")),
      `Expected no-requests message, got: ${lines.join("\n")}`,
    );
  });

  it("prints no-requests message for empty entries array", async () => {
    cleanup = writeNetworkLog([]);
    const { network } = await import("../commands/network.js");
    const lines = await captureStdout(() => network({}));
    assert.ok(
      lines.some((l) => l.includes("No network requests captured")),
      `Expected no-requests message, got: ${lines.join("\n")}`,
    );
  });

  it("prints header row and count for captured requests", async () => {
    const entries = [
      { url: "https://example.com/", method: "GET", status: 200, type: "document", size: 1234 },
      { url: "https://example.com/style.css", method: "GET", status: 200, type: "stylesheet", size: 567 },
    ];
    cleanup = writeNetworkLog(entries);
    const { network } = await import("../commands/network.js");
    const lines = await captureStdout(() => network({}));
    const joined = lines.join("\n");

    assert.ok(lines.some((l) => l.includes("2 requests captured")), `Expected count line, got: ${joined}`);
    assert.ok(lines.some((l) => l.includes("STATUS")), `Expected header, got: ${joined}`);
    assert.ok(lines.some((l) => l.includes("https://example.com/")), `Expected URL, got: ${joined}`);
  });

  it("table output includes all fields per entry", async () => {
    const entries = [
      { url: "https://api.example.com/data", method: "POST", status: 201, type: "xhr", size: 42 },
    ];
    cleanup = writeNetworkLog(entries);
    const { network } = await import("../commands/network.js");
    const lines = await captureStdout(() => network({}));
    const dataRow = lines.find((l) => l.includes("https://api.example.com/data"));
    assert.ok(dataRow, `Expected data row, got: ${lines.join("\n")}`);
    assert.ok(dataRow!.includes("POST"), "Expected method POST");
    assert.ok(dataRow!.includes("201"), "Expected status 201");
    assert.ok(dataRow!.includes("xhr"), "Expected type xhr");
    assert.ok(dataRow!.includes("42"), "Expected size 42");
  });

  it("prints JSON output with --json flag", async () => {
    const entries = [
      { url: "https://example.com/", method: "GET", status: 200, type: "document", size: 100 },
    ];
    cleanup = writeNetworkLog(entries);
    const { network } = await import("../commands/network.js");
    const lines = await captureStdout(() => network({ json: true }));
    const parsed = JSON.parse(lines.join("\n"));
    assert.ok(Array.isArray(parsed));
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0].url, "https://example.com/");
    assert.equal(parsed[0].method, "GET");
    assert.equal(parsed[0].status, 200);
  });

  it("JSON output includes all entry fields", async () => {
    const entries = [
      { url: "https://example.com/api", method: "POST", status: 201, type: "xhr", size: 55 },
    ];
    cleanup = writeNetworkLog(entries);
    const { network } = await import("../commands/network.js");
    const lines = await captureStdout(() => network({ json: true }));
    const parsed = JSON.parse(lines.join("\n"));
    assert.equal(parsed[0].type, "xhr");
    assert.equal(parsed[0].size, 55);
  });

  it("handles multiple entries in JSON output", async () => {
    const entries = [
      { url: "https://a.com/", method: "GET", status: 200, type: "document", size: 1 },
      { url: "https://b.com/", method: "GET", status: 404, type: "document", size: 2 },
      { url: "https://c.com/", method: "POST", status: 500, type: "xhr", size: 3 },
    ];
    cleanup = writeNetworkLog(entries);
    const { network } = await import("../commands/network.js");
    const lines = await captureStdout(() => network({ json: true }));
    const parsed = JSON.parse(lines.join("\n"));
    assert.equal(parsed.length, 3);
  });
});

// ---------------------------------------------------------------------------
// cookies formatting logic tests
// Tests pure data-transformation logic from cookies.ts without browser.
// ---------------------------------------------------------------------------

describe("cookies formatting logic", () => {
  // Mirror of cookies.ts pad() (not exported — tested here as pure logic)
  function pad(s: string, len: number): string {
    return s.length >= len ? s : s + " ".repeat(len - s.length);
  }

  // Mirror of cookies.ts expires formatting logic
  function formatExpires(expires: number): string {
    return expires === -1 || expires === 0
      ? "Session"
      : new Date(expires * 1000).toISOString().slice(0, 19);
  }

  // Mirror of cookies.ts row-building logic
  interface CDPCookie {
    name: string; value: string; domain: string; path: string;
    expires: number; size: number; httpOnly: boolean; secure: boolean; session: boolean;
  }
  function cookieToRow(c: CDPCookie): string[] {
    return [
      c.name,
      c.domain,
      c.path,
      formatExpires(c.expires),
      c.secure ? "Yes" : "No",
      c.httpOnly ? "Yes" : "No",
    ];
  }

  // Mirror of cookies.ts column-width calculation
  const HEADERS = ["NAME", "DOMAIN", "PATH", "EXPIRES", "SECURE", "HTTPONLY"];
  function buildWidths(rows: string[][]): number[] {
    return HEADERS.map((h, i) =>
      Math.max(h.length, ...rows.map((r) => r[i].length)),
    );
  }

  describe("pad()", () => {
    it("pads short string to target length", () => {
      assert.equal(pad("hi", 5), "hi   ");
    });

    it("returns string unchanged when already at target length", () => {
      assert.equal(pad("hello", 5), "hello");
    });

    it("returns string unchanged when longer than target", () => {
      assert.equal(pad("toolong", 3), "toolong");
    });

    it("pads empty string", () => {
      assert.equal(pad("", 4), "    ");
    });

    it("pads single char", () => {
      assert.equal(pad("x", 3), "x  ");
    });
  });

  describe("formatExpires()", () => {
    it("returns 'Session' for expires=-1 (session cookie)", () => {
      assert.equal(formatExpires(-1), "Session");
    });

    it("returns 'Session' for expires=0", () => {
      assert.equal(formatExpires(0), "Session");
    });

    it("returns ISO timestamp for a known unix epoch", () => {
      // Unix epoch 1000000000 → 2001-09-09T01:46:40
      const result = formatExpires(1000000000);
      assert.equal(result, "2001-09-09T01:46:40");
    });

    it("returns exactly 19 characters (no milliseconds or Z suffix)", () => {
      const result = formatExpires(1700000000);
      assert.equal(result.length, 19);
      assert.ok(!result.includes("."), "should not include milliseconds");
      assert.ok(!result.endsWith("Z"), "should not end with Z (sliced off)");
    });

    it("positive non-zero expires is treated as persistent cookie", () => {
      const result = formatExpires(1);
      assert.notEqual(result, "Session");
      assert.equal(result.length, 19);
    });
  });

  describe("cookieToRow()", () => {
    const base: CDPCookie = {
      name: "sess", value: "abc", domain: ".example.com", path: "/",
      expires: -1, size: 10, httpOnly: false, secure: false, session: true,
    };

    it("produces 6 columns", () => {
      assert.equal(cookieToRow(base).length, 6);
    });

    it("puts name in column 0", () => {
      assert.equal(cookieToRow({ ...base, name: "my_cookie" })[0], "my_cookie");
    });

    it("puts domain in column 1", () => {
      assert.equal(cookieToRow({ ...base, domain: ".test.com" })[1], ".test.com");
    });

    it("puts path in column 2", () => {
      assert.equal(cookieToRow({ ...base, path: "/api" })[2], "/api");
    });

    it("puts formatted expires in column 3", () => {
      assert.equal(cookieToRow({ ...base, expires: -1 })[3], "Session");
      assert.equal(cookieToRow({ ...base, expires: 1000000000 })[3], "2001-09-09T01:46:40");
    });

    it("maps secure=true to 'Yes' in column 4", () => {
      assert.equal(cookieToRow({ ...base, secure: true })[4], "Yes");
    });

    it("maps secure=false to 'No' in column 4", () => {
      assert.equal(cookieToRow({ ...base, secure: false })[4], "No");
    });

    it("maps httpOnly=true to 'Yes' in column 5", () => {
      assert.equal(cookieToRow({ ...base, httpOnly: true })[5], "Yes");
    });

    it("maps httpOnly=false to 'No' in column 5", () => {
      assert.equal(cookieToRow({ ...base, httpOnly: false })[5], "No");
    });
  });

  describe("column width calculation", () => {
    it("uses header length when all data is shorter", () => {
      const rows = [["id", ".ex.com", "/", "Session", "No", "No"]];
      const widths = buildWidths(rows);
      assert.equal(widths[0], 4);  // "NAME".length
      assert.equal(widths[4], 6);  // "SECURE".length
      assert.equal(widths[5], 8);  // "HTTPONLY".length
    });

    it("expands column when data is longer than header", () => {
      const longName = "a-very-long-cookie-name";
      const rows = [[longName, ".example.com", "/", "Session", "Yes", "Yes"]];
      const widths = buildWidths(rows);
      assert.equal(widths[0], longName.length);
    });

    it("takes max across multiple rows", () => {
      const rows = [
        ["short", ".example.com", "/", "Session", "No", "No"],
        ["much-longer-name", ".example.com", "/", "Session", "No", "No"],
      ];
      const widths = buildWidths(rows);
      assert.equal(widths[0], "much-longer-name".length);
    });

    it("minimum width for PATH column is header length", () => {
      const rows = [["x", ".ex.com", "/", "Session", "No", "No"]];
      const widths = buildWidths(rows);
      assert.equal(widths[2], "PATH".length);  // 4
    });

    it("widths list has 6 entries (one per column)", () => {
      const rows = [["x", ".ex.com", "/api", "Session", "Yes", "No"]];
      assert.equal(buildWidths(rows).length, 6);
    });
  });

  describe("table row rendering", () => {
    it("separator row uses dashes equal to column width", () => {
      const widths = [4, 6, 4, 7, 6, 8];
      const sep = widths.map((w) => "-".repeat(w)).join("  ");
      assert.equal(sep, "----  ------  ----  -------  ------  --------");
    });

    it("header row pads each column correctly", () => {
      const widths = [6, 6, 4, 7, 6, 8];
      const headerRow = HEADERS.map((h, i) => pad(h, widths[i])).join("  ");
      assert.ok(headerRow.startsWith("NAME  "), `got: ${headerRow}`);
    });

    it("data row aligns columns with padding", () => {
      const row = ["test_cookie", ".example.com", "/path", "Session", "Yes", "No"];
      const widths = buildWidths([row]);
      const rendered = row.map((c, i) => pad(c, widths[i])).join("  ");
      // All fields should appear in the rendered row
      assert.ok(rendered.includes("test_cookie"));
      assert.ok(rendered.includes(".example.com"));
      assert.ok(rendered.includes("Session"));
    });
  });
});
