import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pngCopyCommand } from "./core/clipboard.ts";

export type Desktop = {
	/** True when the picture actions reach the Mac the user sits at. False over SSH and off macOS. */
	readonly pictures: boolean;
	/** Puts the PNG on the pasteboard. Returns null on success, else a short reason. Blocks up to 5 s. */
	copyPng(png: Uint8Array): string | null;
	/**
	 * Shows the PNG in Quick Look and returns at once. One panel at a time: the same PNG
	 * while its panel is open does nothing, another PNG replaces the panel.
	 * onFail runs later if Quick Look could not open.
	 */
	previewPng(png: Uint8Array, onFail: (reason: string) => void): void;
};

type SystemDesktopOptions = {
	pictures: boolean;
	osascript?: string;
	qlmanage?: string;
	dir?: string;
};

export function systemDesktop(options: SystemDesktopOptions): Desktop {
	const {
		pictures,
		osascript = "/usr/bin/osascript",
		qlmanage = "/usr/bin/qlmanage",
		dir = join(tmpdir(), "prism-plantuml"),
	} = options;
	let panel: { child: ChildProcess; file: string } | null = null;

	return {
		pictures,
		copyPng: (png) => {
			const command = pngCopyCommand(osascript);
			const [bin, ...args] = command.argv;
			try {
				const res = spawnSync(bin!, args, { input: png, encoding: "utf8", timeout: 5000 });
				if (res.error) return command.failure;
				return res.status === 0 ? null : (res.stderr || "").trim() || command.failure;
			} catch {
				return command.failure;
			}
		},
		previewPng: (png, onFail) => {
			let file: string;
			try {
				file = previewFile(dir, png);
			} catch {
				onFail("Cannot write preview image");
				return;
			}
			if (panel?.file === file) return;
			panel?.child.kill();
			const child = spawn(qlmanage, ["-p", file], { detached: true, stdio: "ignore" });
			const current = { child, file };
			panel = current;
			const closed = () => {
				if (panel === current) panel = null;
			};
			child.once("error", () => {
				closed();
				onFail("Quick Look is unavailable");
			});
			child.once("exit", (code, signal) => {
				closed();
				if (signal === null && code !== 0) onFail("Quick Look failed");
			});
			child.unref();
		},
	};
}

function previewFile(dir: string, png: Uint8Array): string {
	const file = join(dir, `plantuml-${createHash("sha256").update(png).digest("hex").slice(0, 12)}.png`);
	if (existsSync(file)) return file;
	mkdirSync(dir, { recursive: true, mode: 0o700 });
	const temp = `${file}.${process.pid}.tmp`;
	writeFileSync(temp, png);
	renameSync(temp, file);
	return file;
}
