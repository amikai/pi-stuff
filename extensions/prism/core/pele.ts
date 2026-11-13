import { Worker } from "node:worker_threads";
import type { Wake } from "./background.ts";
import { background } from "./background.ts";
import { pngSize } from "./latex.ts";

export type Picture =
  | { state: "declined" }
  | { state: "pending" }
  | { state: "drawn"; png: string; width: number; height: number };

type Drawn = Extract<Picture, { state: "drawn" }>;

/** Whether a wider PNG of a drawn picture is worth asking for. */
type Reach = { kind: "open" } | { kind: "refused"; from: number };

/**
 * What `peleJobs` keeps for a source: nothing drawable, or the widest PNG drawn so far. `pixels` is that PNG's width,
 * and `Drawn.width` and `Drawn.height` are the diagram's own size, which no render changes. A render that is running
 * shows in `peleJobs.pending`, while the entry keeps serving the picture it has.
 */
type Entry = { state: "declined" } | Grown;
type Grown = Drawn & { pixels: number; reach: Reach };

export const peleTimeout = { ms: 5000 };

const MAX_SOURCE = 100000;
const MAX_PICTURE_BYTES = 3 * 1024 * 1024;
// A picture is drawn in multiples of this many pixels, so a small resize of the terminal does not start a render.
const PIXEL_STEP = 256;
const DECLINED = { state: "declined" } as const;
const PENDING = { state: "pending" } as const;

export const peleJobs = background<Entry>({ limit: 100, concurrency: 1, crashed: DECLINED });

export const PELE_KINDS = [
  "timeline",
  "mindmap",
  "gitGraph",
  "journey",
  "quadrantChart",
  "sankey-beta",
  "C4Context",
  "architecture-beta",
  "block-beta",
  "kanban",
  "packet-beta",
  "radar-beta",
  "treemap-beta",
  "requirementDiagram",
] as const;

export const PELE_HINT = `Other \`\`\`mermaid kinds (${PELE_KINDS.join(", ")}) are drawn by prism as an image on a white background, which can be as wide as the terminal and is then as tall as its shape needs, so lay them out wide, not tall, and keep them small.`;

const FRONT_MATTER = /^\s*---\r?\n[\s\S]*?\r?\n---[ \t]*(\r?\n|$)/;

export const headerWord = (source: string): string =>
  source
    .replace(FRONT_MATTER, "")
    .replace(/^(\s*%%[^\n]*\n)+/, "")
    .trim()
    .split(/\s/)[0] ?? "";

type Size = { width: number; height: number };

type Reply = ({ png: Uint8Array; limited: boolean } & Size) | { error: string } | { failed: true };

type Waiting = { settle: (reply: Reply) => void; timer: NodeJS.Timeout };

let worker: Worker | null = null;
let lastId = 0;
const waiting = new Map<number, Waiting>();

// A worker that times out or dies is dropped, so the next render starts a fresh one.
const stopWorker = (): void => {
  const stale = worker;
  worker = null;
  stale?.terminate().catch(() => {});
  const pending = [...waiting.values()];
  waiting.clear();
  for (const { settle, timer } of pending) {
    clearTimeout(timer);
    settle({ failed: true });
  }
};

const startWorker = (): Worker => {
  const started = new Worker(new URL("./vendor/pele.js", import.meta.url));
  started.on("message", (message: { id: number } & Reply) => {
    const entry = waiting.get(message.id);
    if (!entry) return;
    waiting.delete(message.id);
    clearTimeout(entry.timer);
    entry.settle(
      "png" in message ? message : { error: "error" in message ? message.error : "diagram failed to render" },
    );
  });
  const died = () => {
    if (worker === started) stopWorker();
  };
  started.on("error", died);
  started.on("exit", died);
  // Listening for 'message' references the worker again, so unref comes after the listeners.
  started.unref();
  return started;
};

const ask = (source: string, width: number | null): Promise<Reply> =>
  new Promise((resolve) => {
    const id = ++lastId;
    let current: Worker;
    try {
      current = worker ??= startWorker();
    } catch {
      return resolve({ failed: true });
    }
    const timer = setTimeout(stopWorker, peleTimeout.ms);
    waiting.set(id, { settle: resolve, timer });
    current.postMessage(width === null ? { id, source } : { id, source, width });
  });

export const pictureOf = (bytes: Uint8Array, natural: Size): Entry => {
  if (bytes.length > MAX_PICTURE_BYTES) return DECLINED;
  const png = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("base64");
  const size = pngSize(png);
  return size && size.width > 0 && size.height > 0 && natural.width > 0 && natural.height > 0
    ? {
        state: "drawn",
        png,
        width: natural.width,
        height: natural.height,
        pixels: size.width,
        reach: { kind: "open" },
      }
    : DECLINED;
};

// A render the worker cut to its pixel budget would come back the same at this width, so the entry records it as refused.
const draw = async (source: string, width: number | null): Promise<Entry> => {
  const reply = await ask(source, width);
  if (!("png" in reply)) return DECLINED;
  const entry = pictureOf(reply.png, reply);
  return entry.state === "drawn" && reply.limited && width !== null
    ? { ...entry, reach: { kind: "refused", from: width } }
    : entry;
};

// A diagram that is far taller than wide can be too big at the terminal's width and small enough at its own size.
const first = async (source: string, width: number | null): Promise<Entry> => {
  const entry = await draw(source, width);
  if (entry.state === "drawn" || width === null) return entry;
  const natural = await draw(source, null);
  return natural.state === "drawn" ? { ...natural, reach: { kind: "refused", from: width } } : natural;
};

const roundUp = (pixels: number): number => Math.ceil(pixels / PIXEL_STEP) * PIXEL_STEP;

// The PNG width to ask for, or null when the picture is wide enough or a render this wide has already failed.
const widthToGrow = (have: Grown, pixels: number): number | null => {
  if (have.pixels >= pixels) return null;
  const width = Math.max(roundUp(pixels), Math.ceil(have.width * 2));
  return have.reach.kind === "refused" && width >= have.reach.from ? null : width;
};

const grow = async (source: string, have: Grown, width: number): Promise<Entry> => {
  const next = await draw(source, width);
  if (next.state === "drawn" && next.pixels > have.pixels) return next;
  const from = have.reach.kind === "refused" ? Math.min(have.reach.from, width) : width;
  return { ...have, reach: { kind: "refused", from } };
};

/**
 * `pixels` is the PNG width the caller can use, or null to take the picture at twice the diagram's size. A picture
 * that is too narrow is returned as it is while a wider one is drawn, so it stays on screen until the new one replaces it.
 */
export const pelePicture = (untagged: string, wake: Wake, pixels: number | null): Picture => {
  if (headerWord(untagged) === "") return DECLINED;
  if (untagged.length > MAX_SOURCE) return DECLINED;
  const have = peleJobs.get(untagged, () => first(untagged, pixels === null ? null : roundUp(pixels)), wake);
  if (!have) return PENDING;
  if (have.state === "drawn" && pixels !== null) {
    const width = widthToGrow(have, pixels);
    if (width !== null) peleJobs.refresh(untagged, () => grow(untagged, have, width), wake);
  }
  return have;
};
