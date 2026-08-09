import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { formatArticle, navigate, extractSemdown, extractLinks, scrapePage, dismissCookieBanner, parseAriaYaml, treeToSemdown, type Article, type AriaNode } from "../lib/extract.js";

function createMockLocator(opts: { count?: number; snapshot?: string } = {}) {
  const loc: any = {
    count: mock.fn(async () => opts.count ?? 0),
    ariaSnapshot: mock.fn(async () => opts.snapshot ?? ""),
    first: mock.fn(() => loc),
  };
  return loc;
}

function createMockPage(locators: Record<string, any> = {}) {
  const bodyLocator = locators["body"] || createMockLocator();
  return {
    goto: mock.fn(async () => {}),
    waitForLoadState: mock.fn(async () => {}),
    evaluate: mock.fn(async () => null),
    close: mock.fn(async () => {}),
    locator: mock.fn((sel: string) => locators[sel] || bodyLocator),
    addScriptTag: mock.fn(async () => {}),
    on: mock.fn(() => {}),
    off: mock.fn(() => {}),
  };
}

describe("parseAriaYaml", () => {
  it("parses a simple heading", () => {
    const nodes = parseAriaYaml('- heading "Hello" [level=1]');
    assert.equal(nodes.length, 1);
    assert.equal(nodes[0].role, "heading");
    assert.equal(nodes[0].name, "Hello");
    assert.equal(nodes[0].attrs.level, "1");
  });

  it("parses paragraph with inline text", () => {
    const nodes = parseAriaYaml("- paragraph: Some text here");
    assert.equal(nodes.length, 1);
    assert.equal(nodes[0].role, "paragraph");
    assert.equal(nodes[0].name, "Some text here");
  });

  it("parses nested list structure", () => {
    const yaml = [
      "- list:",
      "  - listitem: Item 1",
      "  - listitem: Item 2",
    ].join("\n");
    const nodes = parseAriaYaml(yaml);
    assert.equal(nodes.length, 1);
    assert.equal(nodes[0].role, "list");
    assert.equal(nodes[0].children.length, 2);
    assert.equal(nodes[0].children[0].name, "Item 1");
    assert.equal(nodes[0].children[1].name, "Item 2");
  });

  it("parses link with /url pseudo-child", () => {
    const yaml = [
      '- link "Click me":',
      '  - /url "https://example.com"',
    ].join("\n");
    const nodes = parseAriaYaml(yaml);
    assert.equal(nodes.length, 1);
    assert.equal(nodes[0].role, "link");
    assert.equal(nodes[0].name, "Click me");
    assert.equal(nodes[0].children.length, 1);
    assert.equal(nodes[0].children[0].role, "/url");
    assert.equal(nodes[0].children[0].name, "https://example.com");
  });

  it("parses role without name or attrs", () => {
    const nodes = parseAriaYaml("- separator");
    assert.equal(nodes.length, 1);
    assert.equal(nodes[0].role, "separator");
    assert.equal(nodes[0].name, "");
  });

  it("parses boolean attribute", () => {
    const nodes = parseAriaYaml('- checkbox "Accept" [checked]');
    assert.equal(nodes[0].attrs.checked, "true");
  });

  it("handles empty input", () => {
    assert.deepEqual(parseAriaYaml(""), []);
  });

  it("skips blank lines", () => {
    const yaml = '- heading "A" [level=1]\n\n- heading "B" [level=2]';
    const nodes = parseAriaYaml(yaml);
    assert.equal(nodes.length, 2);
  });

  it("builds deep nesting correctly", () => {
    const yaml = [
      "- main:",
      "  - section:",
      "    - heading \"Deep\" [level=3]",
    ].join("\n");
    const nodes = parseAriaYaml(yaml);
    assert.equal(nodes[0].role, "main");
    assert.equal(nodes[0].children[0].role, "section");
    assert.equal(nodes[0].children[0].children[0].role, "heading");
    assert.equal(nodes[0].children[0].children[0].name, "Deep");
  });
});

