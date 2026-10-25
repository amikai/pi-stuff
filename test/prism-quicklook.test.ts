import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { crc32, deflateSync } from "node:zlib";

// These tests open real Quick Look panels on the screen, one after another, and briefly take the screen fullscreen.
// test/quicklook-probe.swift is injected into the helper to read the title bar and press the zoom buttons from inside.

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const previewToolbar = "/System/Applications/Preview.app/Contents/Resources/CommonToolbar.proplist";
const skip =
	process.platform !== "darwin"
		? "Quick Look exists only on macOS"
		: process.env.SSH_CONNECTION || process.env.SSH_TTY
			? "over SSH the panel opens on a screen nobody watches"
			: !existsSync("/usr/bin/swiftc") || !existsSync("/usr/bin/clang")
				? "building the helper needs the Xcode command line tools"
				: false;

type Box = [x: number, y: number, width: number, height: number];
type Button = { label: string; title: string; toolTip: string; frame: Box; fittingWidth: number };
type Item = { kind: string; frame: Box; fittingWidth: number; text?: string; fullWidth?: number; lineBreakMode?: number; buttons?: Button[] };
type Layout = { op: "layout"; panel: Box; minSize: [number, number]; titleBar: Box; items: Item[]; openButtons: number };
type Scale = { op: "scale"; scale?: number; error?: string };
type Step =
	| { op: "layout" | "scale" | "enterFullscreen" | "exitFullscreen" | "close" | "clickClose" }
	| { op: "drag" | "resize"; width: number }
	| { op: "press"; label: "Zoom Out" | "Actual Size" | "Zoom In" }
	| { op: "key"; key: "space" | "escape" };

let dir = "";
let helper = "";
let probe = "";
let runs = 0;

before(() => {
	if (skip) return;
	dir = mkdtempSync(join(tmpdir(), "prism-quicklook-"));
	helper = join(dir, "quicklook");
	probe = join(dir, "probe.dylib");
	// The same flags extensions/prism/desktop.ts builds the helper with.
	execFileSync("/usr/bin/swiftc", ["-O", join(root, "extensions/prism/quicklook.swift"), "-o", helper]);
	execFileSync("/usr/bin/clang", ["-c", join(root, "test/quicklook-probe-load.c"), "-o", join(dir, "load.o")]);
	execFileSync("/usr/bin/swiftc", ["-emit-library", "-o", probe, join(root, "test/quicklook-probe.swift"), join(dir, "load.o")]);
});

after(() => {
	if (dir) rmSync(dir, { recursive: true, force: true });
});

// Vertical red and blue stripes 10 px wide, so the probe can read the zoom off a screenshot.
const stripes = (name: string, width: number, height: number) => {
	const chunk = (type: string, data: Buffer) => {
		const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
		const head = Buffer.alloc(4);
		head.writeUInt32BE(data.length);
		const tail = Buffer.alloc(4);
		tail.writeUInt32BE(crc32(body));
		return Buffer.concat([head, body, tail]);
	};
	const header = Buffer.alloc(13);
	header.writeUInt32BE(width, 0);
	header.writeUInt32BE(height, 4);
	header.set([8, 2, 0, 0, 0], 8);
	const row = Buffer.alloc(1 + width * 3);
	for (let x = 0; x < width; x++) row[1 + x * 3 + (Math.floor(x / 10) % 2 === 0 ? 0 : 2)] = 255;
	const file = join(dir, name);
	writeFileSync(
		file,
		Buffer.concat([
			Buffer.from("89504e470d0a1a0a", "hex"),
			chunk("IHDR", header),
			chunk("IDAT", deflateSync(Buffer.concat(Array.from({ length: height }, () => row)))),
			chunk("IEND", Buffer.alloc(0)),
		]),
	);
	return file;
};

const probeRun = (image: string, steps: Step[]): (Layout | Scale)[] => {
	const out = join(dir, `probe-${++runs}.json`);
	const run = spawnSync(helper, [image], {
		env: { ...process.env, DYLD_INSERT_LIBRARIES: probe, QLF_PROBE_OUT: out, QLF_PROBE_STEPS: JSON.stringify(steps) },
		encoding: "utf8",
		timeout: 90_000,
	});
	assert.ok(existsSync(out), `the probe wrote no report (status ${run.status}, signal ${run.signal}): ${run.stderr}`);
	const report = JSON.parse(readFileSync(out, "utf8")) as { results: (Layout | Scale)[]; error?: string };
	assert.equal(report.error, undefined, `the probe stopped early: ${report.error}`);
	return report.results;
};

const layouts = (results: (Layout | Scale)[]) => results.filter((r): r is Layout => r.op === "layout");

const buttonsIn = (layout: Layout, kind: "zoom" | "native") => {
	const item = layout.items.find((i) => i.kind === kind);
	assert.ok(item?.buttons, `the title bar has no ${kind} buttons; it holds ${layout.items.map((i) => i.kind).join(", ")}`);
	return item.buttons;
};
const zoomButtons = (layout: Layout) => buttonsIn(layout, "zoom");
const openButton = (layout: Layout) => buttonsIn(layout, "native").at(-1)!;

