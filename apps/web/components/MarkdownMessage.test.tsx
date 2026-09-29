import { render, screen } from "@testing-library/react";
import fc from "fast-check";
import { MarkdownMessage } from "./MarkdownMessage";
test("renders headings, emphasis, lists and code with valid block structure", () => {
  const { container } = render(
    <MarkdownMessage
      content={
        "# First\n## Second\n### Third\n\n**bold** and *italic* with `inline`\n---\n- alpha\n* beta\n1. first\n2. second\n```ts\nconst answer = 42;\n```"
      }
    />,
  );
  expect(
    screen.getByRole("heading", { level: 1, name: "First" }),
  ).toBeVisible();
  expect(
    screen.getByRole("heading", { level: 2, name: "Second" }),
  ).toBeVisible();
  expect(
    screen.getByRole("heading", { level: 3, name: "Third" }),
  ).toBeVisible();
  expect(container.querySelectorAll("p h1,p h2,p h3")).toHaveLength(0);
  expect(container.querySelector("strong")).toHaveTextContent("bold");
  expect(container.querySelector("em")).toHaveTextContent("italic");
  expect(screen.getAllByRole("list")).toHaveLength(2);
  expect(screen.getAllByRole("listitem")).toHaveLength(4);
  expect(container.querySelector('pre[data-lang="ts"]')).toHaveTextContent(
    "const answer = 42;",
  );
  expect(screen.getByRole("separator")).toBeVisible();
});
test.each([
  "https://example.com/docs",
  "http://homeserver.local",
  "mailto:me@example.com",
  "/now",
  "#task",
])("safe link %s is usable and does not gain opener access", (href) => {
  render(<MarkdownMessage content={`[Open](${href})`} />);
  expect(screen.getByRole("link", { name: "Open" })).toHaveAttribute(
    "href",
    href,
  );
  expect(screen.getByRole("link")).toHaveAttribute(
    "rel",
    "noopener noreferrer",
  );
});
test.each([
  "javascript:alert(1)",
  "data:text/html,unsafe",
  "vbscript:msgbox(1)",
  "//attacker.invalid",
  "java\tscript:alert",
])("unsafe link %s remains plain text", (href) => {
  render(<MarkdownMessage content={`[Untrusted](${href})`} />);
  expect(screen.queryByRole("link")).toBeNull();
  expect(screen.getByText("Untrusted")).toBeVisible();
});
test("unclosed fences remain code and raw HTML never becomes active markup", () => {
  const { container } = render(
    <MarkdownMessage
      content={"<script>alert(1)</script>\n```\n<img src=x onerror=alert(1)>"}
    />,
  );
  expect(container.querySelector("script,img")).toBeNull();
  expect(container.querySelector("pre")).toHaveTextContent(
    "<img src=x onerror=alert(1)>",
  );
});
test("arbitrary markdown text cannot create script or iframe elements", () => {
  fc.assert(
    fc.property(fc.string({ maxLength: 500 }), (text) => {
      const view = render(<MarkdownMessage content={text} />);
      expect(view.container.querySelector("script,iframe")).toBeNull();
      view.unmount();
    }),
    { numRuns: 100, seed: 529 },
  );
});