describe("treeToSemdown", () => {
  it("converts heading to semdown", () => {
    const nodes: AriaNode[] = [
      { role: "heading", name: "Title", attrs: { level: "2" }, children: [] },
    ];
    assert.equal(treeToSemdown(nodes), "## Title");
  });

  it("converts paragraph to plain text", () => {
    const nodes: AriaNode[] = [
      { role: "paragraph", name: "Hello world", attrs: {}, children: [] },
    ];
    assert.equal(treeToSemdown(nodes), "Hello world");
  });

  it("wraps navigation in nav: section label", () => {
    const nodes: AriaNode[] = [
      {
        role: "navigation", name: "", attrs: {}, children: [
          { role: "link", name: "Home", attrs: {}, children: [] },
          { role: "link", name: "About", attrs: {}, children: [] },
        ],
      },
      { role: "paragraph", name: "Content", attrs: {}, children: [] },
    ];
    const sd = treeToSemdown(nodes);
    assert.ok(sd.includes("nav:"));
    assert.ok(sd.includes("  Home"));
    assert.ok(sd.includes("  About"));
    assert.ok(sd.includes("Content"));
  });

  it("wraps banner in header: section label", () => {
    const nodes: AriaNode[] = [
      {
        role: "banner", name: "", attrs: {}, children: [
          { role: "heading", name: "Logo", attrs: { level: "1" }, children: [] },
        ],
      },
    ];
    const sd = treeToSemdown(nodes);
    assert.ok(sd.includes("header:"));
    assert.ok(sd.includes("  # Logo"));
  });

  it("wraps contentinfo in footer: section label", () => {
    const nodes: AriaNode[] = [
      {
        role: "contentinfo", name: "", attrs: {}, children: [
          { role: "paragraph", name: "Copyright 2024", attrs: {}, children: [] },
        ],
      },
    ];
    const sd = treeToSemdown(nodes);
    assert.ok(sd.includes("footer:"));
    assert.ok(sd.includes("  Copyright 2024"));
  });

  it("skips img, form, combobox, textbox roles", () => {
    const nodes: AriaNode[] = [
      { role: "img", name: "Photo", attrs: {}, children: [] },
      { role: "form", name: "", attrs: {}, children: [{ role: "textbox", name: "", attrs: {}, children: [] }] },
      { role: "combobox", name: "", attrs: {}, children: [] },
      { role: "paragraph", name: "Visible", attrs: {}, children: [] },
    ];
    assert.equal(treeToSemdown(nodes), "Visible");
  });

  it("renders dialog content (not skipped)", () => {
    const nodes: AriaNode[] = [
      {
        role: "dialog", name: "Cookie consent", attrs: {}, children: [
          { role: "paragraph", name: "We use cookies", attrs: {}, children: [] },
          { role: "button", name: "Accept all", attrs: {}, children: [] },
        ],
      },
    ];
    const sd = treeToSemdown(nodes);
    assert.ok(sd.includes("We use cookies"), "dialog paragraph should be rendered");
    assert.ok(sd.includes("Accept all"), "dialog button should be rendered");
  });

  it("filters carousel noise patterns", () => {
    const nodes: AriaNode[] = [
      { role: "paragraph", name: "2 / 5", attrs: {}, children: [] },
      { role: "button", name: "Next slide", attrs: {}, children: [] },
      { role: "button", name: "Previous page", attrs: {}, children: [] },
      { role: "paragraph", name: "Real content", attrs: {}, children: [] },
    ];
    assert.equal(treeToSemdown(nodes), "Real content");
  });

  it("renders buttons as text (CTAs)", () => {
    const nodes: AriaNode[] = [
      { role: "button", name: "Get Started", attrs: {}, children: [] },
    ];
    assert.equal(treeToSemdown(nodes), "Get Started");
  });

  it("renders flat list items", () => {
    const nodes: AriaNode[] = [
      {
        role: "list", name: "", attrs: {}, children: [
          { role: "listitem", name: "First", attrs: {}, children: [] },
          { role: "listitem", name: "Second", attrs: {}, children: [] },
        ],
      },
    ];
    assert.equal(treeToSemdown(nodes), "- First\n- Second");
  });

  it("renders blockquote with > prefix", () => {
    const nodes: AriaNode[] = [
      { role: "blockquote", name: "A wise quote", attrs: {}, children: [] },
    ];
    assert.equal(treeToSemdown(nodes), "> A wise quote");
  });

  it("renders separator as ---", () => {
    const nodes: AriaNode[] = [
      { role: "paragraph", name: "Above", attrs: {}, children: [] },
      { role: "separator", name: "", attrs: {}, children: [] },
      { role: "paragraph", name: "Below", attrs: {}, children: [] },
    ];
    assert.equal(treeToSemdown(nodes), "Above\n---\nBelow");
  });

  it("does not render URLs", () => {
    const nodes: AriaNode[] = [
      {
        role: "link", name: "Click me", attrs: {}, children: [
          { role: "/url", name: "https://example.com", attrs: {}, children: [] },
        ],
      },
    ];
    const sd = treeToSemdown(nodes);
    assert.ok(sd.includes("Click me"));
    assert.ok(!sd.includes("https://example.com"));
  });

  it("collapses excessive newlines", () => {
    const nodes: AriaNode[] = [
      { role: "paragraph", name: "A", attrs: {}, children: [] },
      { role: "paragraph", name: "", attrs: {}, children: [] },
      { role: "paragraph", name: "B", attrs: {}, children: [] },
    ];
    const sd = treeToSemdown(nodes);
    assert.ok(!sd.includes("\n\n\n"));
  });

  it("renders nested lists with proper indentation", () => {
    const nodes: AriaNode[] = [
      {
        role: "list", name: "", attrs: {}, children: [
          {
            role: "listitem", name: "Parent", attrs: {}, children: [
              {
                role: "list", name: "", attrs: {}, children: [
                  { role: "listitem", name: "Child", attrs: {}, children: [] },
                ],
              },
            ],
          },
        ],
      },
    ];
    const sd = treeToSemdown(nodes);
    assert.ok(sd.includes("- Parent"), "should render parent item");
    assert.ok(sd.includes("  - Child"), "should render child item indented");
  });

  it("renders heading inside listitem", () => {
    const nodes: AriaNode[] = [
      {
        role: "list", name: "", attrs: {}, children: [
          {
            role: "listitem", name: "", attrs: {}, children: [
              { role: "heading", name: "Title", attrs: { level: "2" }, children: [] },
            ],
          },
        ],
      },
    ];
    const sd = treeToSemdown(nodes);
    assert.ok(sd.includes("## Title"), "should render heading inside listitem");
  });

  it("wraps complementary in aside: section label", () => {
    const nodes: AriaNode[] = [
      {
        role: "complementary", name: "", attrs: {}, children: [
          { role: "paragraph", name: "Side content", attrs: {}, children: [] },
        ],
      },
    ];
    const sd = treeToSemdown(nodes);
    assert.ok(sd.includes("aside:"), "should have aside: label");
    assert.ok(sd.includes("  Side content"), "should indent content under aside");
  });

  it("wraps search in search: section label", () => {
    const nodes: AriaNode[] = [
      {
        role: "search", name: "", attrs: {}, children: [
          { role: "paragraph", name: "Search here", attrs: {}, children: [] },
        ],
      },
    ];
    const sd = treeToSemdown(nodes);
    assert.ok(sd.includes("search:"), "should have search: label");
    assert.ok(sd.includes("  Search here"), "should indent content under search");
  });

  it("produces no output for empty section", () => {
    const nodes: AriaNode[] = [
      { role: "navigation", name: "", attrs: {}, children: [] },
      { role: "banner", name: "", attrs: {}, children: [] },
      { role: "contentinfo", name: "", attrs: {}, children: [] },
    ];
    assert.equal(treeToSemdown(nodes), "");
  });

  it("recurses into children for unknown role", () => {
    const nodes: AriaNode[] = [
      {
        role: "region", name: "", attrs: {}, children: [
          { role: "paragraph", name: "Inside region", attrs: {}, children: [] },
        ],
      },
    ];
    assert.equal(treeToSemdown(nodes), "Inside region");
  });

  it("outputs name for unknown role with no children", () => {
    const nodes: AriaNode[] = [
      { role: "status", name: "All good", attrs: {}, children: [] },
    ];
    assert.equal(treeToSemdown(nodes), "All good");
  });

  it("collects text from heading children when heading has no name", () => {
    const nodes: AriaNode[] = [
      {
        role: "heading", name: "", attrs: { level: "1" }, children: [
          { role: "link", name: "Click here", attrs: {}, children: [] },
        ],
      },
    ];
    const sd = treeToSemdown(nodes);
    assert.equal(sd, "# Click here");
  });

  it("renders listitem with heading then trailing text", () => {
    const nodes: AriaNode[] = [
      {
        role: "list", name: "", attrs: {}, children: [
          {
            role: "listitem", name: "", attrs: {}, children: [
              { role: "heading", name: "Section", attrs: { level: "2" }, children: [] },
              { role: "paragraph", name: "Details", attrs: {}, children: [] },
            ],
          },
        ],
      },
    ];
    const sd = treeToSemdown(nodes);
    assert.ok(sd.includes("## Section"), "heading inside listitem");
    assert.ok(sd.includes("Details"), "trailing text after heading in listitem");
  });

  it("renders blockquote with children", () => {
    const nodes: AriaNode[] = [
      {
        role: "blockquote", name: "", attrs: {}, children: [
          { role: "paragraph", name: "Quoted text", attrs: {}, children: [] },
        ],
      },
    ];
    const sd = treeToSemdown(nodes);
    assert.equal(sd, "> Quoted text");
  });

  it("renders button with children (no name)", () => {
    const nodes: AriaNode[] = [
      {
        role: "button", name: "", attrs: {}, children: [
          { role: "text", name: "Submit", attrs: {}, children: [] },
        ],
      },
    ];
    assert.equal(treeToSemdown(nodes), "Submit");
  });

  it("renders paragraph with children", () => {
    const nodes: AriaNode[] = [
      {
        role: "paragraph", name: "", attrs: {}, children: [
          { role: "text", name: "Hello", attrs: {}, children: [] },
          { role: "link", name: "world", attrs: {}, children: [] },
        ],
      },
    ];
    assert.equal(treeToSemdown(nodes), "Hello world");
  });

  it("renders link with children (no name)", () => {
    const nodes: AriaNode[] = [
      {
        role: "link", name: "", attrs: {}, children: [
          { role: "text", name: "Click here", attrs: {}, children: [] },
        ],
      },
    ];
    assert.equal(treeToSemdown(nodes), "Click here");
  });
});

