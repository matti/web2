import { writeFileSync } from "node:fs";
import { withPage } from "../lib/browser.js";
import { STATE_DIR } from "../lib/state.js";

const NETWORK_LOG = `${STATE_DIR}/web-network.json`;

interface NetworkEntry {
  url: string;
  method: string;
  status: number;
  type: string;
  size: number;
}

interface Redirect {
  status: number;
  from: string;
  to: string;
  ms: number;
}

export async function navigate(url: string, opts: { wait?: string }): Promise<void> {
  // Auto-prepend http:// for bare domains like "example.com"
  if (!/^https?:\/\//i.test(url)) {
    url = `http://${url}`;
  }

  await withPage(async (page) => {
    const waitMap: Record<string, "commit" | "domcontentloaded" | "networkidle"> = {
      commit: "commit",
      load: "domcontentloaded",
      idle: "networkidle",
    };
    const waitUntil = waitMap[opts.wait ?? "load"] ?? "domcontentloaded";

    // Capture network requests during navigation
    const entries: NetworkEntry[] = [];
    const redirects: Redirect[] = [];
    let finalStatus = 0;
    let lastResponseTime = 0;
    let start = 0;

    page.on("response", async (response) => {
      try {
        const request = response.request();
        const status = response.status();
        const cl = response.headers()["content-length"];
        entries.push({
          url: request.url(),
          method: request.method(),
          status,
          type: request.resourceType(),
          size: cl ? parseInt(cl, 10) : 0,
        });

        // Track redirects on the document request chain
        if (request.resourceType() === "document") {
          const now = performance.now();
          const elapsed = Math.round(now - (lastResponseTime || start));
          if (status >= 300 && status < 400) {
            const location = response.headers()["location"];
            if (location) {
              redirects.push({ status, from: request.url(), to: location, ms: elapsed });
            }
          } else {
            finalStatus = status;
          }
          lastResponseTime = now;
        }
      } catch {
        // ignore
      }
    });

    start = performance.now();

    await page.goto(url, { waitUntil: "commit", timeout: 15000 });
    if (waitUntil === "commit") {
      // Done — user asked for fastest possible
    } else if (waitUntil === "domcontentloaded") {
      await page.waitForLoadState("domcontentloaded", { timeout: 10000 }).catch(() => {});
    } else {
      // "networkidle" — best-effort, never crash
      await page.waitForLoadState("domcontentloaded", { timeout: 10000 }).catch(() => {});
      await page.waitForLoadState("networkidle", { timeout: 3000 }).catch(() => {});
    }

    const elapsed = Math.round(performance.now() - start);

    // Write captured requests to log file
    try {
      writeFileSync(NETWORK_LOG, JSON.stringify(entries, null, 2));
    } catch {}

    // Report redirects
    for (const r of redirects) {
      console.log(`${r.status} ${r.from} -> ${r.to} (${r.ms}ms)`);
    }

    // Report final status, URL, and load time
    console.log(`${finalStatus || "???"} ${page.url()} (${elapsed}ms)`);
  });
}
