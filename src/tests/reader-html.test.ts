import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { htmlToMarkdown } from "../commands/reader.js";

describe("htmlToMarkdown", () => {
  describe("headings", () => {
    it("converts h1-h6 to markdown headings", () => {
      assert.match(htmlToMarkdown("<h1>Title</h1>"), /^# Title$/m);
      assert.match(htmlToMarkdown("<h2>Sub</h2>"), /^## Sub$/m);
      assert.match(htmlToMarkdown("<h3>Sub3</h3>"), /^### Sub3$/m);
      assert.match(htmlToMarkdown("<h4>Sub4</h4>"), /^#### Sub4$/m);
      assert.match(htmlToMarkdown("<h5>Sub5</h5>"), /^##### Sub5$/m);
      assert.match(htmlToMarkdown("<h6>Sub6</h6>"), /^###### Sub6$/m);
    });

    it("skips empty headings", () => {
      assert.doesNotMatch(htmlToMarkdown("<h1>  </h1>"), /^#/m);
    });
  });

  describe("paragraphs", () => {
    it("converts p tags", () => {
      assert.match(htmlToMarkdown("<p>Hello world</p>"), /Hello world/);
    });

    it("collapses whitespace", () => {
      assert.match(htmlToMarkdown("<p>Hello   world</p>"), /Hello world/);
    });

    it("skips empty paragraphs", () => {
      const md = htmlToMarkdown("<p>  </p>");
      assert.equal(md.trim(), "");
    });
  });

  describe("inline formatting", () => {
    it("converts bold/strong to **", () => {
      assert.match(htmlToMarkdown("<p><strong>bold</strong></p>"), /\*\*bold\*\*/);
      assert.match(htmlToMarkdown("<p><b>bold</b></p>"), /\*\*bold\*\*/);
    });

    it("converts italic/em to *", () => {
      assert.match(htmlToMarkdown("<p><em>italic</em></p>"), /\*italic\*/);
      assert.match(htmlToMarkdown("<p><i>italic</i></p>"), /\*italic\*/);
    });

    it("converts code to backticks", () => {
      assert.match(htmlToMarkdown("<p><code>fn()</code></p>"), /`fn\(\)`/);
    });

    it("converts links to markdown links", () => {
      assert.match(htmlToMarkdown('<p><a href="/about">About</a></p>'), /\[About\]\(\/about\)/);
    });

    it("renders link text without href as plain text", () => {
      const md = htmlToMarkdown("<p><a>No href</a></p>");
      assert.match(md, /No href/);
      assert.doesNotMatch(md, /\[/);
    });

    it("converts br to newline", () => {
      const md = htmlToMarkdown("<p>Line 1<br>Line 2</p>");
      assert.match(md, /Line 1\nLine 2/);
    });
  });

  describe("lists", () => {
    it("converts unordered list", () => {
      const md = htmlToMarkdown("<ul><li>One</li><li>Two</li></ul>");
      assert.match(md, /^- One$/m);
      assert.match(md, /^- Two$/m);
    });

    it("converts ordered list", () => {
      const md = htmlToMarkdown("<ol><li>First</li><li>Second</li></ol>");
      assert.match(md, /^1\. First$/m);
      assert.match(md, /^2\. Second$/m);
    });

    it("skips empty list items", () => {
      const md = htmlToMarkdown("<ul><li>  </li><li>Real</li></ul>");
      assert.doesNotMatch(md, /^- $/m);
      assert.match(md, /^- Real$/m);
    });
  });

  describe("block elements", () => {
    it("converts blockquote", () => {
      assert.match(htmlToMarkdown("<blockquote>Quote text</blockquote>"), /^> Quote text$/m);
    });

    it("converts pre to code block", () => {
      const md = htmlToMarkdown("<pre>code here</pre>");
      assert.match(md, /```\ncode here\n```/);
    });

    it("converts hr to ---", () => {
      assert.match(htmlToMarkdown("<hr>"), /^---$/m);
    });
  });

  describe("div handling", () => {
    it("recurses through divs", () => {
      const md = htmlToMarkdown("<div><p>Inner</p><div><p>Nested</p></div></div>");
      assert.match(md, /Inner/);
      assert.match(md, /Nested/);
    });

    it("preserves headings inside divs", () => {
      const md = htmlToMarkdown("<div><h2>Section</h2><p>Content</p></div>");
      assert.match(md, /^## Section$/m);
      assert.match(md, /Content/);
    });
  });

  describe("skipped elements", () => {
    it("skips figure elements", () => {
      const md = htmlToMarkdown("<figure><img src='x.png'><figcaption>Caption</figcaption></figure>");
      assert.doesNotMatch(md, /Caption/);
    });

    it("skips img elements", () => {
      const md = htmlToMarkdown("<img src='x.png' alt='Photo'>");
      assert.doesNotMatch(md, /Photo/);
    });
  });

  describe("combined content", () => {
    it("handles full article structure", () => {
      const html = `
        <h1>Title</h1>
        <p>Intro with <strong>bold</strong> and <a href="/link">a link</a>.</p>
        <h2>Section</h2>
        <ul><li>Item 1</li><li>Item 2</li></ul>
        <blockquote>A quote</blockquote>
        <pre>code()</pre>
      `;
      const md = htmlToMarkdown(html);
      assert.match(md, /^# Title$/m);
      assert.match(md, /\*\*bold\*\*/);
      assert.match(md, /\[a link\]\(\/link\)/);
      assert.match(md, /^## Section$/m);
      assert.match(md, /^- Item 1$/m);
      assert.match(md, /^> A quote$/m);
      assert.match(md, /```\ncode\(\)\n```/);
    });

    it("collapses multiple blank lines to max 2", () => {
      const md = htmlToMarkdown("<p>A</p><p></p><p></p><p></p><p>B</p>");
      assert.doesNotMatch(md, /\n{4,}/);
    });
  });
});