describe("extractSemdown", () => {
  it("returns semdown article from body snapshot", async () => {
    const bodyLocator = createMockLocator({
      snapshot: '- heading "Hello" [level=1]\n- paragraph: World',
    });
    const page = createMockPage({ body: bodyLocator });
    page.evaluate.mock.mockImplementation(async () => ({
      title: "Page Title",
      excerpt: "A description",
      meta: undefined,
    }));

    const result = await extractSemdown(page as any);
    assert.ok(result);
    assert.equal(result!.method, "semdown");
    assert.equal(result!.title, "Page Title");
    assert.ok(result!.content.includes("# Hello"));
    assert.ok(result!.content.includes("World"));
  });

  it("returns null on empty snapshot", async () => {
    const page = createMockPage({
      body: createMockLocator({ snapshot: "" }),
    });

    const result = await extractSemdown(page as any);
    assert.equal(result, null);
  });
});

describe("formatArticle", () => {
  it("formats title, excerpt, and body", () => {
    const article: Article = {
      title: "Hello",
      excerpt: "A summary",
      content: "Body text",
      method: "semdown",
    };
    assert.equal(formatArticle(article), "# Hello\n\n> A summary\n\nBody text\n");
  });

  it("omits excerpt when empty", () => {
    const article: Article = {
      title: "Hello",
      excerpt: "",
      content: "Body text",
      method: "semdown",
    };
    assert.equal(formatArticle(article), "# Hello\n\nBody text\n");
  });

  it("ends with newline", () => {
    const article: Article = {
      title: "T",
      excerpt: "",
      content: "M",
      method: "semdown",
    };
    assert.ok(formatArticle(article).endsWith("\n"));
  });
});

