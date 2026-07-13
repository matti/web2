import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { yamlEscape, formatYaml } from "../commands/text.js";

describe("yamlEscape", () => {
  it("returns plain strings unchanged", () => {
    assert.equal(yamlEscape("hello"), "hello");
    assert.equal(yamlEscape("simple text"), "simple text");
  });

  it("quotes strings with special YAML chars", () => {
    assert.equal(yamlEscape("key: value"), '"key: value"');
    assert.equal(yamlEscape("has #comment"), '"has #comment"');
    assert.equal(yamlEscape("[array]"), '"[array]"');
    assert.equal(yamlEscape("{object}"), '"{object}"');
    assert.equal(yamlEscape("a & b"), '"a & b"');
    assert.equal(yamlEscape("!bang"), '"!bang"');
    assert.equal(yamlEscape("a|b"), '"a|b"');
    assert.equal(yamlEscape("a>b"), '"a>b"');
    assert.equal(yamlEscape("a'b"), '"a\'b"');
    assert.equal(yamlEscape('a"b'), '"a\\"b"');
    assert.equal(yamlEscape("a%b"), '"a%b"');
    assert.equal(yamlEscape("a@b"), '"a@b"');
    assert.equal(yamlEscape("a`b"), '"a`b"');
  });

  it("quotes strings with newlines and escapes them", () => {
    assert.equal(yamlEscape("line1\nline2"), '"line1\\nline2"');
  });

  it("quotes strings with leading/trailing whitespace", () => {
    assert.equal(yamlEscape(" leading"), '" leading"');
    assert.equal(yamlEscape("trailing "), '"trailing "');
  });

  it("quotes YAML boolean lookalikes", () => {
    assert.equal(yamlEscape("true"), '"true"');
    assert.equal(yamlEscape("false"), '"false"');
    assert.equal(yamlEscape("null"), '"null"');
  });

  it("quotes numeric lookalikes", () => {
    assert.equal(yamlEscape("42"), '"42"');
    assert.equal(yamlEscape("3.14"), '"3.14"');
    assert.equal(yamlEscape("0"), '"0"');
  });

  it("quotes strings starting with - or ?", () => {
    assert.equal(yamlEscape("- item"), '"- item"');
    assert.equal(yamlEscape("? key"), '"? key"');
  });

  it("quotes empty string", () => {
    assert.equal(yamlEscape(""), '""');
  });

  it("passes through strings without special chars", () => {
    assert.equal(yamlEscape("path/to/file"), "path/to/file");
    assert.equal(yamlEscape("hello-world"), "hello-world");
  });
});

describe("formatYaml", () => {
  it("outputs url, title, description", () => {
    const yaml = formatYaml("https://example.com", "Title", "Desc", {});
    assert.match(yaml, /^url: "https:\/\/example\.com"$/m);
    assert.match(yaml, /^title: Title$/m);
    assert.match(yaml, /^description: Desc$/m);
  });

  it("omits title/description if empty", () => {
    const yaml = formatYaml("https://example.com", "", "", {});
    assert.doesNotMatch(yaml, /^title:/m);
    assert.doesNotMatch(yaml, /^description:/m);
  });

  it("outputs sections in canonical order", () => {
    const sections = {
      footer: [{ section: "footer", role: "link", text: "Privacy" }],
      header: [{ section: "header", role: "link", text: "Logo" }],
      main: [{ section: "main", role: "h1", text: "Hello" }],
      nav: [{ section: "nav", role: "link", text: "Home" }],
    };
    const yaml = formatYaml("u", "t", "d", sections);
    const headerPos = yaml.indexOf("header:");
    const navPos = yaml.indexOf("nav:");
    const mainPos = yaml.indexOf("main:");
    const footerPos = yaml.indexOf("footer:");
    assert.ok(headerPos < navPos);
    assert.ok(navPos < mainPos);
    assert.ok(mainPos < footerPos);
  });

  it("includes non-standard sections after standard ones", () => {
    const sections = {
      custom: [{ section: "custom", role: "text", text: "Extra" }],
      main: [{ section: "main", role: "h1", text: "Hello" }],
    };
    const yaml = formatYaml("u", "", "", sections);
    const mainPos = yaml.indexOf("main:");
    const customPos = yaml.indexOf("custom:");
    assert.ok(mainPos < customPos);
  });

  it("formats entries as YAML list items", () => {
    const sections = {
      main: [
        { section: "main", role: "h1", text: "Title" },
        { section: "main", role: "p", text: "Paragraph" },
      ],
    };
    const yaml = formatYaml("u", "", "", sections);
    assert.match(yaml, /^  - h1: Title$/m);
    assert.match(yaml, /^  - p: Paragraph$/m);
  });

  it("escapes special text in entries", () => {
    const sections = {
      main: [{ section: "main", role: "p", text: "key: value" }],
    };
    const yaml = formatYaml("u", "", "", sections);
    assert.match(yaml, /- p: "key: value"/);
  });

  it("ends with newline", () => {
    const yaml = formatYaml("u", "", "", {});
    assert.ok(yaml.endsWith("\n"));
  });
});
