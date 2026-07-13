import { readFileSync } from "node:fs";
import { chromium, type Browser, type Page } from "playwright";
import { dbg } from "./debug.js";
import { STATE_DIR } from "./state.js";

const CDP_PORT = process.env.CDP_PORT || "19222";
const CDP_URL = `http://127.0.0.1:${CDP_PORT}`;

// Stealth patches that run before every new document on a page target.
// Paired with the Chromium flag --disable-blink-features=AutomationControlled
// in docker/entrypoint.sh. Together these hide the most common fingerprint
// signals (navigator.webdriver, empty plugins, missing chrome object) that
// anti-bot systems (Alibaba Baxia, Cloudflare Turnstile, Datadome) use to
// flag Playwright/Puppeteer as automated.
//
// Keep this list short and self-patching (defineProperty, check-before-set) —
// it runs on every document load and must not throw.
const STEALTH_INIT_SCRIPT = `
(() => {
  if (window.__webStealthApplied) return;
  window.__webStealthApplied = true;
  try {
    // navigator.webdriver — Playwright sets this to true; hide it.
    Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => undefined });
  } catch {}
  try {
    // navigator.plugins — headful Chromium has plugins; Playwright's empty list is a tell.
    if (!navigator.plugins || navigator.plugins.length === 0) {
      Object.defineProperty(Navigator.prototype, 'plugins', {
        get: () => {
          const arr = [{ name: 'Chrome PDF Plugin' }, { name: 'Chrome PDF Viewer' }, { name: 'Native Client' }];
          arr.__proto__ = PluginArray.prototype;
          return arr;
        }
      });
    }
  } catch {}
  try {
    // navigator.languages — must be non-empty array.
    if (!navigator.languages || navigator.languages.length === 0) {
      Object.defineProperty(Navigator.prototype, 'languages', { get: () => ['en-US', 'en'] });
    }
  } catch {}
  try {
    // window.chrome — real Chrome exposes this; Playwright leaves it undefined unless headful.
    if (!window.chrome) {
      Object.defineProperty(window, 'chrome', { value: { runtime: {} }, writable: false });
    }
  } catch {}
  try {
    // Permissions.query for 'notifications' should return 'prompt' (real Chrome) not 'denied' (headless).
    const origQuery = navigator.permissions && navigator.permissions.query;
    if (origQuery) {
      navigator.permissions.query = function (p) {
        if (p && p.name === 'notifications') {
          return Promise.resolve({ state: Notification.permission, onchange: null });
        }
        return origQuery.call(this, p);
      };
    }
  } catch {}
})();
`;

/**
 * Apply stealth evasions to a page target via CDP. Idempotent per target —
 * uses Page.addScriptToEvaluateOnNewDocument so the script runs before
 * every subsequent navigation, and marks the window on first run to
 * avoid double-application on reloads.
 *
 * Safe to call on every withPage() invocation: the script is cheap, runs
 * only on new documents, and self-guards via window.__webStealthApplied.
 */
async function applyStealth(page: Page): Promise<void> {
  try {
    const cdp = await page.context().newCDPSession(page);
    try {
      await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: STEALTH_INIT_SCRIPT });
    } finally {
      await cdp.detach().catch(() => {/* best-effort */});
    }
  } catch (err) {
    dbg(`stealth apply failed: ${err}`);
  }
}

/**
 * Connect to the local Chromium browser via CDP.
 * Inside the Docker container, Chromium is always on localhost:9222.
 */
export async function connectBrowser(): Promise<Browser> {
  dbg(`connecting to CDP at ${CDP_URL}`);
  const browser = await chromium.connectOverCDP(CDP_URL);
  dbg("connected");
  return browser;
}

export async function withBrowser<T>(
  fn: (browser: Browser) => Promise<T>,
): Promise<T> {
  const browser = await connectBrowser();
  try {
    return await fn(browser);
  } finally {
    // For connectOverCDP, close() just closes the WebSocket transport —
    // it does NOT kill Chromium (verified in Playwright source).
    await browser.close();
  }
}

export async function withPage<T>(
  fn: (page: Page) => Promise<T>,
): Promise<T> {
  const wrap = async (page: Page): Promise<T> => {
    await applyStealth(page);
    return await fn(page);
  };

  return withBrowser(async (browser) => {
    // Collect pages from ALL contexts: with extensions loaded (IDCAC),
    // contexts() ordering is not deterministic and contexts[0] may be an
    // extension context with zero pages — picking only contexts[0] made the
    // active page appear and disappear between commands.
    const pages = browser.contexts().flatMap((c) => c.pages());
    if (pages.length > 0) {
      if (pages.length === 1) return await wrap(pages[0]);

      // Tab selection priority:
      //   1. WEB_TAB_ID env var — explicit target ID. Lets parallel processes
      //      pick their own tab without racing on the shared .web-tab-state
      //      file. The caller obtains the ID from `tab create` (stdout).
      //   2. .web-tab-state "active" field (interactive flow).
      //   3. First page (fallback).
      let savedId = process.env.WEB_TAB_ID || "";
      if (!savedId) {
        try {
          const state = JSON.parse(readFileSync(`${STATE_DIR}/.web-tab-state`, "utf8"));
          savedId = state.active || "";
        } catch {}
      }

      if (savedId) {
        for (const p of pages) {
          try {
            const cdp = await p.context().newCDPSession(p);
            try {
              const info = await cdp.send("Target.getTargetInfo" as unknown as Parameters<typeof cdp.send>[0]);
              if ((info as unknown as Record<string, Record<string, string>>).targetInfo.targetId === savedId) return await wrap(p);
            } finally {
              await cdp.detach().catch(() => {/* best-effort detach */});
            }
          } catch { /* skip tabs that can't be inspected */ }
        }
        if (process.env.WEB_TAB_ID) {
          throw new Error(`WEB_TAB_ID="${process.env.WEB_TAB_ID}" not found among ${pages.length} open tabs`);
        }
      }

      // Fallback: first page
      return await wrap(pages[0]);
    }
    // Otherwise create a new page — and KEEP it open. Right after browser
    // startup the initial about:blank target may not be visible yet; if we
    // created a temporary page and closed it here, the first command's page
    // state would silently vanish before the next command.
    const page = await browser.newPage();
    return await wrap(page);
  });
}
