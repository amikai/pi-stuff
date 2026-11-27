import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import type { ExtensionAPI, ExtensionContext, Theme as PiTheme, ThemeToken } from "@earendil-works/pi-coding-agent";
import {
  AssistantMessageComponent,
  copyToClipboard,
  getAgentDir,
  UserMessageComponent,
} from "@earendil-works/pi-coding-agent";
import {
  type Component,
  Container,
  colorToHex,
  getCapabilities,
  getCellDimensions,
  Markdown,
  matchesKey,
  type OverlayOptions,
  Spacer,
  type TUI,
  type TuiMouseEvent,
  type TuiMouseEventResult,
  truncateToWidth,
  visibleWidth,
} from "@earendil-works/pi-tui";
import { clearHover, watchPointerLeave } from "../lib/pointer-hover.ts";
import {
  artColors,
  type ClipboardBackend,
  clipboardCommand,
  drawsImages,
  type HelperCommand,
  imageCommand,
} from "./core/clipboard.ts";
import { FIGURE_HINT } from "./core/figure.ts";
import {
  ESSENTIAL_STEPS,
  findSetup,
  HINT,
  helpText,
  languageShowcase,
  rtlShowcaseText,
  SETUP_DONE,
  SETUP_ESSENTIALS_DONE,
  SETUP_MORE,
  SETUP_PANE_KEYS,
  SETUP_PANE_OPENED,
  SETUP_STEPS,
  type SetupStep,
  setupParts,
  setupText,
  showcaseText,
} from "./core/help.ts";
import { EL, h, type RenderElement } from "./core/jsx.ts";
import {
  type Formula,
  fitImage,
  fitsImage,
  imageFile,
  imageOf,
  keepFormulas,
  LATEX_DPR,
  LATEX_FONT_PX,
  MAX_IMAGE_BYTES,
  mathOf,
  oldestOver,
  padFor,
  pickFormula,
  pictureRows,
  pngSize,
  ratexColor,
  renderedOf,
} from "./core/latex.ts";
import { type Block, parse } from "./core/markdown.ts";
import { drawDiagrams } from "./core/mermaid.ts";
import { PELE_HINT } from "./core/pele.ts";
import { drawPlantUml, PLANTUML_HINT } from "./core/plantuml.ts";
import {
  type CopyButton,
  drawMath,
  drawsHyperlinks,
  type Fold,
  fileRoot,
  type Hues,
  instanceKey,
  MARK,
  markerRoom,
  mirrored,
  noteTip,
  type PictureButtons,
  pathsToProbe,
  remember,
  renderBlocks,
  renderTurnDuration,
  renderUserPrompt,
  type TerminalEnv,
} from "./core/render.ts";
import { hasRtl, opensLatin, ROW_MARK_TEXT, TERMINALS, type Terminal } from "./core/rtl.ts";
import {
  type ApiTable,
  type BenchTable,
  type CompareTable,
  DEFAULT_THEME,
  type GroupTable,
  type HeatTable,
  isColor,
  type KvTable,
  longHex,
  type PivotTable,
  resolveStyle,
  type SchemaTable,
  type StatusMatrix,
  type Style,
  type TableLayout,
  type TestMatrix,
  type Theme,
  TOKENS,
  type TreeTable,
} from "./core/theme.ts";
import { type Desktop, systemDesktop } from "./desktop.ts";
import { type ImageStore, PrismComponent, renderNode } from "./renderer.ts";

const CUSTOM_MESSAGE_TYPE = "prism-output";
const TURN_ENTRY_TYPE = "prism-turn";
const TURN_WORD = "prism rendering";
const PI_THEME_SYMBOL = Symbol.for("@earendil-works/pi-coding-agent:theme");
const LATEX_HINT =
  "This terminal typesets LaTeX math: a formula in $$…$$ on lines of its own, or in a ```math block, renders as an image (KaTeX syntax). Inline $…$ does not render, so write inline math as plain text or Unicode.";

const LEGACY_OPTION_KEYS = new Set([
  "theme",
  "syncPiTheme",
  "toolStyle",
  "toolOutput",
  "diffStyle",
  "toolRows",
  "issueHint",
  "diffAddedColor",
  "diffRemovedColor",
]);

export type PrismOptions = Record<string, unknown> & {
  enabled?: boolean;
  headingStyle?: Style["headingStyle"];
  tableStyle?: Style["tableStyle"];
  tableLayout?: TableLayout;
  statusMatrix?: StatusMatrix;
  testMatrix?: TestMatrix;
  benchTable?: BenchTable;
  schemaTable?: SchemaTable;
  compareTable?: CompareTable;
  apiTable?: ApiTable;
  kvTable?: KvTable;
  groupTable?: GroupTable;
  heatTable?: HeatTable;
  treeTable?: TreeTable;
  pivotTable?: PivotTable;
  promptStyle?: Style["promptStyle"];
  taskStyle?: Style["taskStyle"];
  pieStyle?: Style["pieStyle"];
  rtl?: Style["rtl"];
  highlightNumbers?: boolean;
  highlightPaths?: boolean;
  mermaid?: boolean;
  mermaidAscii?: boolean;
  copyButtons?: boolean;
  copyButtonStyle?: Style["copyButtonStyle"];
  diagramHints?: boolean;
  latex?: boolean;
  plantuml?: boolean;
  pele?: boolean;
  pictureFill?: boolean;
};

const DEFAULT_OPTIONS: PrismOptions = {
  enabled: true,
  headingStyle: "banner",
  tableStyle: "box",
  tableLayout: "classic",
  statusMatrix: "off",
  testMatrix: "off",
  benchTable: "off",
  schemaTable: "off",
  compareTable: "off",
  apiTable: "off",
  kvTable: "off",
  groupTable: "off",
  heatTable: "off",
  treeTable: "off",
  pivotTable: "off",
  promptStyle: "bubble",
  taskStyle: "checks",
  pieStyle: "round",
  rtl: "auto",
  highlightNumbers: true,
  highlightPaths: true,
  mermaid: true,
  mermaidAscii: false,
  copyButtons: true,
  copyButtonStyle: "inline",
  diagramHints: true,
  latex: false,
  plantuml: true,
  pele: true,
  pictureFill: true,
};

const BOOLEAN_OPTIONS = new Set([
  "enabled",
  "highlightNumbers",
  "highlightPaths",
  "mermaid",
  "mermaidAscii",
  "copyButtons",
  "diagramHints",
  "latex",
  "plantuml",
  "pele",
  "pictureFill",
]);

const ENUM_OPTIONS: Record<string, readonly string[]> = {
  headingStyle: ["banner", "bold", "underline", "uppercase"],
  tableStyle: ["box", "rules", "grid", "minimal"],
  tableLayout: ["classic", "auto", "compact", "stacked"],
  statusMatrix: ["off", "color", "summary", "group"],
  testMatrix: ["off", "report"],
  benchTable: ["off", "color", "trend"],
  schemaTable: ["off", "types", "keys", "full"],
  compareTable: ["off", "rank", "pick", "full"],
  apiTable: ["off", "verbs", "auth", "full"],
  kvTable: ["off", "sources", "overrides", "full"],
  groupTable: ["off", "merge", "count", "full"],
  heatTable: ["off", "color", "bars"],
  treeTable: ["off", "branch", "full"],
  pivotTable: ["off", "transpose"],
  promptStyle: ["bubble", "wide", "bar", "chevron", "off"],
  taskStyle: ["checks", "ticks", "box", "progress"],
  pieStyle: ["round", "bars"],
  copyButtonStyle: ["inline", "hover"],
  rtl: ["auto", "off", ...(Object.keys(TERMINALS) as Terminal[])],
};