const assertApart = (boxes: { name: string; frame: Box }[], left: number, right: number, context: string) => {
	let edge = left;
	for (const { name, frame } of boxes) {
		assert.ok(frame[0] >= edge - 0.5, `${context}: ${name} starts at ${frame[0]}, inside what ends at ${edge}`);
		edge = frame[0] + frame[2];
	}
	assert.ok(edge <= right + 0.5, `${context}: the last control ends at ${edge}, past the edge at ${right}`);
};

// NSLineBreakMode byTruncatingHead, byTruncatingTail and byTruncatingMiddle draw an ellipsis instead of overflowing.
const truncates = new Set([3, 4, 5]);

const assertTidy = (layout: Layout, context: string) => {
	assert.deepEqual(
		layout.items.map((item) => item.kind),
		["close", "fullscreen", "title", "zoom", "native"],
		`${context}: the title bar holds the window buttons, the file name, the zoom pill and then Quick Look's own buttons`,
	);
	assert.equal(layout.openButtons, 1, `${context}: exactly one Open button is on screen`);
	const pill = layout.items.find((item) => item.kind === "zoom")!;
	assert.ok(pill.frame[2] <= pill.fittingWidth + 0.5, `${context}: the zoom pill is ${pill.frame[2]} pt wide, stretched past the ${pill.fittingWidth} pt its buttons need`);
	assertApart(
		layout.items.map((item) => ({ name: item.kind, frame: item.frame })),
		0,
		layout.titleBar[2],
		context,
	);
	for (const item of layout.items) {
		if (!item.buttons) continue;
		const buttons = item.buttons.map((b) => ({ name: b.label || b.title, frame: b.frame })).sort((a, b) => a.frame[0] - b.frame[0]);
		assertApart(buttons, item.frame[0], item.frame[0] + item.frame[2], `${context}, inside ${item.kind}`);
		for (const b of item.buttons) {
			assert.ok(b.fittingWidth <= b.frame[2] + 0.5, `${context}: ${b.label || b.title} needs ${b.fittingWidth} pt and got ${b.frame[2]}`);
		}
	}
	const title = layout.items.find((item) => item.kind === "title")!;
	if (title.fullWidth! > title.frame[2]) {
		assert.ok(truncates.has(title.lineBreakMode!), `${context}: a file name cut to ${title.frame[2]} pt ends in an ellipsis`);
	}
};

test("1. The title bar keeps the file name, zoom pill and Quick Look's buttons apart at every width", { skip }, () => {
	const [opened, dragged, forced] = layouts(
		probeRun(stripes("small.png", 160, 160), [{ op: "layout" }, { op: "drag", width: 1 }, { op: "layout" }, { op: "resize", width: 1 }, { op: "layout" }]),
	);
	assertTidy(opened!, "a small image");
	assert.equal(dragged!.panel[2], dragged!.minSize[0], "a drag to 1 pt stops at the panel's minimum width");
	assertTidy(dragged!, `the minimum width a drag reaches (${dragged!.panel[2]} pt)`);
	assert.ok(forced!.panel[2] < dragged!.panel[2], "setFrame takes the panel below the minimum a drag reaches");
	assertTidy(forced!, `the narrowest frame Auto Layout allows (${forced!.panel[2]} pt)`);

	const [roomy] = layouts(probeRun(stripes("big.png", 2400, 1600), [{ op: "layout" }]));
	assertTidy(roomy!, "a short name in a wide panel, where the title bar has room to spare");

	const longName = "a-diagram-with-a-file-name-much-longer-than-the-title-bar-0123456789.png";
	const [wide, narrow] = layouts(probeRun(stripes(longName, 900, 500), [{ op: "layout" }, { op: "drag", width: 1 }, { op: "layout" }]));
	assertTidy(wide!, "a wide image with a long name");
	assertTidy(narrow!, "a long name at the minimum width");
	const title = narrow!.items.find((item) => item.kind === "title")!;
	assert.equal(title.text, longName, "the title bar shows the file name");
	assert.ok(title.fullWidth! > title.frame[2], "at the minimum width the long name is cut short rather than pushed under the buttons");
	assert.ok(
		openButton(narrow!).title.length < openButton(wide!).title.length,
		`Quick Look shortens Open when the pill leaves too little room ("${openButton(wide!).title}" to "${openButton(narrow!).title}")`,
	);
});

