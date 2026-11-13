// Plain JavaScript on purpose: Rex starts this in a floating pane under whatever Node runs pi, outside pi's TypeScript loader.
import { readFileSync, realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 16;
export const FALLBACK_CELL = { w: 8, h: 16 };
const IMAGE_ID = 7;
const CHUNK = 4096;
const CELL_REPLY_MS = 300;
const LONE_ESC_MS = 100;
const PAN_STEP = 0.15;
const ZOOM_STEP = 1.25;

/** Width and height from the IHDR chunk. */
export function pngSize(bytes) {
  if (bytes.length < 24 || bytes.toString("latin1", 1, 4) !== "PNG") throw new Error("not a PNG");
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

/**
 * Model: { zoom, cx, cy } with the center in image pixels.
 * Screen: { iw, ih, cols, rows, cellW, cellH }. Row 1 holds the header, so the picture gets rows - 1.
 * Returns the source rectangle (x, y, w, h in image pixels), its size in cells (c, r), the 1-based
 * column and row that center it below the header, and the clamped center.
 */
export function fit(model, screen) {
  const { iw, ih, cols, rows, cellW, cellH } = screen;
  const paneW = Math.max(1, cols) * cellW;
  const paneH = Math.max(1, rows - 1) * cellH;
  const scale = Math.min(paneW / iw, paneH / ih) * model.zoom;
  const w = Math.min(iw, paneW / scale);
  const h = Math.min(ih, paneH / scale);
  const cx = Math.min(Math.max(model.cx, w / 2), iw - w / 2);
  const cy = Math.min(Math.max(model.cy, h / 2), ih - h / 2);
  const c = Math.max(1, Math.round((w * scale) / cellW));
  const r = Math.max(1, Math.round((h * scale) / cellH));
  return {
    x: Math.floor(cx - w / 2),
    y: Math.floor(cy - h / 2),
    w: Math.max(1, Math.floor(w)),
    h: Math.max(1, Math.floor(h)),
    c,
    r,
    col: 1 + Math.max(0, Math.floor((cols - c) / 2)),
    row: 2 + Math.max(0, Math.floor((rows - 1 - r) / 2)),
    cx,
    cy,
  };
}

export const initialModel = (iw, ih) => ({ zoom: 1, cx: iw / 2, cy: ih / 2 });

export const zoomBy = (model, factor) => ({
  ...model,
  zoom: Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, model.zoom * factor)),
});

/** Moves the view by dx and dy steps of 15% of the visible span, then clamps it inside the image. */
export function pan(model, screen, dx, dy) {
  const view = fit(model, screen);
  const moved = { ...model, cx: view.cx + dx * view.w * PAN_STEP, cy: view.cy + dy * view.h * PAN_STEP };
  const { cx, cy } = fit(moved, screen);
  return { ...moved, cx, cy };
}

export function header(zoom, cols) {
  return ` zoom ${Math.round(zoom * 100)}%  |  + and - zoom, 0 resets, arrows pan, wheel zooms, q closes`.slice(
    0,
    cols,
  );
}

