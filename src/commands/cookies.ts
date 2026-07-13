import { withPage } from "../lib/browser.js";

function pad(s: string, len: number): string {
  return s.length >= len ? s : s + " ".repeat(len - s.length);
}

interface CDPCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number;
  size: number;
  httpOnly: boolean;
  secure: boolean;
  session: boolean;
}

export async function cookiesList(opts: { json?: boolean }): Promise<void> {
  await withPage(async (page) => {
    const cdp = await page.context().newCDPSession(page);
    let all: CDPCookie[];
    try {
      // List cookies via CDP (context.cookies() is broken with connectOverCDP)
      const result = await cdp.send("Network.getAllCookies") as { cookies: CDPCookie[] };
      all = result.cookies;
    } finally {
      await cdp.detach().catch(() => {});
    }

    if (opts.json) {
      console.log(JSON.stringify(all, null, 2));
      return;
    }

    if (all.length === 0) {
      process.stderr.write("No cookies.\n");
      return;
    }

    // Table output
    const headers = ["NAME", "DOMAIN", "PATH", "EXPIRES", "SECURE", "HTTPONLY"];
    const rows = all.map((c) => [
      c.name,
      c.domain,
      c.path,
      c.expires === -1 || c.expires === 0 ? "Session" : new Date(c.expires * 1000).toISOString().slice(0, 19),
      c.secure ? "Yes" : "No",
      c.httpOnly ? "Yes" : "No",
    ]);

    const widths = headers.map((h, i) =>
      Math.max(h.length, ...rows.map((r) => r[i].length)),
    );

    console.log(headers.map((h, i) => pad(h, widths[i])).join("  "));
    console.log(widths.map((w) => "-".repeat(w)).join("  "));
    for (const row of rows) {
      console.log(row.map((c, i) => pad(c, widths[i])).join("  "));
    }
  });
}

export async function cookiesClear(): Promise<void> {
  await withPage(async (page) => {
    const cdp = await page.context().newCDPSession(page);
    try {
      await cdp.send("Network.clearBrowserCookies");
    } finally {
      await cdp.detach().catch(() => {});
    }
    process.stderr.write("Cookies cleared.\n");
  });
}
