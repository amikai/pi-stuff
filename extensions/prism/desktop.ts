import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { pngCopyCommand } from "./core/clipboard.ts";
import { type Rex, systemRex } from "./rex.ts";

type Report = (text: string, level: "info" | "warning" | "error") => void;

export type Desktop = {
	/** True when the picture actions reach the Mac the user sits at. False over SSH and off macOS. */
	readonly pictures: boolean;
	/** Resolves null when a copy to this machine's pasteboard reaches the user, else a short reason. */
	pasteboard(): Promise<string | null>;
	/** Puts the PNG on the pasteboard. Resolves null on success, else a short reason. Takes up to 5 s. */
	copyPng(png: Uint8Array): Promise<string | null>;
	/**
	 * Shows the PNG and returns at once. Every call opens its own panel: a Rex floating pane when the
	 * Rex app that owns pi's pane runs on another machine, else Quick Look. Notices and later failures go to report.
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
	rex?: Rex;
};

const REX_AWAY = "the Rex app is on another machine";
const BUILDING = "Building the Quick Look helper (first use, about 10 s)";

export function systemDesktop(options: SystemDesktopOptions): Desktop {
	const {
		pictures,
		osascript = "/usr/bin/osascript",
		qlmanage = "/usr/bin/qlmanage",
		swiftc = "/usr/bin/swiftc",
		helperSource = join(dirname(fileURLToPath(import.meta.url)), "quicklook.swift"),
		helperDir = join(getAgentDir(), "prism"),
		dir = join(tmpdir(), "prism-preview"),
		rex = systemRex(),
	} = options;
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
		const [command, args] = bin === null ? [qlmanage, ["-p", file]] : [bin, [file]];
		const child = spawn(command, args, { detached: true, stdio: "ignore" });
		child.once("error", () => report("Quick Look is unavailable", "error"));
		child.once("exit", (code, signal) => {
			if (signal === null && code !== 0) report("Quick Look failed", "error");
		});
		child.unref();
	};

	const pasteboard = async () => ((await rex.viewer()) === "elsewhere" ? REX_AWAY : null);

	return {
		pictures,
		pasteboard,
		copyPng: async (png) => {
			const away = await pasteboard();
			if (away !== null) return `${away}, use preview`;
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
			rex
				.viewer()
				.then(async (viewer) => {
					if (viewer !== "elsewhere") return open(file, await quickLookHelper(report), report);
					const reason = await rex.openPane(file);
					if (reason !== null) report(`Rex preview failed (${reason})`, "error");
				})
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
	const file = join(dir, `diagram-${sha12(png)}.png`);
	if (existsSync(file)) return file;
	mkdirSync(dir, { recursive: true, mode: 0o700 });
	const temp = `${file}.${process.pid}.tmp`;
	writeFileSync(temp, png);
	renameSync(temp, file);
	return file;
}
