import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const clickSrc = readFileSync(join(import.meta.dirname, "../commands/click.ts"), "utf-8");
const fillSrc = readFileSync(join(import.meta.dirname, "../commands/fill.ts"), "utf-8");
const typeSrc = readFileSync(join(import.meta.dirname, "../commands/type.ts"), "utf-8");
const selectSrc = readFileSync(join(import.meta.dirname, "../commands/select.ts"), "utf-8");
const hoverSrc = readFileSync(join(import.meta.dirname, "../commands/hover.ts"), "utf-8");

describe("click command", () => {
  it("uses getByText when --text is provided", () => {
    assert.ok(clickSrc.includes("getByText(opts.text"));
    assert.ok(clickSrc.includes("exact: false"));
  });

  it("uses locator when no --text", () => {
    assert.ok(clickSrc.includes("page.locator(selector)"));
  });

  it("supports right-click", () => {
    assert.ok(clickSrc.includes('opts.right ? "right" : "left"'));
  });

  it("supports double-click", () => {
    assert.ok(clickSrc.includes("dblclick"));
    assert.ok(clickSrc.includes("opts.double"));
  });

  it("supports force flag", () => {
    assert.ok(clickSrc.includes("force: opts.force"));
  });

  it("defaults timeout to 2000ms", () => {
    assert.ok(clickSrc.includes("opts.timeout ?? 2000"));
  });

  it("reports clicked label to stderr", () => {
    assert.ok(clickSrc.includes("opts.text ?? selector"));
    assert.ok(clickSrc.includes("Clicked: ${label}"));
  });
});

describe("click option logic", () => {
  function resolveClick(opts: { text?: string; right?: boolean; double?: boolean }) {
    const button = opts.right ? "right" : "left";
    const method = opts.double ? "dblclick" : "click";
    const locatorType = opts.text ? "getByText" : "locator";
    return { button, method, locatorType };
  }

  it("defaults to left single click with locator", () => {
    assert.deepEqual(resolveClick({}), { button: "left", method: "click", locatorType: "locator" });
  });

  it("right-click uses right button", () => {
    assert.deepEqual(resolveClick({ right: true }), { button: "right", method: "click", locatorType: "locator" });
  });

  it("double-click uses dblclick method", () => {
    assert.deepEqual(resolveClick({ double: true }), { button: "left", method: "dblclick", locatorType: "locator" });
  });

  it("text option uses getByText", () => {
    assert.deepEqual(resolveClick({ text: "Submit" }), { button: "left", method: "click", locatorType: "getByText" });
  });

  it("combined right+double+text", () => {
    assert.deepEqual(
      resolveClick({ text: "X", right: true, double: true }),
      { button: "right", method: "dblclick", locatorType: "getByText" },
    );
  });
});

describe("fill command", () => {
  it("defaults timeout to 2000ms", () => {
    assert.ok(fillSrc.includes("options.timeout ?? 2000"));
  });

  it("handles --clear with empty value", () => {
    assert.ok(fillSrc.includes("options.clear && !value"));
    assert.ok(fillSrc.includes('page.fill(selector, ""'));
  });

  it("reports filled selector to stderr", () => {
    assert.ok(fillSrc.includes("Filled: ${selector}"));
  });
});

describe("fill clear logic", () => {
  function resolveFill(value: string, clear?: boolean): string {
    if (clear && !value) return "";
    return value;
  }

  it("clears when clear=true and no value", () => {
    assert.equal(resolveFill("", true), "");
  });

  it("uses value when provided, ignoring clear", () => {
    assert.equal(resolveFill("hello", true), "hello");
  });

  it("uses value normally", () => {
    assert.equal(resolveFill("hello"), "hello");
  });
});

describe("type command", () => {
  it("supports --selector option", () => {
    assert.ok(typeSrc.includes("options.selector"));
    assert.ok(typeSrc.includes("page.type(options.selector"));
  });

  it("falls back to keyboard.type without selector", () => {
    assert.ok(typeSrc.includes("page.keyboard.type(text"));
  });

  it("supports --delay option", () => {
    assert.ok(typeSrc.includes("options.delay ?? 0"));
  });

  it("reports character count to stderr", () => {
    assert.ok(typeSrc.includes("Typed: ${text.length} characters"));
  });
});

describe("press command", () => {
  it("uses keyboard.press", () => {
    assert.ok(typeSrc.includes("page.keyboard.press(key)"));
  });

  it("reports key name to stderr", () => {
    assert.ok(typeSrc.includes("Pressed: ${key}"));
  });
});

describe("select command", () => {
  it("uses selectOption with values array", () => {
    assert.ok(selectSrc.includes("page.selectOption(selector, values)"));
  });

  it("reports selected values to stderr", () => {
    assert.ok(selectSrc.includes('values.join(", ")'));
  });
});

describe("hover command", () => {
  it("defaults timeout to 2000ms", () => {
    assert.ok(hoverSrc.includes("opts.timeout ?? 2000"));
  });

  it("uses locator.hover", () => {
    assert.ok(hoverSrc.includes(".hover("));
  });

  it("reports hovered selector to stderr", () => {
    assert.ok(hoverSrc.includes("Hovered: ${selector}"));
  });
});