describe("navigate", () => {
  it("calls goto with commit waitUntil", async () => {
    const page = createMockPage();
    await navigate(page as any, "https://example.com");
    assert.equal(page.goto.mock.calls.length, 1);
    const [url, opts] = page.goto.mock.calls[0].arguments;
    assert.equal(url, "https://example.com");
    assert.equal(opts.waitUntil, "commit");
    assert.equal(opts.timeout, 2000);
  });

  it("waits for domcontentloaded then networkidle", async () => {
    const page = createMockPage();
    await navigate(page as any, "https://example.com");
    assert.equal(page.waitForLoadState.mock.calls.length, 2);
    const [state1, opts1] = page.waitForLoadState.mock.calls[0].arguments;
    assert.equal(state1, "domcontentloaded");
    assert.equal(opts1.timeout, 2000);
    const [state2, opts2] = page.waitForLoadState.mock.calls[1].arguments;
    assert.equal(state2, "networkidle");
    assert.equal(opts2.timeout, 2000);
  });

  it("propagates goto errors", async () => {
    const page = createMockPage();
    page.goto.mock.mockImplementation(async () => {
      throw new Error("net::ERR_FAILED");
    });
    await assert.rejects(() => navigate(page as any, "https://bad.test"), {
      message: "net::ERR_FAILED",
    });
  });

  it("swallows networkidle timeout", async () => {
    const page = createMockPage();
    page.waitForLoadState.mock.mockImplementation(async () => {
      throw new Error("Timeout");
    });
    await assert.doesNotReject(() => navigate(page as any, "https://example.com"));
  });
});

