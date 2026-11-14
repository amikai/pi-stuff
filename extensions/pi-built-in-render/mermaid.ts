import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getPackageDir, type Theme as PiTheme, type ThemeColor } from "@earendil-works/pi-coding-agent";
import { getCapabilities, Marked } from "@earendil-works/pi-tui";
import type { MermaidArt } from "lovely-mermaid";

// The compiled pi release bundles lovely-mermaid inside its binary and ships no node_modules, and its
// createRequire cannot resolve a bare specifier from disk, so resolve the path through import.meta first.
function loadLovelyMermaid(): typeof import("lovely-mermaid") {
  try {
    return createRequire(import.meta.url)(fileURLToPath(import.meta.resolve("lovely-mermaid")));
  } catch {
    return createRequire(join(getPackageDir(), "package.json"))("lovely-mermaid");
  }
}

const { render, toAnsi } = loadLovelyMermaid();
const parser = new Marked();

export function diagramCodeSpan(row: string): string {
  const content = row || " ";
  const longestRun = Math.max(0, ...Array.from(content.matchAll(/`+/g), (match) => match[0].length));
  const delimiter = "`".repeat(longestRun + 1);
  const padding = content.startsWith("`") || content.endsWith("`") ? " " : "";
  return `${delimiter}${padding}${content}${padding}${delimiter}`;
}

function themedRows(art: MermaidArt, theme: PiTheme): string[] {
  const sgr = (color: ThemeColor) => theme.getFgAnsi(color).slice(2, -1);
  const linkLabels = getCapabilities().hyperlinks;
  // Stock Pi wraps only label text in an OSC 8 link, never the box around it.
  const styled = art.styled.map((row) =>
    row.map(({ href, ...span }) =>
      linkLabels && span.role === "text" && href !== undefined ? { ...span, href } : span,
    ),
  );
  return toAnsi(
    { ...art, styled },
    {
      border: sgr("borderMuted"),
      text: sgr("text"),
      edge: sgr("accent"),
      edgeLabel: sgr("text"),
      title: `1;${sgr("accent")}`,
    },
  );
}

export function transformBuiltInMermaid(markdown: string, availableWidth: number, piTheme?: PiTheme): string {
  return parser
    .lexer(markdown)
    .map((token) => {
      if (token.type !== "code" || token.lang?.trim().split(/\s+/, 1)[0]?.toLowerCase() !== "mermaid") {
        return token.raw;
      }
      const art = render(token.text);
      if (!art || art.width > availableWidth) return token.raw;
      if (art.warnings.length > 0) {
        const suffix = art.warnings.length > 1 ? ` (+${art.warnings.length - 1} more)` : "";
        const warning = `Mermaid diagram not rendered: ${art.warnings[0]}${suffix}`;
        const styledWarning = piTheme ? piTheme.fg("warning", warning) : warning;
        return `${token.raw}\n${diagramCodeSpan(styledWarning)}  \n`;
      }
      const rows = piTheme ? themedRows(art, piTheme) : art.plain;
      return `${rows.map(diagramCodeSpan).join("  \n")}\n`;
    })
    .join("");
}