const ARROWS = { A: "up", B: "down", C: "right", D: "left" };
const PARTIAL = /^\x1b(\[[<0-9;?]{0,30}|_[^\x1b]{0,300}\x1b?)?$/;

/**
 * Splits the text a terminal sends into events. A sequence cut off at the end of a chunk stays in
 * rest for the next call. A lone ESC also stays in rest, because only silence tells it from the start
 * of a sequence.
 * Events: { kind: "reply", text } for a graphics reply, { kind: "cell", w, h } for a cell size report,
 * { kind: "wheel", dir: "up" | "down" }, and { kind: "key", key } with key "up", "down", "left",
 * "right" or the typed character.
 */
export function decode(input) {
  const events = [];
  let rest = input;
  while (rest) {
    let m = /^\x1b_G([^\x1b]*)\x1b\\/.exec(rest);
    if (m) {
      events.push({ kind: "reply", text: m[1] });
      rest = rest.slice(m[0].length);
      continue;
    }
    m = /^\x1b\[<(\d+);\d+;\d+M/.exec(rest);
    if (m) {
      const button = Number(m[1]) & ~(4 | 8 | 16);
      if (button === 64) events.push({ kind: "wheel", dir: "up" });
      else if (button === 65) events.push({ kind: "wheel", dir: "down" });
      rest = rest.slice(m[0].length);
      continue;
    }
    m = /^\x1b\[6;(\d+);(\d+)t/.exec(rest);
    if (m) {
      events.push({ kind: "cell", h: Number(m[1]), w: Number(m[2]) });
      rest = rest.slice(m[0].length);
      continue;
    }
    m = /^\x1b\[([<0-9;?]*)([A-Za-z~])/.exec(rest);
    if (m) {
      const key = m[1] === "" || /^1;\d+$/.test(m[1]) ? ARROWS[m[2]] : undefined;
      if (key) events.push({ kind: "key", key });
      rest = rest.slice(m[0].length);
      continue;
    }
    if (rest[0] === "\x1b") {
      if (PARTIAL.test(rest)) break;
      rest = rest.slice(1);
      continue;
    }
    events.push({ kind: "key", key: rest[0] });
    rest = rest.slice(1);
  }
  return { events, rest };
}

/** The change a key asks for, or null for a key this viewer ignores. */
export function keyAction(key) {
  switch (key) {
    case "+":
    case "=":
      return { zoom: ZOOM_STEP };
    case "-":
      return { zoom: 1 / ZOOM_STEP };
    case "0":
      return { reset: true };
    case "left":
    case "h":
      return { pan: [-1, 0] };
    case "right":
    case "l":
      return { pan: [1, 0] };
    case "up":
    case "k":
      return { pan: [0, -1] };
    case "down":
    case "j":
      return { pan: [0, 1] };
    case "q":
      return { quit: true };
    default:
      return null;
  }
}

export function main(file) {
  const data = readFileSync(file);
  const { width: iw, height: ih } = pngSize(data);
  const { stdin, stdout } = process;
  const write = (text, done) => stdout.write(text, done);
  let model = initialModel(iw, ih);
  let cell = null;
  let cellTimer = null;
  let scheduled = false;
  let pending = "";
  let escTimer = null;
  let closed = false;
  let resent = false;
  let failure = null;

  const screen = () => ({
    iw,
    ih,
    cols: stdout.columns || 80,
    rows: stdout.rows || 24,
    cellW: (cell ?? FALLBACK_CELL).w,
    cellH: (cell ?? FALLBACK_CELL).h,
  });

  const transmit = () => {
    const b64 = data.toString("base64");
    for (let i = 0; i < b64.length; i += CHUNK) {
      const first = i === 0 ? `a=t,f=100,t=d,i=${IMAGE_ID},` : "";
      write(`\x1b_G${first}m=${i + CHUNK < b64.length ? 1 : 0};${b64.slice(i, i + CHUNK)}\x1b\\`);
    }
  };

  const draw = () => {
    scheduled = false;
    if (closed || cellTimer) return;
    const s = screen();
    if (failure) {
      write(`\x1b[H\x1b[2K\x1b[?25l${` cannot show the picture (${failure})  |  q closes`.slice(0, s.cols)}`);
      return;
    }
    const view = fit(model, s);
    model = { ...model, cx: view.cx, cy: view.cy };
    // Never write ESC[2J here: Rex drops the transmitted image data when the display is erased, and the next placement then fails with ENOENT.
    write(
      `\x1b_Ga=d,d=i,i=${IMAGE_ID},q=2\x1b\\\x1b[H\x1b[2K\x1b[?25l${header(model.zoom, s.cols)}\x1b[${view.row};${view.col}H` +
        `\x1b_Ga=p,i=${IMAGE_ID},p=1,x=${view.x},y=${view.y},w=${view.w},h=${view.h},c=${view.c},r=${view.r},C=1\x1b\\`,
    );
  };

  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    setImmediate(draw);
  };

  const queryCell = () => {
    clearTimeout(cellTimer);
    write("\x1b[16t");
    cellTimer = setTimeout(() => {
      cellTimer = null;
      cell ??= FALLBACK_CELL;
      schedule();
    }, CELL_REPLY_MS);
  };

  const close = () => {
    if (closed) return;
    closed = true;
    clearTimeout(cellTimer);
    clearTimeout(escTimer);
    if (stdin.isTTY) stdin.setRawMode(false);
    write(`\x1b[?1000l\x1b[?1006l\x1b_Ga=d,d=I,i=${IMAGE_ID},q=2\x1b\\\x1b[?25h`, () => process.exit(0));
  };

  const handle = (event) => {
    if (event.kind === "reply") {
      const status = event.text.slice(event.text.indexOf(";") + 1);
      if (status === "OK") {
        if (event.text.includes(",p=")) resent = false;
      } else if (status.startsWith("ENOENT") && !resent) {
        // One resend per lost picture: a terminal that keeps dropping it would otherwise be sent the PNG forever.
        resent = true;
        transmit();
        schedule();
      } else {
        failure = status;
        schedule();
      }
    } else if (event.kind === "cell") {
      clearTimeout(cellTimer);
      cellTimer = null;
      cell = { w: event.w, h: event.h };
      schedule();
    } else if (event.kind === "wheel") {
      failure = null;
      model = zoomBy(model, event.dir === "up" ? ZOOM_STEP : 1 / ZOOM_STEP);
      schedule();
    } else {
      const action = keyAction(event.key);
      if (!action) return;
      failure = null;
      if (action.quit) close();
      else if (action.reset) model = initialModel(iw, ih);
      else if (action.zoom) model = zoomBy(model, action.zoom);
      else model = pan(model, screen(), ...action.pan);
      schedule();
    }
  };

  stdin.setEncoding("latin1");
  if (stdin.isTTY) stdin.setRawMode(true);
  stdin.on("data", (chunk) => {
    clearTimeout(escTimer);
    const { events, rest } = decode(pending + chunk);
    pending = rest;
    for (const event of events) handle(event);
    if (pending === "\x1b") {
      escTimer = setTimeout(() => {
        if (pending === "\x1b") close();
      }, LONE_ESC_MS);
    }
  });
  stdin.on("end", close);
  stdout.on("resize", queryCell);
  for (const signal of ["SIGTERM", "SIGHUP"]) process.on(signal, close);

  write("\x1b[?1000h\x1b[?1006h");
  transmit();
  queryCell();
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(realpathSync(entry)).href) {
  if (!process.argv[2]) {
    console.error("usage: pane-viewer.mjs <png>");
    process.exit(2);
  }
  main(process.argv[2]);
}
