#!/usr/bin/env npx tsx
import { Command } from "commander";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { formatCliError } from "./lib/errors.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
// Works from both src/ (tsx) and dist/src/ (compiled)
const pkgPath = existsSync(resolve(__dirname, "../package.json"))
  ? resolve(__dirname, "../package.json")
  : resolve(__dirname, "../../package.json");
const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as { version: string };

const program = new Command()
  .name("web2")
  .description("CLI browser automation tool")
  .version(pkg.version)
  .configureHelp({
    formatHelp(cmd, helper) {
      const base = Command.prototype.createHelp().formatHelp(cmd, helper);
      return base;
    },
  });

// grounded() wraps page-mutating commands: after the action succeeds, print
// the grounding line (→ url - "title") so the caller always knows where the
// browser ended up without an extra command.
async function grounded(fn: () => Promise<void>): Promise<void> {
  await fn();
  const { printGrounding } = await import("./lib/grounding.js");
  await printGrounding();
}

// --- Top-level commands ---

program.command("go")
  .description("Navigate to a URL")
  .argument("<url>", "URL to navigate to")
  .option("--wait <strategy>", "Wait strategy: idle, load, or commit", "idle")
  .action(async (url, opts) => {
    const { navigate } = await import("./commands/navigate.js");
    await grounded(() => navigate(url, opts));
  });

program.command("reload")
  .description("Reload the current page")
  .option("--wait <strategy>", "Wait strategy: idle, load, or commit", "idle")
  .action(async (opts) => {
    const { reload } = await import("./commands/reload.js");
    await grounded(() => reload(opts));
  });

program.command("status")
  .description("Show this browser's state: url, title, viewport, tabs")
  .option("--json", "Output as JSON")
  .action(async (opts) => {
    const { status } = await import("./commands/status.js");
    await status(opts);
  });

program.command("exec")
  .description("Execute JavaScript in the browser")
  .argument("<js>", "JavaScript code to execute")
  .action(async (js) => {
    const { exec } = await import("./commands/exec.js");
    await exec(js);
  });

program.command("network")
  .description("View network requests captured during last navigation")
  .option("--json", "Output as JSON")
  .action(async (opts) => {
    const { network } = await import("./commands/network.js");
    await network(opts);
  });

program.command("wait")
  .description("Wait for a condition")
  .argument("<condition>", "CSS selector, url:pattern, text:content, hidden:selector, or network-idle")
  .option("--timeout <ms>", "Timeout in milliseconds", parseInt)
  .action(async (condition, opts) => {
    const { wait } = await import("./commands/wait.js");
    await wait(condition, opts);
  });

program.command("pdf")
  .description("Generate PDF of current page")
  .option("--output <path>", "Output file path", "page.pdf")
  .option("--format <fmt>", "Page format: A4 or letter", "A4")
  .option("--landscape", "Landscape orientation")
  .option("--scale <n>", "Scale factor", parseFloat)
  .action(async (opts) => {
    const { pdf } = await import("./commands/pdf.js");
    await pdf(opts);
  });

program.command("crawl")
  .description("Crawl from current page (go to URL first)")
  .option("--depth <n>", "Maximum crawl depth", parseInt)
  .option("--limit <n>", "Maximum pages to scrape", parseInt)
  .option("--merge", "Merge all pages into a single file")
  .option("--output <path>", "Output path")
  .option("--rate <n>", "Requests per second", parseFloat)
  .option("--retry <n>", "Number of retries per page", parseInt)
  .option("--screenshots", "Take screenshots of each page")
  .option("--screenshot-full-page", "Full-page screenshots")
  .option("--scroll <mode>", "Scroll behavior: bottom, random, no")
  .option("--save-dom", "Save rendered DOM of each page")
  .option("--fast", "Block images/fonts/media, no scroll, no rate limit")
  .action(async (opts) => {
    const { crawl } = await import("./commands/crawl.js");
    await crawl(opts);
  });

program.command("normalize")
  .description("Extract all text from crawled DOM into sorted TSV for proofreading")
  .argument("<dir>", "Directory containing .html files (e.g. example.com/dom)")
  .option("--output <path>", "Output file path (default: <dir>/../content.tsv)")
  .action(async (dir, opts) => {
    const { normalize } = await import("./commands/normalize.js");
    await normalize(dir, opts);
  });

const viewportCmd = program.command("viewport").description("Manage browser viewport");

viewportCmd.command("resize")
  .description("Set viewport dimensions")
  .argument("<width>", "Viewport width")
  .argument("<height>", "Viewport height")
  .action(async (width, height) => {
    const { resize } = await import("./commands/resize.js");
    await resize(width, height);
  });

viewportCmd.command("size")
  .description("Print current viewport dimensions")
  .action(async () => {
    const { size } = await import("./commands/resize.js");
    await size();
  });

viewportCmd.command("preset")
  .description("Apply a named viewport preset")
  .argument("<name>", "Preset: mobile, tablet, desktop, or 1080p")
  .action(async (name) => {
    const { preset } = await import("./commands/resize.js");
    await preset(name);
  });