test("2. The zoom buttons are Preview's three zoom buttons, in its order and with its tooltips", { skip }, (t) => {
	if (!existsSync(previewToolbar)) return t.skip("Preview's toolbar definition is not on this Mac");
	const toolbar = JSON.parse(execFileSync("/usr/bin/plutil", ["-convert", "json", "-o", "-", previewToolbar], { encoding: "utf8" }));
	const item = toolbar.items.find((i: { identifier: string }) => i.identifier === "zoom_and_actual");
	const preview = item.segments.map((s: { AXDescription: string; toolTip: string }) => ({ label: s.AXDescription, toolTip: s.toolTip }));
	const [layout] = layouts(probeRun(stripes("tooltips.png", 160, 160), [{ op: "layout" }]));
	assert.deepEqual(
		zoomButtons(layout!).map(({ label, toolTip }) => ({ label, toolTip })),
		preview,
		"the pill has Preview's Zoom Out, Actual Size and Zoom In, with Preview's tooltips",
	);
});

test("3. The zoom buttons zoom like Preview's: out and in step the scale, Actual Size always shows one pixel per point", { skip }, (t) => {
	const near = (scale: number | undefined, want: number) => Math.abs(scale! - want) < 0.08;
	const scales = (results: (Layout | Scale)[]) => {
		const measured = results.filter((r): r is Scale => r.op === "scale");
		if (measured.some((r) => r.error === "screen capture is not allowed")) return null;
		measured.forEach((r, i) => assert.equal(r.error, undefined, `zoom reading ${i + 1} failed: ${r.error}`));
		return measured.map((r) => r.scale!);
	};

	const big = scales(
		probeRun(stripes("big.png", 2400, 1600), [
			{ op: "scale" },
			{ op: "press", label: "Actual Size" },
			{ op: "scale" },
			{ op: "press", label: "Actual Size" },
			{ op: "scale" },
			{ op: "press", label: "Zoom In" },
			{ op: "scale" },
			{ op: "press", label: "Zoom Out" },
			{ op: "scale" },
		]),
	);
	if (!big) return t.skip("the terminal may not record the screen, so the zoom cannot be measured");
	const [fit, actual, again, zoomedIn, zoomedOut] = big;
	assert.ok(fit! < 0.9, `an image larger than the screen opens scaled to fit (${fit})`);
	assert.ok(near(actual, 1), `Actual Size shows one image pixel per point (${actual})`);
	assert.ok(near(again, 1), `a second Actual Size stays at actual size, as in Preview (${again})`);
	assert.ok(zoomedIn! > again! + 0.1, `Zoom In scales up (${again} to ${zoomedIn})`);
	assert.ok(zoomedOut! < zoomedIn! - 0.1, `Zoom Out scales back down (${zoomedIn} to ${zoomedOut})`);

	const [start, inOnce, inTwice, outOnce, reset] = scales(
		probeRun(stripes("small-zoom.png", 160, 160), [
			{ op: "scale" },
			{ op: "press", label: "Zoom In" },
			{ op: "scale" },
			{ op: "press", label: "Zoom In" },
			{ op: "scale" },
			{ op: "press", label: "Zoom Out" },
			{ op: "scale" },
			{ op: "press", label: "Actual Size" },
			{ op: "scale" },
		]),
	)!;
	assert.ok(near(start, 1), `an image smaller than the window opens at actual size (${start})`);
	assert.ok(inOnce! > start! + 0.1 && inTwice! > inOnce! + 0.1, `each Zoom In scales up (${start}, ${inOnce}, ${inTwice})`);
	assert.ok(outOnce! < inTwice! - 0.1, `Zoom Out scales down (${inTwice} to ${outOnce})`);
	assert.ok(near(reset, 1), `Actual Size returns to one pixel per point (${reset})`);
});

test("4. The zoom pill and a tidy title bar survive a trip through fullscreen", { skip }, () => {
	const [windowed, restored] = layouts(
		probeRun(stripes("fullscreen.png", 160, 160), [{ op: "layout" }, { op: "enterFullscreen" }, { op: "exitFullscreen" }, { op: "layout" }]),
	);
	assertTidy(windowed!, "before fullscreen");
	assertTidy(restored!, "after leaving fullscreen");
	assert.deepEqual(restored!.items, windowed!.items, "the title bar is laid out as it was before fullscreen");
});

test("5. Closing the panel ends the helper, however it is closed", { skip }, () => {
	const image = stripes("close.png", 160, 160);
	const ways: [string, Step][] = [
		["panel.close()", { op: "close" }],
		["the close button", { op: "clickClose" }],
		["Esc", { op: "key", key: "escape" }],
		["Space", { op: "key", key: "space" }],
	];
	for (const [way, step] of ways) {
		const out = join(dir, `close-${++runs}.json`);
		const run = spawnSync(helper, [image], {
			env: { ...process.env, DYLD_INSERT_LIBRARIES: probe, QLF_PROBE_OUT: out, QLF_PROBE_STEPS: JSON.stringify([step]) },
			encoding: "utf8",
			timeout: 10_000,
		});
		const report = existsSync(out) ? (JSON.parse(readFileSync(out, "utf8")) as { error?: string }) : {};
		assert.equal(report.error, undefined, `closing with ${way}: the probe stopped early: ${report.error}`);
		assert.equal(run.signal, null, `closing with ${way} leaves the helper running in the background`);
		assert.equal(run.status, 0, `closing with ${way} ends the helper cleanly`);
	}
});
