import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { pngCopyCommand } from "./core/clipboard.ts";

type Report = (text: string, level: "info" | "warning" | "error") => void;

export type Desktop = {
	/** True when the picture actions reach the Mac the user sits at. False over SSH and off macOS. */
	readonly pictures: boolean;
	/** Puts the PNG on the pasteboard. Returns null on success, else a short reason. Blocks up to 5 s. */
	copyPng(png: Uint8Array): string | null;
	/**
	 * Shows the PNG in Quick Look and returns at once. One panel at a time: the same PNG
	 * while its panel is open does nothing, another PNG replaces the panel.
	 * Notices and later failures go to report.
	 */
	previewPng(png: Uint8Array, report: Report): void;
};

type SystemDesktopOptions = {
	pictures: boolean;
	osascript?: string;
	qlmanage?: string;
	swiftc?: string;
	helperSource?: string;
	helperDir?: string;
	dir?: string;
};

const BUILDING = "Building the Quick Look helper (first use, about 10 s)";

export function systemDesktop(options: SystemDesktopOptions): Desktop {
	const {
		pictures,
		osascript = "/usr/bin/osascript",
		qlmanage = "/usr/bin/qlmanage",
		swiftc = "/usr/bin/swiftc",
		helperSource = join(dirname(fileURLToPath(import.meta.url)), "quicklook.swift"),
		helperDir = join(getAgentDir(), "prism"),
		dir = join(tmpdir(), "prism-plantuml"),
	} = options;
	let panel: { child: ChildProcess; file: string } | null = null;
	let helper: Promise<string | null> | null = null;
	let building = false;

	const readyHelper = async (): Promise<string> => {
		const bin = join(helperDir, `quicklook-${sha12(readFileSync(helperSource))}`);
		if (existsSync(bin)) return bin;
		building = true;
		try {
			await compile(swiftc, helperSource, bin);
		} finally {
			building = false;
		}
		return bin;
	};

	const quickLookHelper = (report: Report): Promise<string | null> => {
		helper ??= readyHelper().catch((error: Error) => {
			report(`Quick Look helper could not be built (${error.message}), using qlmanage`, "warning");
			return null;
		});
		if (building) report(BUILDING, "info");
		return helper;
	};

	const open = (file: string, bin: string | null, report: Report) => {
		if (panel?.file === file) return;
		panel?.child.kill();
		const [command, args] = bin === null ? [qlmanage, ["-p", file]] : [bin, [file]];
		const child = spawn(command, args, { detached: true, stdio: "ignore" });
		const current = { child, file };
		panel = current;
		const closed = () => {
			if (panel === current) panel = null;
		};
		child.once("error", () => {
			closed();
			report("Quick Look is unavailable", "error");
		});
		child.once("exit", (code, signal) => {
			closed();
			if (signal === null && code !== 0) report("Quick Look failed", "error");
		});
		child.unref();
	};

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
		previewPng: (png, report) => {
			let file: string;
			try {
				file = previewFile(dir, png);
			} catch {
				report("Cannot write preview image", "error");
				return;
			}
			if (panel?.file === file) return;
			quickLookHelper(report)
				.then((bin) => open(file, bin, report))
				.catch(() => report("Quick Look is unavailable", "error"));
		},
	};
}

function sha12(bytes: Uint8Array): string {
	return createHash("sha256").update(bytes).digest("hex").slice(0, 12);
}

function compile(swiftc: string, source: string, bin: string): Promise<void> {
	return new Promise((resolve, reject) => {
		mkdirSync(dirname(bin), { recursive: true, mode: 0o700 });
		const temp = `${bin}.${process.pid}.tmp`;
		const child = spawn(swiftc, ["-O", source, "-o", temp], { stdio: ["ignore", "ignore", "pipe"] });
		let stderr = "";
		child.stderr.on("data", (chunk) => (stderr += chunk));
		child.once("error", (error: NodeJS.ErrnoException) => {
			reject(new Error(error.code === "ENOENT" ? "swiftc not found" : error.message));
		});
		child.once("close", (code) => {
			try {
				if (code !== 0) throw new Error(stderr.trim().split("\n")[0] || `swiftc exited with ${code}`);
				renameSync(temp, bin);
				resolve();
			} catch (error) {
				rmSync(temp, { force: true });
				reject(error);
			}
		});
	});
}

function previewFile(dir: string, png: Uint8Array): string {
	const file = join(dir, `plantuml-${sha12(png)}.png`);
	if (existsSync(file)) return file;
	mkdirSync(dir, { recursive: true, mode: 0o700 });
	const temp = `${file}.${process.pid}.tmp`;
	writeFileSync(temp, png);
	renameSync(temp, file);
	return file;
}
