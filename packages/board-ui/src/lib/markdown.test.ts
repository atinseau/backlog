import { describe, expect, it } from "bun:test";
import { renderMarkdown } from "./markdown.js";

// A deliberately small renderer: what an orchestrator co-pilot actually writes.
// No images, no tables, no HTML passthrough — the input is model output, so
// every character is escaped before any markup is added back.

describe("escaping", () => {
  it("neutralises HTML in the source", () => {
    expect(renderMarkdown("<script>alert(1)</script>")).not.toContain("<script>");
  });

  it("keeps the text of an escaped tag readable", () => {
    expect(renderMarkdown("use <div> here")).toContain("&lt;div&gt;");
  });

  it("escapes inside a code block too", () => {
    expect(renderMarkdown("```\n<img onerror=x>\n```")).not.toContain("<img");
  });

  it("refuses to make a link out of a javascript: url", () => {
    // The literal text is harmless once escaped; what must never appear is an
    // href the browser would execute.
    const html = renderMarkdown("[click](javascript:alert)");

    expect(html).not.toContain("<a ");
    expect(html).not.toContain('href="javascript:');
  });

  it("refuses data: urls too", () => {
    expect(renderMarkdown("[x](data:text/html;base64,PHN2Zz4=)")).not.toContain("<a ");
  });

  it("is not fooled by leading whitespace or case in the scheme", () => {
    expect(renderMarkdown("[x](  JaVaScRiPt:alert)")).not.toContain("<a ");
  });

  it("allows an ordinary http link", () => {
    expect(renderMarkdown("[docs](https://example.com/a)")).toContain('href="https://example.com/a"');
  });
});

describe("inline", () => {
  it("renders code spans", () => {
    expect(renderMarkdown("run `subtask_004` now")).toContain("<code>subtask_004</code>");
  });

  it("renders bold and italic", () => {
    expect(renderMarkdown("**hard** and *soft*")).toContain("<strong>hard</strong>");
    expect(renderMarkdown("**hard** and *soft*")).toContain("<em>soft</em>");
  });

  it("leaves an underscore inside an identifier alone", () => {
    // `subtask_004_retry` must not turn into italics.
    expect(renderMarkdown("subtask_004_retry")).toContain("subtask_004_retry");
    expect(renderMarkdown("subtask_004_retry")).not.toContain("<em>");
  });

  it("does not format inside a code span", () => {
    expect(renderMarkdown("`**not bold**`")).toContain("<code>**not bold**</code>");
  });
});

describe("blocks", () => {
  it("renders paragraphs", () => {
    const html = renderMarkdown("first\n\nsecond");

    expect(html).toContain("<p>first</p>");
    expect(html).toContain("<p>second</p>");
  });

  it("keeps a single newline as a line break inside a paragraph", () => {
    expect(renderMarkdown("one\ntwo")).toContain("one<br>two");
  });

  it("renders a fenced code block and remembers its language", () => {
    const html = renderMarkdown("```ts\nconst a = 1;\n```");

    expect(html).toContain("<pre");
    expect(html).toContain('data-lang="ts"');
    expect(html).toContain("const a = 1;");
  });

  it("renders an unlabelled fence", () => {
    expect(renderMarkdown("```\nplain\n```")).toContain("<pre");
  });

  it("renders bullet lists", () => {
    const html = renderMarkdown("- one\n- two");

    expect(html).toContain("<ul>");
    expect(html.match(/<li>/g)).toHaveLength(2);
  });

  it("renders numbered lists", () => {
    expect(renderMarkdown("1. one\n2. two")).toContain("<ol>");
  });

  it("renders headings up to three levels", () => {
    expect(renderMarkdown("## Section")).toContain("<h2>Section</h2>");
    expect(renderMarkdown("### Sub")).toContain("<h3>Sub</h3>");
  });

  it("does not treat a hash inside text as a heading", () => {
    expect(renderMarkdown("issue #42 is open")).not.toContain("<h1>");
  });
});

describe("edge cases", () => {
  it("returns nothing for empty input", () => {
    expect(renderMarkdown("")).toBe("");
    expect(renderMarkdown("   ")).toBe("");
  });

  it("closes an unterminated code fence instead of losing the text", () => {
    const html = renderMarkdown("```ts\nconst a = 1;");

    expect(html).toContain("<pre");
    expect(html).toContain("const a = 1;");
  });

  it("survives a lone asterisk", () => {
    expect(renderMarkdown("2 * 3 = 6")).toContain("2 * 3 = 6");
  });
});