const enumChoicesFor = (key: string): readonly string[] | undefined =>
  Object.hasOwn(ENUM_OPTIONS, key) ? ENUM_OPTIONS[key] : undefined;

function sanitizeOptions(raw: Record<string, unknown>): PrismOptions {
  const out: PrismOptions = { ...DEFAULT_OPTIONS };
  for (const [key, value] of Object.entries(stripLegacyKeys(raw))) {
    const choices = enumChoicesFor(key);
    if (BOOLEAN_OPTIONS.has(key)) {
      if (typeof value === "boolean") out[key] = value;
    } else if (choices !== undefined) {
      if (typeof value === "string" && choices.includes(value)) out[key] = value;
    } else {
      out[key] = value;
    }
  }
  return out;
}

export function themeFromPiTheme(piTheme: PiTheme | undefined): Theme {
  if (!piTheme || !piTheme.colors) return DEFAULT_THEME;
  if (piTheme.name === "mono") return {};
  const colors = piTheme.colors;
  const hex = (token: ThemeToken): string | undefined => {
    const c = colors[token];
    return c ? colorToHex(c) : undefined;
  };
  return {
    accent: hex("accent"),
    heading: hex("mdHeading"),
    tableHeader: hex("warning") ?? hex("mdHeading"),
    strong: hex("text"),
    emphasis: hex("syntaxString"),
    inlineCode: hex("mdCode"),
    codeText: hex("text"),
    codeCommand: hex("syntaxKeyword") ?? hex("mdLink"),
    codeFlag: hex("error"),
    codeString: hex("mdCodeBlock") ?? hex("success"),
    codeComment: hex("dim") ?? hex("syntaxComment"),
    link: hex("mdLink"),
    path: hex("syntaxVariable"),
    number: hex("syntaxNumber"),
    quote: hex("mdQuote"),
    rule: hex("borderMuted"),
    tableRule: hex("borderMuted"),
    bullet: hex("mdListBullet"),
    diagram: hex("border"),
    diagramText: hex("text"),
    diffAdded: hex("toolDiffAdded") ?? hex("success"),
    diffRemoved: hex("toolDiffRemoved") ?? hex("error"),
  };
}

export function backgroundFromPiTheme(piTheme: PiTheme | undefined): string | undefined {
  if (!piTheme || !piTheme.colors) return undefined;
  if (piTheme.name === "mono") return undefined;
  return piTheme.appearance === "light" ? "#ffffff" : "#000000";
}

function resolvePrismTheme(options: PrismOptions, piTheme: PiTheme | undefined): Theme {
  const base = themeFromPiTheme(piTheme);
  const overrides = Object.fromEntries(
    TOKENS.filter((k) => isColor(options[`${k}Color`])).map((k) => [k, longHex(String(options[`${k}Color`]).trim())]),
  );
  return { ...base, ...overrides };
}

function stripLegacyKeys(raw: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(raw).filter(([k]) => !LEGACY_OPTION_KEYS.has(k)));
}

export const storePath = () => join(getAgentDir(), "prism.json");
const legacyStorePath = () => join(getAgentDir(), "prismantis.json");

export function loadOptions(): PrismOptions {
  for (const candidate of [storePath(), legacyStorePath()]) {
    try {
      const raw = JSON.parse(readFileSync(candidate, "utf8"));
      if (raw && typeof raw === "object" && !Array.isArray(raw)) {
        return sanitizeOptions(raw as Record<string, unknown>);
      }
    } catch {}
  }
  return { ...DEFAULT_OPTIONS };
}

