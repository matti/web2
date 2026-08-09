import { readFileSync, writeFileSync } from "node:fs";
import { withBrowser } from "../lib/browser.js";
import { STATE_DIR } from "../lib/state.js";
import type { Browser, BrowserContext, Page } from "playwright";

const STATE_FILE = `${STATE_DIR}/.web-tab-state`;

function getContext(browser: Browser) {
  const contexts = browser.contexts();
  // Prefer the context that owns pages - with extensions loaded, context
  // ordering is not deterministic and an extension context may come first.
  const ctx = contexts.find((c) => c.pages().length > 0) ?? contexts[0];
  if (!ctx) throw new Error("No browser context");
  return ctx;
}

/** Get stable target ID for a page via CDP */
async function targetId(page: Page): Promise<string> {
  const cdp = await page.context().newCDPSession(page);
  try {
    const { targetInfo } = await cdp.send("Target.getTargetInfo" as any);
    return (targetInfo as any).targetId;
  } finally {
    await cdp.detach().catch(() => {});
  }
}

interface TabState {
  order: string[];   // target IDs in user-facing order
  active: string;    // active target ID
}

function readState(): TabState {
  try {
    return JSON.parse(readFileSync(STATE_FILE, "utf8"));
  } catch {
    return { order: [], active: "" };
  }
}

function writeState(state: TabState): void {
  writeFileSync(STATE_FILE, JSON.stringify(state));
}

/** Build a map from target ID to page, and reconcile with saved order */
async function resolvePages(ctx: BrowserContext): Promise<{
  pages: Page[];
  ids: string[];
  activeIdx: number;
}> {
  const raw = ctx.pages();
  const idMap = new Map<string, Page>();
  for (const p of raw) {
    idMap.set(await targetId(p), p);
  }

  const state = readState();
  const liveIds = new Set(idMap.keys());

  // Start with saved order, keep only still-alive IDs
  const ordered: string[] = [];
  for (const id of state.order) {
    if (liveIds.has(id)) {
      ordered.push(id);
      liveIds.delete(id);
    }
  }
  // Append any new IDs not in saved order (e.g. tabs opened externally)
  for (const id of liveIds) {
    ordered.push(id);
  }

  const pages = ordered.map((id) => idMap.get(id)!);
  let activeIdx = ordered.indexOf(state.active);
  if (activeIdx < 0) activeIdx = 0;

  // Persist reconciled state
  writeState({ order: ordered, active: ordered[activeIdx] || "" });

  return { pages, ids: ordered, activeIdx };
}

export async function tabList(): Promise<void> {
  await withBrowser(async (browser) => {
    const ctx = getContext(browser);
    const { pages, activeIdx } = await resolvePages(ctx);

    for (let i = 0; i < pages.length; i++) {
      const marker = i === activeIdx ? "*" : " ";
      const title = await pages[i].title().catch(() => "");
      const url = pages[i].url();
      process.stdout.write(`${marker} [${i}] ${title || "(untitled)"} - ${url}\n`);
    }
  });
}

export async function tabCreate(url?: string): Promise<void> {
  await withBrowser(async (browser) => {
    const ctx = getContext(browser);
    const { ids } = await resolvePages(ctx);

    const page = await ctx.newPage();
    if (url) {
      await page.goto(url, { waitUntil: "domcontentloaded" });
    }
    // Do NOT bringToFront - that races on .web-tab-state with concurrent
    // callers. The new tab is addressable via its target ID (stdout) and
    // env var WEB_TAB_ID; caller decides whether to make it active.
    const id = await targetId(page);

    // Append new tab at end. Keep saved active unchanged so a parallel
    // run that just created a tab does not steal focus from another run
    // that is operating on its own tab via WEB_TAB_ID.
    const newOrder = [...ids, id];
    const state = readState();
    writeState({ order: newOrder, active: state.active || id });
    process.stderr.write(`Created tab [${newOrder.length - 1}] target=${id}\n`);
    // Machine-readable: stdout gets the target ID alone, suitable for
    //   ID=$(web --name X tab create)
    //   WEB_TAB_ID=$ID web --name X exec '...'
    process.stdout.write(`${id}\n`);
  });
}

export async function tabSelect(index: number): Promise<void> {
  await withBrowser(async (browser) => {
    const ctx = getContext(browser);
    const { pages, ids } = await resolvePages(ctx);
    if (index < 0 || index >= pages.length) {
      throw new Error(`Tab ${index} does not exist (${pages.length} tabs open)`);
    }
    await pages[index].bringToFront();
    writeState({ order: ids, active: ids[index] });
    const title = await pages[index].title().catch(() => "");
    process.stderr.write(`Switched to tab [${index}] ${title || pages[index].url()}\n`);
  });
}

export async function tabNext(): Promise<void> {
  await withBrowser(async (browser) => {
    const ctx = getContext(browser);
    const { pages, ids, activeIdx } = await resolvePages(ctx);
    if (pages.length === 0) throw new Error("No tabs open");
    const next = (activeIdx + 1) % pages.length;
    await pages[next].bringToFront();
    writeState({ order: ids, active: ids[next] });
    const title = await pages[next].title().catch(() => "");
    process.stderr.write(`Switched to tab [${next}] ${title || pages[next].url()}\n`);
  });
}

export async function tabPrevious(): Promise<void> {
  await withBrowser(async (browser) => {
    const ctx = getContext(browser);
    const { pages, ids, activeIdx } = await resolvePages(ctx);
    if (pages.length === 0) throw new Error("No tabs open");
    const prev = (activeIdx - 1 + pages.length) % pages.length;
    await pages[prev].bringToFront();
    writeState({ order: ids, active: ids[prev] });
    const title = await pages[prev].title().catch(() => "");
    process.stderr.write(`Switched to tab [${prev}] ${title || pages[prev].url()}\n`);
  });
}

export async function tabClose(index?: number): Promise<void> {
  await withBrowser(async (browser) => {
    const ctx = getContext(browser);
    const { pages, ids, activeIdx } = await resolvePages(ctx);
    const target = index ?? activeIdx;
    if (target < 0 || target >= pages.length) {
      throw new Error(`Tab ${target} does not exist (${pages.length} tabs open)`);
    }
    if (pages.length === 1) {
      throw new Error("Cannot close the last tab");
    }
    await pages[target].close();
    const remaining = ids.filter((_, i) => i !== target);
    const remainingPages = pages.filter((_, i) => i !== target);
    const newActive = Math.min(target, remaining.length - 1);
    await remainingPages[newActive].bringToFront();
    writeState({ order: remaining, active: remaining[newActive] });
    process.stderr.write(`Closed tab [${target}]\n`);
  });
}