viewportCmd.command("rotate")
  .description("Swap width and height (portrait/landscape toggle)")
  .action(async () => {
    const { rotate } = await import("./commands/resize.js");
    await rotate();
  });

// --- tab namespace ---

const tabCmd = program.command("tab").description("Manage browser tabs");

tabCmd.command("list")
  .description("List open tabs")
  .action(async () => {
    const { tabList } = await import("./commands/tab.js");
    await tabList();
  });

tabCmd.command("create")
  .description("Open a new tab")
  .argument("[url]", "URL to open in new tab")
  .action(async (url) => {
    const { tabCreate } = await import("./commands/tab.js");
    await grounded(() => tabCreate(url));
  });

tabCmd.command("select")
  .description("Switch to a tab by index")
  .argument("<index>", "Tab index", parseInt)
  .action(async (index) => {
    const { tabSelect } = await import("./commands/tab.js");
    await grounded(() => tabSelect(index));
  });

tabCmd.command("next")
  .description("Switch to next tab")
  .action(async () => {
    const { tabNext } = await import("./commands/tab.js");
    await grounded(() => tabNext());
  });

tabCmd.command("previous")
  .description("Switch to previous tab")
  .action(async () => {
    const { tabPrevious } = await import("./commands/tab.js");
    await grounded(() => tabPrevious());
  });

tabCmd.command("close")
  .description("Close a tab")
  .argument("[index]", "Tab index (closes active tab if omitted)", parseInt)
  .action(async (index) => {
    const { tabClose } = await import("./commands/tab.js");
    await grounded(() => tabClose(index));
  });

// --- page namespace ---

const pageCmd = program.command("page").description("Page capture and viewing");

pageCmd.command("screenshot")
  .description("Take a screenshot")
  .option("--output <path>", "Output file path", "screenshot.png")
  .option("--full-page", "Capture full scrollable page")
  .option("--selector <sel>", "CSS selector to screenshot")
  .option("--desktop", "Capture the full virtual desktop")
  .action(async (opts) => {
    const { screenshot } = await import("./commands/screenshot.js");
    await screenshot(opts);
  });

pageCmd.command("view")
  .description("View page in terminal (iTerm2 inline image or ANSI art)")
  .option("--full-page", "Capture full scrollable page")
  .option("--width <cols>", "ANSI output width in columns")
  .action(async (opts) => {
    const { view } = await import("./commands/view.js");
    await view(opts);
  });

pageCmd.command("tail")
  .description("Live-refresh page view (iTerm2 image or ANSI art)")
  .option("--full-page", "Capture full scrollable page")
  .option("--desktop", "Capture the full virtual desktop")
  .option("--width <cols>", "ANSI output width in columns")
  .option("--interval <ms>", "Refresh interval in milliseconds", "1000")
  .action(async (opts) => {
    const { tail } = await import("./commands/view.js");
    await tail(opts);
  });

// --- extract namespace ---

const extractCmd = program.command("extract").description("Extract content from the page");

extractCmd.command("selector")
  .description("Extract text or attributes from elements")
  .argument("<selector>", "CSS selector")
  .option("--all", "Extract all matches")
  .option("--attr <name>", "Extract attribute instead of text")
  .option("--json", "Output as JSON with attributes")
  .action(async (selector, opts) => {
    const { extract } = await import("./commands/extract.js");
    await extract(selector, opts);
  });

extractCmd.command("table")
  .description("Extract table data from current page")
  .argument("[selector]", "CSS selector for the table", "table")
  .option("--json", "Output as JSON")
  .option("--csv", "Output as CSV")
  .option("--headers", "Force first row as headers")
  .action(async (selector, opts) => {
    const { table } = await import("./commands/table.js");
    await table(selector, opts);
  });

extractCmd.command("reader")
  .description("Reader mode: extract clean text from current page or URL")
  .argument("[url]", "URL to read (uses current page if omitted)")
  .option("--output <path>", "Output file path")
  .action(async (url, opts) => {
    const { reader } = await import("./commands/reader.js");
    await reader(url, opts);
  });

extractCmd.command("links")
  .description("List all link destinations on the page")
  .action(async () => {
    const { links } = await import("./commands/links.js");
    await links();
  });

extractCmd.command("source")
  .description("Print hydrated HTML of current page")
  .action(async () => {
    const { source } = await import("./commands/source.js");
    await source();
  });

extractCmd.command("text")
  .description("Dump page text as YAML sections")
  .action(async () => {
    const { text } = await import("./commands/text.js");
    await text();
  });

extractCmd.command("accessibility")
  .description("Take an accessibility snapshot")
  .option("--format <fmt>", "Output format: semdown, aria, or markdown", "semdown")
  .action(async (opts) => {
    const { snapshot } = await import("./commands/snapshot.js");
    await snapshot(opts);
  });

// --- do namespace ---

const doCmd = program.command("do").description("Perform actions on the page");