function saveOptionsWithError(options: PrismOptions): string | null {
  try {
    const clean = stripLegacyKeys(options);
    mkdirSync(getAgentDir(), { recursive: true });
    writeFileSync(storePath(), `${JSON.stringify(clean, null, 2)}\n`);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

export function saveOptions(options: PrismOptions): boolean {
  return saveOptionsWithError(options) === null;
}

function detectTerminalFromEnv(env: NodeJS.ProcessEnv = process.env): Terminal | null {
  const program = env.TERM_PROGRAM;
  const term = env.TERM;
  if (env.KITTY_WINDOW_ID || term === "xterm-kitty") return "kitty";
  if (program === "Apple_Terminal") return "apple-terminal";
  if (program === "WarpTerminal") return "warp";
  if (program === "ghostty") return "ghostty";
  if (program === "WezTerm") return "wezterm";
  if (program === "vscode") return "vscode";
  if (program === "iTerm.app") return "iterm";
  if (term === "alacritty" || env.ALACRITTY_WINDOW_ID) return "alacritty";
  if (env.WT_SESSION) return "windows-terminal";
  if (env.VTE_VERSION) return "gnome";
  if (env.KONSOLE_VERSION) return "konsole";
  return null;
}

const detectSsh = (env: NodeJS.ProcessEnv = process.env): boolean => Boolean(env.SSH_CONNECTION || env.SSH_TTY);

function detectHtmlClipboardBackend(env: NodeJS.ProcessEnv = process.env): ClipboardBackend | null {
  if (detectSsh(env)) return null;
  if (env.OS === "Windows_NT" || process.platform === "win32") return "windows";
  if (process.platform === "darwin" && existsSync("/usr/bin/osascript")) return "macos";
  if (env.WAYLAND_DISPLAY || env.DISPLAY) return "linux";
  return null;
}

const peleEnabled = (style: Style): boolean => style.pele && !style.overSsh;

function detectTerminalEnv(env: NodeJS.ProcessEnv = process.env): TerminalEnv {
  return {
    FORCE_HYPERLINK: env.FORCE_HYPERLINK,
    TERM_PROGRAM: env.TERM_PROGRAM,
    TERM_PROGRAM_VERSION: env.TERM_PROGRAM_VERSION,
    TERM: env.TERM,
    WT_SESSION: env.WT_SESSION,
    LC_TERMINAL: env.LC_TERMINAL,
    VTE_VERSION: env.VTE_VERSION,
    TERMINAL_EMULATOR: env.TERMINAL_EMULATOR,
  };
}

function applyTerminalCapabilities(style: Style, cwd: string): Terminal | null {
  style.cwd = cwd || process.cwd();
  style.home = homedir();
  style.htmlCopy = detectHtmlClipboardBackend();

  style.overSsh = detectSsh();
  const hyperlinks = getCapabilities().hyperlinks || drawsHyperlinks(detectTerminalEnv());
  style.hyperlinks = hyperlinks;
  style.httpLinks = hyperlinks;
  style.editorLinks = hyperlinks;
  style.obsidianLinks = hyperlinks;
  if (hyperlinks && !style.overSsh) {
    const distro = process.env.WSL_DISTRO_NAME;
    const linuxTerm =
      distro !== undefined &&
      Boolean(process.env.VTE_VERSION || process.env.KONSOLE_VERSION || process.env.KITTY_WINDOW_ID);
    style.fileLinks = fileRoot(linuxTerm ? undefined : distro);
    style.pathLinks = true;
  } else {
    style.fileLinks = null;
    style.pathLinks = false;
  }

  if (style.rtl === "off") return null;
  if (style.rtl !== "auto") return style.rtl;
  const terminal = detectTerminalFromEnv();
  style.reorder = terminal !== null;
  if (terminal) style.shape = TERMINALS[terminal];
  return terminal;
}

function runHelperSync(backend: ClipboardBackend, build: (systemRoot?: string) => HelperCommand): string | null {
  const systemRoot = backend === "windows" ? process.env.SystemRoot : undefined;
  const command = build(systemRoot);
  if (backend === "windows" && !systemRoot) return command.failure;
  const [bin, ...args] = command.argv;
  if (!bin) return command.failure;
  try {
    const res = spawnSync(bin, args, {
      input: command.stdin,
      encoding: "utf8",
      timeout: Math.min(30000, (backend === "windows" ? 15000 : 5000) + Math.ceil(command.stdin.length / 100)),
    });
    if (res.error) return command.failure;
    return res.status === 0 ? null : (res.stderr || "").trim() || command.failure;
  } catch {
    return command.failure;
  }
}

function richCommand(
  style: Style,
  backend: ClipboardBackend,
  content: string,
  rich: (() => string) | "png",
  hues?: Hues,
) {
  return (systemRoot?: string): HelperCommand =>
    rich === "png"
      ? imageCommand(backend, content, artColors(style), systemRoot, hues)
      : clipboardCommand(backend, rich(), content, systemRoot);
}

const offers = (style: Style, rich?: (() => string) | "png"): boolean =>
  !rich || (rich === "png" ? drawsImages(style.htmlCopy) : !!style.htmlCopy);

function codeSpan(line: string): string {
  const content = line || "\u00a0";
  const longestBacktickRun = Math.max(0, ...Array.from(content.matchAll(/`+/g), (match) => match[0].length));
  const fence = "`".repeat(longestBacktickRun + 1);
  const padding = content.startsWith("`") || content.endsWith("`") ? " " : "";
  return `${fence}${padding}\x1b[39m${content}${padding}${fence}`;
}

type ActiveMessageHooks = {
  isEnabled: () => boolean;
  renderAssistantText: (
    text: string,
    isFirstOfReply: boolean,
    messageId: string,
    outputPad: number,
    images: ImageStore,
  ) => Component;
  renderUserText: (text: string, outputPad: number) => Component | null;
};

let activeHooks: ActiveMessageHooks | null = null;
const WRAPPED_MARK = Symbol.for("pi-stuff:prism-wrapped");
const IMAGE_STORES = Symbol.for("pi-stuff:prism-images");

function ensureMessagePrototypesPatched() {
  const proto = AssistantMessageComponent.prototype as any;
  if (!proto.updateContent?.[WRAPPED_MARK]) {
    const prevUpdate = proto.updateContent;
    const wrappedUpdate = function (this: any, message: any, isStreaming = this.isStreaming) {
      prevUpdate.call(this, message, isStreaming);
      if (
        !activeHooks?.isEnabled() ||
        !message ||
        !Array.isArray(message.content) ||
        !this.contentContainer?.children
      ) {
        return;
      }
      const textBlocks = message.content.filter((c: any) => c?.type === "text" && c.text?.trim());
      if (textBlocks.length === 0) return;

      const baseId = String(message.timestamp ?? "msg");
      let textIdx = 0;
      // Each update rebuilds the children, so the message keeps the image components, one store per text block.
      this[IMAGE_STORES] ??= [];
      const stores: ImageStore[] = this[IMAGE_STORES];
      const children: Component[] = this.contentContainer.children;
      for (let i = 0; i < children.length && textIdx < textBlocks.length; i++) {
        if (children[i] instanceof Markdown) {
          const text = textBlocks[textIdx]!.text.trim();
          stores[textIdx] ??= new Map();
          children[i] = activeHooks.renderAssistantText(
            text,
            textIdx === 0,
            `${baseId}:${textIdx}`,
            this.outputPad ?? 1,
            stores[textIdx],
          );
          textIdx++;
        }
      }
    };
    (wrappedUpdate as any)[WRAPPED_MARK] = true;
    proto.updateContent = wrappedUpdate;
  }

  const userProto = UserMessageComponent.prototype as any;
  if (!userProto.rebuild?.[WRAPPED_MARK]) {
    const prevRebuild = userProto.rebuild;
    const wrappedRebuild = function (this: any) {
      if (!activeHooks?.isEnabled()) {
        return prevRebuild.call(this);
      }
      const custom = activeHooks.renderUserText(this.text, this.outputPad ?? 1);
      if (!custom) {
        return prevRebuild.call(this);
      }
      this.clear();
      this.addChild(new Spacer(1));
      this.addChild(custom);
    };
    (wrappedRebuild as any)[WRAPPED_MARK] = true;
    userProto.rebuild = wrappedRebuild;
  }
}

const SETUP_LIST_COLUMNS = 28;
const SETUP_HEAD_ROWS = 8;
const SETUP_TABLE = "| Item | Qty |\n|:-----|----:|\n| Apples | 3 |\n| Pears | 5 |";

function copySample(style: Style, value: string, id: string, columns: number): RenderElement[] {
  const label: CopyButton = (_text, key, name = "⧉ copy", rich) =>
    offers(style, rich) ? h(EL.Text, { key, bold: true }, `[ ${name} ]`) : null;
  const table = renderBlocks(
    EL,
    style,
    parse(SETUP_TABLE, { numbers: style.highlightNumbers, paths: style.highlightPaths }),
    columns,
    new Map(),
    label,
  );
  return [
    h(EL.Box, { key: `${id}t`, flexDirection: "column" }, ...table),
    ...(value === "hover"
      ? [h(EL.Text, { key: `${id}h`, dimColor: true }, "Its buttons show only while the pointer is on its ⧉.")]
      : []),
  ];
}

export function drawSetupElements(
  base: Style,
  found: NonNullable<ReturnType<typeof findSetup>>,
  columns: number,
  drawMd: (style: Style, blocks: Block[], cols: number) => RenderElement[],
): RenderElement[] {
  const key = SETUP_STEPS[found.at]!.key;
  const md = (style: Style, text: string, id: string) =>
    h(
      EL.Box,
      { key: id, flexDirection: "column", rowGap: 1 },
      ...drawMd(style, parse(text, { numbers: style.highlightNumbers, paths: style.highlightPaths }), columns),
    );
  const sample = (style: Style, value: string, id: string): RenderElement[] => {
    if (key === "promptStyle") {
      return [
        value === "off"
          ? h(EL.Text, { key: id, dimColor: true }, "> fix the failing test")
          : h(EL.Box, { key: id }, renderUserPrompt(EL, style, "fix the failing test", columns)),
      ];
    }
    if (key === "copyButtonStyle") return copySample(style, value, id, columns);
    return [];
  };
  const picks = found.parts.options.map(({ value, text }, i) => {
    const style = { ...base, [key]: value };
    return h(EL.Box, { key: `o${i}`, flexDirection: "column" }, md(style, text, "m"), ...sample(style, value, "x"));
  });
  return [
    ...(found.before ? [md(base, found.before, "before")] : []),
    md(base, found.parts.head, "head"),
    ...picks,
    md(base, found.parts.tail, "tail"),
  ];
}

class SetupPaneComponent implements Component {
  private stepIndex: number;
  private focusedValue = "";
  private lastHits: { row: number; from: number; to: number; onPress: () => void }[] = [];
  private readonly tui: TUI;
  private readonly piTheme: PiTheme;
  private readonly getState: () => { style: Style; options: PrismOptions };
  private readonly onPick: (step: SetupStep, value: string, hasNext: boolean) => boolean;
  private readonly drawMd: (style: Style, blocks: Block[], cols: number) => RenderElement[];
  private readonly close: () => void;

  constructor(
    tui: TUI,
    piTheme: PiTheme,
    getState: () => { style: Style; options: PrismOptions },
    onPick: (step: SetupStep, value: string, hasNext: boolean) => boolean,
    drawMd: (style: Style, blocks: Block[], cols: number) => RenderElement[],
    close: () => void,
    startAt = 0,
  ) {
    this.tui = tui;
    this.piTheme = piTheme;
    this.getState = getState;
    this.onPick = onPick;
    this.drawMd = drawMd;
    this.close = close;
    this.stepIndex = startAt;
    this.syncFocusToCurrentStep();
  }

  private steps(): readonly SetupStep[] {
    return SETUP_STEPS;
  }

  private tierEnd(): number {
    return this.stepIndex < ESSENTIAL_STEPS ? ESSENTIAL_STEPS : this.steps().length;
  }

  private currentStep(): SetupStep {
    const steps = this.steps();
    return steps[Math.min(this.stepIndex, steps.length - 1)]!;
  }

  private choicesFor(step: SetupStep): readonly string[] {
    return step.options;
  }

  private currentValueOf(step: SetupStep): string {
    const { style } = this.getState();
    return String(style[step.key]);
  }

  private syncFocusToCurrentStep(): void {
    const step = this.currentStep();
    this.focusedValue = this.currentValueOf(step);
  }

  private moveFocus(delta: number): void {
    const step = this.currentStep();
    const choices = this.choicesFor(step);
    const currentIdx = Math.max(0, choices.indexOf(this.focusedValue));
    const nextIdx = (currentIdx + delta + choices.length) % choices.length;
    this.focusedValue = choices[nextIdx]!;
    this.tui.requestRender();
  }

  private confirmCurrent(): void {
    const step = this.currentStep();
    const value = this.focusedValue || this.currentValueOf(step);
    const hasNext = this.stepIndex + 1 < this.tierEnd();
    const saved = this.onPick(step, value, hasNext);
    if (!saved) return;
    if (hasNext) {
      this.stepIndex++;
      this.syncFocusToCurrentStep();
      this.tui.requestRender();
    } else {
      this.close();
    }
  }

  render(width: number): string[] {
    const innerWidth = Math.max(40, width - 4);
    const { style } = this.getState();
    const step = this.currentStep();
    const choices = this.choicesFor(step);
    const currentVal = this.currentValueOf(step);
    const shown = choices.includes(this.focusedValue) ? this.focusedValue : currentVal;
    const parts = setupParts(this.stepIndex);
    const previewOptions = parts.options.filter((o) => o.value === shown);

    const baseStyle: Style = { ...style, copyButtons: false, pathLinks: false };
    const previewCols = Math.max(36, innerWidth - SETUP_LIST_COLUMNS - 4);
    const drawn = drawSetupElements(
      baseStyle,
      { at: this.stepIndex, before: "", parts: { ...parts, options: previewOptions, tail: "" } },
      previewCols,
      this.drawMd,
    );

    const buttons = choices.map((value) =>
      h(EL.Button, {
        key: `pick:${step.name}:${value}`,
        label: value === currentVal ? `${value} (now)` : value,
        variant: value === shown ? "primary" : "secondary",
        onPress: () => {
          this.focusedValue = value;
          this.confirmCurrent();
        },
      }),
    );

    const tree = h(
      EL.Box,
      { flexDirection: "column", rowGap: 1 },
      h(EL.Box, { flexDirection: "column" }, drawn[0]),
      h(EL.Box, {}, h(EL.Text, { dimColor: true }, SETUP_PANE_KEYS)),
      h(
        EL.Box,
        { flexDirection: "row", columnGap: 4 },
        h(EL.Box, { flexDirection: "column", width: SETUP_LIST_COLUMNS }, ...buttons),
        h(EL.Box, { flexDirection: "column", flexGrow: 1 }, ...drawn.slice(1, -1)),
      ),
    );

    const rendered = renderNode(tree, innerWidth);
    const maxRows = Math.max(12, (this.tui.terminal.rows ?? 40) - SETUP_HEAD_ROWS);
    const bodyLines = rendered.lines.slice(0, maxRows);
    this.lastHits = rendered.hits
      .filter((hit) => hit.row < maxRows)
      .map((hit) => ({
        row: hit.row + 1,
        from: hit.from + 2,
        to: hit.to + 2,
        onPress: hit.onPress,
      }));

    const edge = (left: string, label: string, right: string) => {
      const text = label ? ` ${label} ` : "";
      const fill = Math.max(0, width - 2 - visibleWidth(text) - 1);
      return this.piTheme.fg("border", `${left}─${text}${"─".repeat(fill)}${right}`);
    };

    const footer =
      this.stepIndex < ESSENTIAL_STEPS
        ? `Step ${this.stepIndex + 1}/${ESSENTIAL_STEPS} · Esc close`
        : `More ${this.stepIndex + 1 - ESSENTIAL_STEPS}/${this.steps().length - ESSENTIAL_STEPS} · Esc close`;

    return [
      edge("╭", this.piTheme.bold("prism setup"), "╮"),
      ...bodyLines.map((l) => {
        const cut = truncateToWidth(l, innerWidth);
        const pad = Math.max(0, innerWidth - visibleWidth(cut));
        return `${this.piTheme.fg("border", "│")} ${cut}${" ".repeat(pad)} ${this.piTheme.fg("border", "│")}`;
      }),
      edge("╰", this.piTheme.fg("dim", footer), "╯"),
    ].map((l) => truncateToWidth(l, width));
  }

  handleInput(data: string): void {
    if (matchesKey(data, "escape")) {
      this.close();
    } else if (matchesKey(data, "up") || matchesKey(data, "shift+tab")) {
      this.moveFocus(-1);
    } else if (matchesKey(data, "down") || matchesKey(data, "tab")) {
      this.moveFocus(1);
    } else if (matchesKey(data, "enter")) {
      this.confirmCurrent();
    }
  }

  handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
    if (event.button !== "left") return undefined;
    const hit = this.lastHits.find((h) => h.row === event.y && event.x >= h.from && event.x < h.to);
    if (!hit) return undefined;
    if (event.type === "click") hit.onPress();
    return event.type === "press" || event.type === "click" ? { handled: true } : undefined;
  }

  invalidate(): void {}
}

type TypesetFormula = Exclude<Formula, { error: true }> & { tex: string };
type LoadedPicture = { png: string; width: number; height: number; alt: string };
type CachedPicture = { picture: Omit<LoadedPicture, "alt"> | null; bytes: number };
type PathChecks = { asked: Set<string>; found: Set<string> };
const MAX_FOUND_PATHS = 2000;
const MAX_BATCH = 200;
const MAX_ASKED = 5000;
const READ_TOOLS = new Set(["read", "grep", "find", "ls"]);
const WRITE_TOOLS = new Set(["write", "edit"]);

function statTarget(candidate: string, isWsl: boolean): string {
  const drive = isWsl ? /^([a-z]):\/(.*)$/i.exec(candidate) : null;
  return drive ? `/mnt/${drive[1]?.toLowerCase()}/${drive[2]}` : candidate;
}

function rememberFoundPath(found: Set<string>, candidate: string): void {
  found.delete(candidate);
  found.add(candidate);
  while (found.size > MAX_FOUND_PATHS) {
    const oldest = found.values().next().value;
    if (oldest === undefined) break;
    found.delete(oldest);
  }
}

export default function prismExtension(
  pi: ExtensionAPI,
  desktop: Desktop = systemDesktop({ pictures: detectHtmlClipboardBackend() === "macos" }),
) {
  ensureMessagePrototypesPatched();

  let options = loadOptions();
  let style = resolveStyle(options);
  let lastPiColors: unknown;
  let uiCtx: ExtensionContext | undefined;
  let tuiInstance: TUI | undefined;
  let screenTui: TUI | undefined;
  let turnStartedAt = Date.now();

  const parsedCache = new Map<string, ReturnType<typeof parse>>();
  const unfolded = new Set<string>();
  const pathChecks: PathChecks = { asked: new Set<string>(), found: new Set<string>() };
  const handledToolCalls = new Set<string>();
  let formulasStore: Record<string, Formula> = {};
  const pictureCache = new Map<string, CachedPicture>();
  const latexSuffix = randomUUID();

  const parseCached = (text: string, limit = 200) =>
    remember(
      parsedCache,
      `${+style.highlightNumbers}:${+style.highlightPaths}:${text}`,
      () => parse(text, { numbers: style.highlightNumbers, paths: style.highlightPaths }),
      limit,
    );

  function getActivePiTheme(explicitTheme?: PiTheme): PiTheme | undefined {
    if (explicitTheme?.colors) return explicitTheme;
    if (uiCtx?.ui?.theme?.colors) return uiCtx.ui.theme;
    const globalTheme = (globalThis as Record<symbol, PiTheme | undefined>)[PI_THEME_SYMBOL];
    return globalTheme?.colors ? globalTheme : undefined;
  }

  function syncThemeFromPi(explicitTheme?: PiTheme): Style {
    const piTheme = getActivePiTheme(explicitTheme);
    const colorsRef = piTheme?.colors;
    if (colorsRef !== lastPiColors) {
      lastPiColors = colorsRef;
      style = {
        ...style,
        theme: resolvePrismTheme(options, piTheme),
        background: backgroundFromPiTheme(piTheme),
      };
    }
    return style;
  }

  function refreshFromDisk(cwd?: string): void {
    options = loadOptions();
    const piTheme = getActivePiTheme();
    lastPiColors = piTheme?.colors;
    style = { ...resolveStyle(options, themeFromPiTheme(piTheme)), background: backgroundFromPiTheme(piTheme) };
    applyTerminalCapabilities(style, cwd ?? uiCtx?.cwd ?? process.cwd());
  }

  refreshFromDisk();

  function notify(text: string, level: "info" | "warning" | "error" = "info"): void {
    uiCtx?.ui.notify(text, level);
  }

  function toast(text: string, level: "info" | "warning" | "error" = "info"): void {
    const flash = (screenTui as unknown as { flash?: (message: string, durationMs?: number) => void } | undefined)
      ?.flash;
    if (typeof flash === "function") flash.call(screenTui, text, level === "info" ? undefined : 4000);
    else notify(text, level);
  }

  function requestRender(): void {
    (tuiInstance ?? screenTui)?.requestRender();
  }

  function makeFolder(onInvalidate?: () => void): Fold {
    return (id, hidden, key) => {
      const folded = !unfolded.has(id);
      const label = folded ? `+${hidden} more lines` : "show less";
      const toggle = () => {
        if (folded) {
          unfolded.add(id);
          if (unfolded.size > 500) {
            const first = unfolded.values().next().value;
            if (first !== undefined) unfolded.delete(first);
          }
        } else {
          unfolded.delete(id);
        }
        onInvalidate?.();
        requestRender();
      };
      return {
        folded,
        element: h(EL.Button, { key, variant: "secondary", label, onPress: toggle }),
      };
    };
  }

  function makeCopyButton(): CopyButton {
    return (text, key, label = "⧉ copy", rich, hues) => {
      if (!style.copyButtons || !offers(style, rich)) return null;
      return h(EL.Button, {
        key,
        variant: "primary",
        label,
        onPress: () => {
          const content = typeof text === "function" ? text() : text;
          if (rich && style.htmlCopy) {
            const failure = runHelperSync(style.htmlCopy, richCommand(style, style.htmlCopy, content, rich, hues?.()));
            if (failure === null) {
              toast(rich === "png" ? "Copied as image" : "Copied formatted table", "info");
              return;
            }
            try {
              copyToClipboard(content);
              toast(`Copied as plain text (${failure})`, "warning");
            } catch {
              toast("Copy failed", "error");
            }
            return;
          }
          try {
            copyToClipboard(content);
            toast("Copied", "info");
          } catch {
            toast("Copy failed", "error");
          }
        },
      });
    };
  }

  function makePictureButtons(): PictureButtons {
    return (png, b) => {
      if (!style.copyButtons || !desktop.pictures) return [];
      const bytes = () => Buffer.from(png, "base64");
      return [
        h(EL.Button, {
          key: `image${b}`,
          variant: "primary",
          label: "⧉ image",
          onPress: () => {
            const failure = desktop.copyPng(bytes());
            if (failure === null) toast("Copied image", "info");
            else toast(`Image copy failed (${failure})`, "error");
          },
        }),
        h(EL.Button, {
          key: `preview${b}`,
          variant: "primary",
          label: "⧉ preview",
          onPress: () => desktop.previewPng(bytes(), toast),
        }),
      ];
    };
  }

  function typesetFormulasSync(blocks: Block[]): Map<number, TypesetFormula> {
    if (!style.latex || !getCapabilities().images) return new Map();
    const color = ratexColor(style.theme.diagramText ?? style.theme.codeText ?? "#808080");
    const maths = [...blocks.entries()].flatMap(([i, block]) => {
      const tex = mathOf(block);
      return tex === null ? [] : [{ i, tex, key: `${color}\0${tex}` }];
    });
    if (maths.length === 0) return new Map();

    const missing = maths.filter(({ key }) => !formulasStore[key]);
    if (missing.length > 0) {
      const dir = join(tmpdir(), `prism-latex-${latexSuffix}`);
      try {
        mkdirSync(dir, { recursive: true });
        const texs = missing.map((m) => m.tex);
        const runRatex = (inputs: string[], fontSize = LATEX_FONT_PX, dpr = LATEX_DPR): Formula[] => {
          const res = spawnSync(
            "ratex-render",
            [
              "--output-dir",
              dir,
              "--color",
              color,
              "--background-color",
              "transparent",
              "--font-size",
              String(fontSize),
              "--dpr",
              String(dpr),
            ],
            { input: `${inputs.join("\n")}\n`, encoding: "utf8", timeout: 2000 },
          );
          if (res.error || res.status !== 0) return inputs.map(() => ({ error: true }));
          const rendered = renderedOf(res.stdout || "");
          return inputs.map((_, idx): Formula => {
            if (!rendered.has(idx + 1)) return { error: true };
            const file = join(dir, `${String(idx + 1).padStart(4, "0")}.png`);
            try {
              const st = statSync(file);
              if (!st.isFile() || st.size > MAX_IMAGE_BYTES) return { error: true };
              const png = readFileSync(file).toString("base64");
              const size = png ? pngSize(png) : null;
              return size && fitsImage(png) ? { png, ...size } : { error: true };
            } catch {
              return { error: true };
            }
          });
        };
        const initial = runRatex(texs);
        const padded = initial.map((result, idx): Formula => {
          const pad = "png" in result ? padFor(result) : null;
          const [again] = pad ? runRatex([texs[idx]!], pad.fontSize, pad.dpr) : [];
          return again && "png" in again && "png" in result ? { ...result, padded: again } : result;
        });
        const fresh = missing.map((m, idx) => [m.key, padded[idx]!] as const);
        const wanted = new Set(maths.map((m) => m.key));
        formulasStore = keepFormulas(formulasStore, fresh, wanted);
      } catch {}
    }

    return new Map(
      maths.flatMap(({ i, tex, key }) => {
        const formula = formulasStore[key];
        return formula && "png" in formula ? [[i, { tex, ...formula }] as const] : [];
      }),
    );
  }

  function loadPicturesSync(blocks: Block[]): Map<number, LoadedPicture> {
    if (!getCapabilities().images) return new Map();
    const images = [...blocks.entries()].flatMap(([i, block]) => {
      const img = imageOf(block);
      return img ? [{ i, ...img }] : [];
    });
    if (images.length === 0) return new Map();

    const out = new Map<number, LoadedPicture>();
    for (const { i, alt, src } of images) {
      const entry = remember(
        pictureCache,
        src,
        (): CachedPicture => {
          const file = imageFile(src, style.home);
          if (!file) return { picture: null, bytes: src.length };
          let picture: Omit<LoadedPicture, "alt"> | null = null;
          if ("path" in file) {
            try {
              const st = statSync(file.path);
              if (st.isFile() && st.size <= MAX_IMAGE_BYTES) {
                const png = readFileSync(file.path).toString("base64");
                const size = png ? pngSize(png) : null;
                if (size && size.width > 0 && size.height > 0 && fitsImage(png)) {
                  picture = { png, ...size };
                }
              }
            } catch {}
          } else {
            const size = file.png ? pngSize(file.png) : null;
            if (size && size.width > 0 && size.height > 0 && fitsImage(file.png)) {
              picture = { png: file.png, ...size };
            }
          }
          return {
            picture,
            bytes: src.length + (picture ? (picture.png.length * 3) / 4 : 0),
          };
        },
        Infinity,
      );
      for (const old of oldestOver(pictureCache, (_, e) => e.bytes)) {
        pictureCache.delete(old);
      }
      if (entry.picture) out.set(i, { ...entry.picture, alt });
    }
    return out;
  }

  function withFoundPaths(activeStyle: Style, blocks: Block[]): Style {
    if (pathChecks.asked.size >= MAX_ASKED) {
      pathChecks.asked = new Set(pathChecks.found);
    }
    const isWsl = process.env.WSL_DISTRO_NAME !== undefined;
    let probed = 0;
    for (const candidate of pathsToProbe(blocks, activeStyle)) {
      if (pathChecks.asked.has(candidate)) continue;
      if (probed >= MAX_BATCH) break;
      probed++;
      pathChecks.asked.add(candidate);
      try {
        const st = statSync(statTarget(candidate, isWsl));
        if (st.isDirectory()) {
          rememberFoundPath(pathChecks.found, candidate);
          rememberFoundPath(pathChecks.found, `${candidate}/`);
        } else if (st.isFile()) {
          rememberFoundPath(pathChecks.found, candidate);
        }
      } catch {}
    }
    return pathChecks.found.size > 0 ? { ...activeStyle, found: pathChecks.found } : activeStyle;
  }

  function forgetMisses(toolName: string | undefined, input: Record<string, unknown> | undefined, cwd: string): void {
    if (pathChecks.asked.size < MAX_ASKED && toolName !== undefined && READ_TOOLS.has(toolName)) {
      return;
    }
    if (pathChecks.asked.size < MAX_ASKED && toolName !== undefined && WRITE_TOOLS.has(toolName)) {
      const rawPath = typeof input?.path === "string" ? input.path : undefined;
      if (rawPath !== undefined && rawPath.trim() !== "") {
        const base = cwd || style.cwd || process.cwd();
        const resolved = (
          rawPath.startsWith("~/") && style.home
            ? join(style.home, rawPath.slice(2))
            : /^[a-z]:[\\/]/i.test(rawPath)
              ? rawPath
              : isAbsolute(rawPath)
                ? resolve(rawPath)
                : resolve(base, rawPath)
        )
          .replace(/\\/g, "/")
          .replace(/(?<=[^/:])\/+$/, "");
        for (let at = resolved; at.includes("/"); at = at.slice(0, at.lastIndexOf("/"))) {
          pathChecks.asked.delete(at);
        }
        return;
      }
    }
    pathChecks.asked = new Set(pathChecks.found);
  }

  function drawMarkdownElements(
    activeStyle: Style,
    blocks: Block[],
    columns: number,
    options?: {
      replyText?: string;
      noteId?: string;
      onInvalidate?: () => void;
    },
  ): RenderElement[] {
    const copy = makeCopyButton();
    const picture = makePictureButtons();
    const fold = makeFolder(options?.onInvalidate);
    const protocol = getCapabilities().images;
    const rowLimit = pictureRows(protocol);
    const drawn = drawDiagrams(
      EL,
      {
        ...activeStyle,
        images: Boolean(protocol),
        pictureRows: rowLimit,
        pictureFill: activeStyle.pictureFill && protocol === "kitty",
        cellWidthPx: getCellDimensions().widthPx,
      },
      blocks,
      columns - markerRoom(activeStyle),
      peleEnabled(activeStyle) && getCapabilities().images && options?.onInvalidate
        ? { requestRender, onInvalidate: options.onInvalidate }
        : null,
    );
    if (activeStyle.plantuml) {
      const plantuml = drawPlantUml(EL, blocks, columns - markerRoom(activeStyle), {
        images: Boolean(getCapabilities().images),
        pictureRows: rowLimit,
        requestRender,
        onInvalidate: options?.onInvalidate,
      });
      for (const [i, item] of plantuml) drawn.set(i, item);
    }
    const math = typesetFormulasSync(blocks);
    const pictures = loadPicturesSync(blocks);

    for (const [i, formula] of math) {
      const picked = pickFormula(formula, columns);
      if (picked) {
        drawn.set(i, {
          element: h(EL.Image!, {
            key: `b${i}`,
            source: { png: picked.picture.png },
            columns: picked.fit.columns,
            rows: picked.fit.rows,
            alt: formula.tex,
          }),
        });
      }
    }
    for (const [i, picture] of pictures) {
      const fit = fitImage(picture, columns, rowLimit, "natural");
      drawn.set(i, {
        element: h(EL.Image!, {
          key: `b${i}`,
          source: { png: picture.png },
          columns: fit.columns,
          rows: fit.rows,
          alt: picture.alt,
        }),
      });
    }

    const tip = options?.noteId ? noteTip(blocks, (text) => notify(text, "info")) : undefined;
    const probedStyle = withFoundPaths(activeStyle, blocks);
    const effectiveStyle = options?.noteId ? { ...probedStyle, noteKey: instanceKey(options.noteId) } : probedStyle;
    const elements = renderBlocks(
      EL,
      effectiveStyle,
      blocks,
      columns,
      drawMath(EL, effectiveStyle, blocks, drawn),
      copy,
      fold,
      tip,
      picture,
    );
    const replyBtn = options?.replyText === undefined ? null : copy(options.replyText, "reply", "⧉ copy reply");
    if (!replyBtn) return elements;
    return [...elements, h(EL.Box, { key: "reply", alignSelf: "flex-end" }, replyBtn)];
  }

  activeHooks = {
    isEnabled: () => options.enabled !== false,
    renderAssistantText: (text, isFirstOfReply, messageId, outputPad, images) => {
      let comp: PrismComponent | undefined;
      comp = new PrismComponent(
        (columns) => {
          syncThemeFromPi();
          const blocks = parseCached(text);
          if (blocks.length === 0) return h(EL.Text, {}, text);
          const replyText = blocks.length > 1 || hasRtl(text) ? text : undefined;
          const corner = replyText !== undefined && markerRoom(style) > 0;
          const elements = drawMarkdownElements(style, blocks, columns - 2, {
            replyText,
            noteId: messageId,
            onInvalidate: () => comp?.invalidate(),
          });
          return h(
            EL.Box,
            { key: "msg", flexDirection: "row" },
            h(
              EL.Box,
              { width: 2, flexShrink: 0 },
              h(EL.Text, { color: style.theme.accent }, isFirstOfReply ? "●" : " "),
            ),
            h(EL.Box, { flexDirection: "column", rowGap: 1, flexGrow: 1 }, ...elements),
            corner ? h(EL.Box, { width: MARK, flexShrink: 0 }) : null,
          );
        },
        outputPad,
        images,
      );
      return comp;
    },
    renderUserText: (text, outputPad) => {
      if (style.promptStyle === "off") return null;
      return new PrismComponent((columns) => {
        syncThemeFromPi();
        return renderUserPrompt(EL, style, text, columns);
      }, outputPad);
    },
  };

  pi.registerMarkdownTransformer((markdown, context) => {
    if (options.enabled === false || context.messageType === "assistant-thinking") {
      return markdown;
    }
    if (!/```(figure|mermaid)/i.test(markdown)) {
      return markdown;
    }
    syncThemeFromPi();
    const blocks = parseCached(markdown);
    const drawn = drawDiagrams(EL, style, blocks, Math.max(20, context.availableWidth), null);
    if (drawn.size === 0) return markdown;

    let out = markdown;
    for (const [i, item] of drawn.entries()) {
      const block = blocks[i];
      if (!block || block.kind !== "code") continue;
      if (item.element) {
        const rendered = renderNode(item.element, Math.max(20, context.availableWidth));
        if (rendered.lines.length > 0) {
          const replacement = `${rendered.lines.map(codeSpan).join("  \n")}\n`;
          out = out.replace(block.raw, replacement);
        }
      } else if (item.note && !context.isStreaming) {
        out = out.replace(block.raw, `${block.raw}\n${codeSpan(item.note)}  \n`);
      }
    }
    return out;
  });

  function buildPrismOutputComponent(rawText: string, outputPad: number | undefined, piTheme: PiTheme): PrismComponent {
    let comp: PrismComponent | undefined;
    comp = new PrismComponent((columns) => {
      syncThemeFromPi(piTheme);
      const found = findSetup(rawText);
      if (found) {
        const base = { ...style, copyButtons: false, pathLinks: false };
        const elements = drawSetupElements(base, found, columns, (s, b, cols) =>
          drawMarkdownElements(s, b, cols, { onInvalidate: () => comp?.invalidate() }),
        );
        return h(EL.Box, { flexDirection: "column", rowGap: 1 }, ...elements);
      }
      const blocks = parseCached(rawText);
      const elements = drawMarkdownElements(style, blocks, columns, {
        noteId: "cmd",
        onInvalidate: () => comp?.invalidate(),
      });
      return h(EL.Box, { flexDirection: "column", rowGap: 1 }, ...elements);
    }, outputPad ?? 1);
    return comp;
  }

  pi.registerEntryRenderer<{ text: string }>(CUSTOM_MESSAGE_TYPE, (entry, _renderOptions, piTheme) => {
    const rawText = typeof entry.data?.text === "string" ? entry.data.text : "";
    return buildPrismOutputComponent(rawText, 1, piTheme);
  });

  pi.registerMessageRenderer<{ text: string }>(CUSTOM_MESSAGE_TYPE, (message, renderOptions, piTheme) => {
    const rawText =
      typeof message.details?.text === "string"
        ? message.details.text
        : typeof message.content === "string"
          ? message.content
          : "";
    const comp = buildPrismOutputComponent(rawText, renderOptions.outputPad, piTheme);
    const container = new Container();
    container.addChild(new Spacer(1));
    container.addChild(comp);
    return container;
  });

  pi.registerEntryRenderer<{ durationMs: number }>(TURN_ENTRY_TYPE, (entry, _renderOptions, piTheme) => {
    if (options.enabled === false) return undefined;
    const durationMs = entry.data?.durationMs ?? 0;
    return new PrismComponent(() => {
      syncThemeFromPi(piTheme);
      return renderTurnDuration(EL, style, TURN_WORD, durationMs);
    }, 1);
  });

  pi.on("session_start", (_event, ctx) => {
    uiCtx = ctx;
    pathChecks.asked.clear();
    pathChecks.found.clear();
    handledToolCalls.clear();
    ensureMessagePrototypesPatched();
    void Promise.resolve().then(() => ensureMessagePrototypesPatched());
    refreshFromDisk(ctx.cwd);
    if (ctx.mode === "tui") {
      ctx.ui.setWidget("prism-hover", (t) => {
        screenTui = t;
        watchPointerLeave(t);
        return { render: () => [], invalidate: () => {} };
      });
    }
  });

  pi.on("context", (event) => {
    if (!event.messages.some((m) => (m as { customType?: string }).customType === CUSTOM_MESSAGE_TYPE)) {
      return undefined;
    }
    return {
      messages: event.messages.filter((m) => (m as { customType?: string }).customType !== CUSTOM_MESSAGE_TYPE),
    };
  });

  pi.on("session_shutdown", () => {
    uiCtx = undefined;
    tuiInstance = undefined;
    screenTui = undefined;
    clearHover();
  });

  pi.on("tool_result", (event, ctx) => {
    if (typeof event?.toolCallId === "string" && event.toolCallId) {
      handledToolCalls.delete(event.toolCallId);
      handledToolCalls.add(event.toolCallId);
      if (handledToolCalls.size > 500) {
        const oldest = handledToolCalls.values().next().value;
        if (oldest !== undefined) handledToolCalls.delete(oldest);
      }
    }
    forgetMisses(event?.toolName, event?.input, ctx.cwd);
  });

  pi.on("tool_execution_end", (event, ctx) => {
    if (typeof event?.toolCallId === "string" && handledToolCalls.delete(event.toolCallId)) {
      return;
    }
    forgetMisses(event?.toolName, undefined, ctx.cwd);
  });

  pi.on("before_agent_start", (event, ctx) => {
    uiCtx = ctx;
    refreshFromDisk(ctx.cwd);
    turnStartedAt = Date.now();
    if (options.enabled === false || event.messageType !== "user") return;

    const hints: string[] = style.diagramHints
      ? [
          HINT,
          FIGURE_HINT,
          ...(style.latex && getCapabilities().images ? [LATEX_HINT] : []),
          ...(style.plantuml ? [PLANTUML_HINT] : []),
          ...(style.mermaid && peleEnabled(style) && getCapabilities().images ? [PELE_HINT] : []),
        ]
      : [];
    if (hints.length > 0) {
      event.systemPromptOptions.promptGuidelines = [...event.systemPromptOptions.promptGuidelines, ...hints];
    }
  });

  pi.on("agent_end", (_event, ctx) => {
    uiCtx = ctx;
    if (options.enabled === false) return;
    const durationMs = Math.max(0, Date.now() - turnStartedAt);
    if (durationMs >= 1000) {
      pi.appendEntry(TURN_ENTRY_TYPE, { durationMs });
    }
  });

  function saveOptionValue(key: string, value: unknown, title: string, ctx: ExtensionContext): string {
    options = { ...loadOptions(), [key]: value };
    const err = saveOptionsWithError(options);
    if (err !== null) {
      return `Could not save ${key}: ${err}. Set "${key}": ${JSON.stringify(value)} by hand in ${storePath()}.`;
    }
    refreshFromDisk(ctx.cwd);
    requestRender();
    return `${title} set to ${String(value)}.`;
  }

  function saveSetupOption(step: SetupStep, value: string, ctx: ExtensionContext): string {
    return saveOptionValue(step.key, value, step.title, ctx);
  }

  function findSetupStepIndex(query: string): number {
    return SETUP_STEPS.findIndex((s) => s.name === query || s.key === query);
  }

  function sendPrismOutput(text: string): void {
    if (mirrored(style) && hasRtl(text) && opensLatin(text)) {
      text = ROW_MARK_TEXT + text;
    }
    pi.appendEntry(CUSTOM_MESSAGE_TYPE, { text });
  }

  pi.registerCommand("prism", {
    description: "Pick prism styles from samples, or run checkhealth",
    getArgumentCompletions(prefix: string) {
      const subcommands = ["setup", "checkhealth", "checkhealth-rtl"];
      const optionKeys = [
        ...new Set([...SETUP_STEPS.map((s) => s.key), ...BOOLEAN_OPTIONS, ...Object.keys(ENUM_OPTIONS)]),
      ];
      const trimmed = prefix.trimStart();
      if (!trimmed.includes(" ")) {
        const base = subcommands.filter((s) => s.startsWith(trimmed)).map((value) => ({ value, label: value }));
        if (trimmed === "") return base;
        const opts = optionKeys
          .filter((k) => k.startsWith(trimmed) && !subcommands.includes(k))
          .map((value) => ({ value, label: value }));
        return [...base, ...opts];
      }
      const parts = trimmed.split(/\s+/);
      const [first, second = "", third = ""] = parts;
      if (first === "setup") {
        if (parts.length <= 2) {
          const steps = [...SETUP_STEPS.map((s) => s.name), SETUP_MORE];
          return steps
            .filter((s) => s.startsWith(second))
            .map((s) => ({
              value: `setup ${s}`,
              label: s,
            }));
        }
        if (parts.length === 3) {
          const stepIdx = findSetupStepIndex(second);
          const step = stepIdx >= 0 ? SETUP_STEPS[stepIdx] : undefined;
          if (!step) return null;
          return step.options
            .filter((o) => o.startsWith(third))
            .map((o) => ({ value: `setup ${second} ${o}`, label: o }));
        }
        return null;
      }
      if (parts.length === 2 && first) {
        const stepIdx = findSetupStepIndex(first);
        const choices =
          stepIdx >= 0
            ? SETUP_STEPS[stepIdx]?.options
            : (enumChoicesFor(first) ?? (BOOLEAN_OPTIONS.has(first) ? ["true", "false"] : undefined));
        if (!choices) return null;
        return choices.filter((o) => o.startsWith(second)).map((o) => ({ value: `${first} ${o}`, label: o }));
      }
      return null;
    },
    handler: async (args, ctx) => {
      uiCtx = ctx;
      refreshFromDisk(ctx.cwd);
      const [sub, name, third] = args.trim().split(/\s+/);

      if (sub === "checkhealth") {
        const locale = name ?? process.env.LC_ALL ?? process.env.LANG ?? "";
        sendPrismOutput(showcaseText() + languageShowcase(locale));
        return;
      }

      if (sub === "checkhealth-rtl") {
        sendPrismOutput(rtlShowcaseText());
        return;
      }

      if (sub === "setup") {
        const at = name === SETUP_MORE ? ESSENTIAL_STEPS : name ? findSetupStepIndex(name) : 0;
        if ((!name || name === SETUP_MORE) && !third && ctx.mode === "tui") {
          const overlayOpts = (): OverlayOptions => ({
            anchor: "center",
            width: "85%",
            maxHeight: "85%",
            margin: 1,
          });
          void ctx.ui.custom<void>(
            (t, piTheme, _kb, done) => {
              tuiInstance = t;
              syncThemeFromPi(piTheme);
              return new SetupPaneComponent(
                t,
                piTheme,
                () => ({ style: syncThemeFromPi(piTheme), options }),
                (step, value, hasNext) => {
                  const msg = saveSetupOption(step, value, ctx);
                  if (msg.startsWith("Could not")) {
                    notify(msg, "error");
                    return false;
                  }
                  const suffix = hasNext
                    ? ""
                    : step.key === SETUP_STEPS[ESSENTIAL_STEPS - 1]?.key
                      ? ` ${SETUP_ESSENTIALS_DONE}`
                      : ` ${SETUP_DONE}`;
                  notify(`${msg}${suffix}`, "info");
                  return true;
                },
                (s, b, cols) => drawMarkdownElements(s, b, cols),
                () => {
                  tuiInstance = undefined;
                  done();
                },
                at,
              );
            },
            { overlay: true, overlayOptions: overlayOpts },
          );
          notify(SETUP_PANE_OPENED, "info");
          return;
        }

        const step = SETUP_STEPS[at];
        if (!step) {
          sendPrismOutput(`Unknown setup step "${name}". Steps: ${SETUP_STEPS.map((s) => s.name).join(", ")}`);
          return;
        }
        if (!third) {
          sendPrismOutput(setupText(setupParts(at)));
          return;
        }
        const choices = step.options;
        const value = /^\d+$/.test(third) ? step.options[Number(third) - 1] : third;
        if (!value || !choices.includes(value)) {
          sendPrismOutput(
            `Unknown ${step.name} pick "${third}". Pick 1-${step.options.length} or one of: ${choices.join(", ")}`,
          );
          return;
        }
        const saved = saveSetupOption(step, value, ctx);
        if (saved.startsWith("Could not")) {
          sendPrismOutput(saved);
          return;
        }
        const nextText =
          at + 1 === ESSENTIAL_STEPS
            ? SETUP_ESSENTIALS_DONE
            : at + 1 < SETUP_STEPS.length
              ? setupText(setupParts(at + 1))
              : SETUP_DONE;
        sendPrismOutput(`${saved}\n\n${nextText}`);
        return;
      }

      const directAt = sub ? findSetupStepIndex(sub) : -1;
      const directStep = directAt >= 0 ? SETUP_STEPS[directAt] : undefined;
      if (directStep) {
        if (!name) {
          sendPrismOutput(setupText(setupParts(directAt)));
          return;
        }
        const choices = directStep.options;
        const value = /^\d+$/.test(name) ? directStep.options[Number(name) - 1] : name;
        if (!value || !choices.includes(value)) {
          sendPrismOutput(
            `Unknown ${directStep.key} pick "${name}". Pick 1-${directStep.options.length} or one of: ${choices.join(", ")}`,
          );
          return;
        }
        sendPrismOutput(saveSetupOption(directStep, value, ctx));
        return;
      }

      const enumChoices = sub ? enumChoicesFor(sub) : undefined;
      if (sub && (enumChoices !== undefined || BOOLEAN_OPTIONS.has(sub))) {
        if (enumChoices !== undefined) {
          if (!name || !enumChoices.includes(name)) {
            sendPrismOutput(`Unknown ${sub} pick "${name ?? ""}". Pick one of: ${enumChoices.join(", ")}`);
            return;
          }
          sendPrismOutput(saveOptionValue(sub, name, sub, ctx));
          return;
        }
        if (name !== "true" && name !== "false") {
          sendPrismOutput(`Unknown ${sub} pick "${name ?? ""}". Pick true or false.`);
          return;
        }
        sendPrismOutput(saveOptionValue(sub, name === "true", sub, ctx));
        return;
      }

      sendPrismOutput(helpText());
    },
  });
}