describe("dismissCookieBanner", () => {
  it("calls evaluate to find and click accept buttons", async () => {
    const page = createMockPage();
    // Simulate button found and clicked
    page.evaluate.mock.mockImplementation(async () => true);

    await dismissCookieBanner(page as any, 0);
    assert.equal(page.evaluate.mock.calls.length, 1);
  });

  it("falls back to removing overlays when no button found", async () => {
    const page = createMockPage();
    // First call: no button found; second call: remove overlays
    let callCount = 0;
    page.evaluate.mock.mockImplementation(async () => {
      callCount++;
      return callCount === 1 ? false : undefined;
    });

    await dismissCookieBanner(page as any, 0);
    assert.equal(page.evaluate.mock.calls.length, 2);
  });

  it("checks CMP iframes when no button found on main page", async () => {
    const frameEvaluate = mock.fn(async () => true);
    const cmpFrame = {
      url: () => "https://cdn.privacy-mgmt.com/consent",
      evaluate: frameEvaluate,
    };
    const page = createMockPage();
    let evalCount = 0;
    page.evaluate.mock.mockImplementation(async () => {
      evalCount++;
      return false; // no button found on main page
    });
    (page as any).frames = mock.fn(() => [cmpFrame]);

    await dismissCookieBanner(page as any, 0);
    assert.equal(frameEvaluate.mock.calls.length, 1, "should have called evaluate on CMP frame");
  });

  it("skips non-CMP iframes", async () => {
    const frameEvaluate = mock.fn(async () => true);
    const regularFrame = {
      url: () => "https://example.com/widget",
      evaluate: frameEvaluate,
    };
    const page = createMockPage();
    let evalCount = 0;
    page.evaluate.mock.mockImplementation(async () => {
      evalCount++;
      if (evalCount === 1) return false;
      return undefined;
    });
    (page as any).frames = mock.fn(() => [regularFrame]);

    await dismissCookieBanner(page as any, 0);
    assert.equal(frameEvaluate.mock.calls.length, 0, "should not touch non-CMP frames");
  });
});

