import { Worker } from "node:worker_threads";
import type { Wake } from "./background.ts";
import { background } from "./background.ts";
import { pngSize } from "./latex.ts";

export type Picture =
  | { state: "declined" }
  | { state: "pending" }
  | { state: "drawn"; png: string; width: number; height: number };

type Settled = Exclude<Picture, { state: "pending" }>;

export const peleTimeout = { ms: 5000 };

const MAX_SOURCE = 100000;
const MAX_PICTURE_BYTES = 3 * 1024 * 1024;
// A 1x PNG blurs when a Retina terminal stretches it, so the worker draws at 2x and the reported size is half the pixels.
const ZOOM = 2;
const DECLINED: Settled = { state: "declined" };

export const peleJobs = background<Settled>({ limit: 100, concurrency: 1, crashed: DECLINED });

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

export const PELE_HINT = `Other \`\`\`mermaid kinds (${PELE_KINDS.join(", ")}) are drawn by prism as an image on a white background, no wider than the terminal, so keep them small.`;

const FRONT_MATTER = /^\s*---\r?\n[\s\S]*?\r?\n---[ \t]*(\r?\n|$)/;

export const headerWord = (source: string): string =>
  source
    .replace(FRONT_MATTER, "")
    .replace(/^(\s*%%[^\n]*\n)+/, "")
    .trim()
    .split(/\s/)[0] ?? "";

type Reply = { png: Uint8Array } | { error: string } | { failed: true };

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
  started.on("message", (message: { id: number; png?: Uint8Array; error?: string }) => {
    const entry = waiting.get(message.id);
    if (!entry) return;
    waiting.delete(message.id);
    clearTimeout(entry.timer);
    entry.settle(message.png ? { png: message.png } : { error: message.error ?? "diagram failed to render" });
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

const ask = (source: string): Promise<Reply> =>
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
    current.postMessage({ id, source });
  });

export const pictureOf = (bytes: Uint8Array): Settled => {
  if (bytes.length > MAX_PICTURE_BYTES) return DECLINED;
  const png = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("base64");
  const size = pngSize(png);
  return size && size.width > 0 && size.height > 0
    ? { state: "drawn", png, width: size.width / ZOOM, height: size.height / ZOOM }
    : DECLINED;
};

const render = async (source: string): Promise<Settled> => {
  const reply = await ask(source);
  return "png" in reply ? pictureOf(reply.png) : DECLINED;
};

export const pelePicture = (untagged: string, wake: Wake): Picture => {
  if (headerWord(untagged) === "") return DECLINED;
  if (untagged.length > MAX_SOURCE) return DECLINED;
  return peleJobs.get(untagged, () => render(untagged), wake) ?? { state: "pending" };
};