doCmd.command("click")
  .description("Click an element")
  .argument("[selector]", "CSS selector to click")
  .option("--text <text>", "Click by text content instead of selector")
  .option("--right", "Right-click")
  .option("--double", "Double-click")
  .option("--force", "Skip visibility check")
  .option("--timeout <ms>", "Timeout in milliseconds", parseInt)
  .action(async (selector, opts) => {
    if (!selector && !opts.text) {
      console.error("Error: provide a selector or --text");
      process.exit(1);
    }
    const { click } = await import("./commands/click.js");
    await grounded(() => click(selector ?? "", opts));
  });

doCmd.command("fill")
  .description("Fill a form field")
  .argument("<selector>", "CSS selector of the input")
  .argument("[value]", "Value to fill", "")
  .option("--clear", "Clear the field")
  .option("--timeout <ms>", "Timeout in milliseconds", parseInt)
  .action(async (selector, value, opts) => {
    const { fill } = await import("./commands/fill.js");
    await grounded(() => fill(selector, value, opts));
  });

doCmd.command("upload")
  .description("Upload file(s) to an <input type=file> element")
  .argument("<selector>", "CSS selector of the file input")
  .argument("<files...>", "Path(s) to file(s) to attach (first required, rest optional)")
  .option("--timeout <ms>", "Timeout in milliseconds", parseInt)
  .action(async (selector, files, opts) => {
    const { upload } = await import("./commands/upload.js");
    await grounded(() => upload(selector, files, opts));
  });

doCmd.command("type")
  .description("Type text into the focused element or a selector")
  .argument("<text>", "Text to type")
  .option("--selector <sel>", "CSS selector to type into")
  .option("--delay <ms>", "Delay between keystrokes in ms", parseInt)
  .action(async (text, opts) => {
    const { type } = await import("./commands/type.js");
    await grounded(() => type(text, opts));
  });

doCmd.command("press")
  .description("Press a key (e.g. Enter, Tab, Escape, ArrowDown)")
  .argument("<key>", "Key to press")
  .action(async (key) => {
    const { press } = await import("./commands/type.js");
    await grounded(() => press(key));
  });

doCmd.command("select")
  .description("Select option(s) in a dropdown")
  .argument("<selector>", "CSS selector of the select element")
  .argument("<values...>", "Value(s) to select")
  .action(async (selector, values) => {
    const { select } = await import("./commands/select.js");
    await grounded(() => select(selector, values));
  });

doCmd.command("hover")
  .description("Hover over an element")
  .argument("<selector>", "CSS selector to hover")
  .option("--timeout <ms>", "Timeout in milliseconds", parseInt)
  .action(async (selector, opts) => {
    const { hover } = await import("./commands/hover.js");
    await grounded(() => hover(selector, opts));
  });

doCmd.command("scroll")
  .description("Scroll the page")
  .argument("<direction>", "down, up, bottom, top, or pixel amount")
  .action(async (direction) => {
    const { scroll } = await import("./commands/scroll.js");
    await grounded(() => scroll(direction));
  });

doCmd.command("dismiss")
  .description("Dismiss cookie consent banners")
  .action(async () => {
    const { dismissCookies } = await import("./commands/dismiss-cookies.js");
    await grounded(() => dismissCookies());
  });

// --- cookies namespace ---

const cookiesCmd = program.command("cookies").description("Manage browser cookies");

cookiesCmd.command("list")
  .description("List browser cookies")
  .option("--json", "Output as JSON")
  .action(async (opts) => {
    const { cookiesList } = await import("./commands/cookies.js");
    await cookiesList(opts);
  });

cookiesCmd.command("clear")
  .description("Clear all browser cookies")
  .action(async () => {
    const { cookiesClear } = await import("./commands/cookies.js");
    await cookiesClear();
  });

// --- record namespace ---

const recordCmd = program.command("record").description("Record browser video");

recordCmd.command("start")
  .description("Start recording the browser screen")
  .option("--output <path>", "Output file path", "recording.mp4")
  .action(async (opts) => {
    const { recordStart } = await import("./commands/record.js");
    await recordStart(opts);
  });

recordCmd.command("stop")
  .description("Stop recording and save the video")
  .action(async () => {
    const { recordStop } = await import("./commands/record.js");
    await recordStop();
  });

recordCmd.command("dashcam")
  .description("Start rolling buffer recording (keeps last N seconds)")
  .option("--output <path>", "Output file path", "dashcam.mp4")
  .option("--seconds <n>", "Rolling buffer duration in seconds", parseInt)
  .action(async (opts) => {
    const { recordDashcam } = await import("./commands/record.js");
    await recordDashcam(opts);
  });

recordCmd.command("save")
  .description("Save current dashcam buffer without stopping recording")
  .option("--output <path>", "Output file path")
  .action(async (opts) => {
    const { recordSave } = await import("./commands/record.js");
    await recordSave(opts);
  });

program.parseAsync().catch((err: unknown) => {
  console.error(formatCliError(err));
  process.exit(1);
});