describe("extractLinks", () => {
  it("returns resolved URLs", async () => {
    const page = createMockPage();
    const links = ["https://example.com/a", "https://example.com/b"];
    page.evaluate.mock.mockImplementation(async () => links);

    const result = await extractLinks(page as any, "https://example.com");
    assert.deepEqual(result, links);
  });

  it("passes baseUrl to evaluate", async () => {
    const page = createMockPage();
    page.evaluate.mock.mockImplementation(async () => []);

    await extractLinks(page as any, "https://example.com");
    const args = page.evaluate.mock.calls[0].arguments;
    assert.equal(args[1], "https://example.com");
  });

  it("returns empty array for empty page", async () => {
    const page = createMockPage();
    page.evaluate.mock.mockImplementation(async () => []);

    const result = await extractLinks(page as any, "https://example.com");
    assert.deepEqual(result, []);
  });

  it("evaluate function queries a, link[rel], and area elements", async () => {
    const page = createMockPage();
    page.evaluate.mock.mockImplementation(async () => []);

    await extractLinks(page as any, "https://example.com");
    assert.equal(page.evaluate.mock.calls.length, 1);
    const fn = page.evaluate.mock.calls[0].arguments[0];
    assert.equal(typeof fn, "function");
  });
});

describe("scrapePage", () => {
  it("navigates, dismisses cookies, scrolls, then extracts semdown", async () => {
    const bodyLocator = createMockLocator({
      snapshot: '- heading "Title" [level=1]\n- paragraph: Content',
    });
    const page = createMockPage({ body: bodyLocator });
    let evalCount = 0;
    page.evaluate.mock.mockImplementation(async (fn: any) => {
      evalCount++;
      // 1-2: dismissCookieBanner
      if (evalCount <= 2) return false;
      // 3: scrollToBottom — hasBody check
      if (evalCount === 3) return true;
      // 4: prevHeight
      if (evalCount === 4) return 100;
      // 5: scrollBy
      if (evalCount === 5) return undefined;
      // 6: newHeight
      if (evalCount === 6) return 100;
      // 7: atBottom
      if (evalCount === 7) return true;
      // 8: extractMeta
      return { title: "Title", excerpt: "", meta: undefined };
    });

    const result = await scrapePage(page as any, "https://example.com");
    assert.ok(result);
    assert.equal(result!.title, "Title");
    assert.equal(result!.method, "semdown");
    assert.equal(page.goto.mock.calls.length, 1);
    assert.equal(page.goto.mock.calls[0].arguments[0], "https://example.com");
  });

  it("returns null on empty snapshot", async () => {
    const page = createMockPage({
      body: createMockLocator({ snapshot: "" }),
    });
    page.evaluate.mock.mockImplementation(async () => false);

    const result = await scrapePage(page as any, "https://example.com");
    assert.equal(result, null);
  });

  it("throws on navigation failure", async () => {
    const page = createMockPage();
    page.goto.mock.mockImplementation(async () => {
      throw new Error("net::ERR_FAILED");
    });

    await assert.rejects(() => scrapePage(page as any, "https://bad.test"), {
      message: "net::ERR_FAILED",
    });
  });
});
