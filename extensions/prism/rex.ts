import { execFile } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Where the Rex app that owns pi's pane runs, seen from the machine pi runs on. */
export type RexViewer = "none" | "here" | "elsewhere";

export type Rex = {
	viewer(): Promise<RexViewer>;
	/** Opens a floating pane over pi's pane that draws the PNG file. Resolves null on success, else a short reason. */
	openPane(file: string): Promise<string | null>;
};

type SystemRexOptions = {
	env?: NodeJS.ProcessEnv;
	rex?: string;
	ps?: string;
	node?: string;
	viewerScript?: string;
};

const TIMEOUT_MS = 3000;
const FAILED = "rex failed";

type Json = Record<string, unknown>;

/**
 * Inside Rex the app that holds the user's clipboard may run on another machine, and pi sends a copy
 * through the terminal (OSC 52) only when told to. An explicit PI_CLIPBOARD_OSC52, "0" included, wins.
 */
export function sendCopiesThroughRex(env: NodeJS.ProcessEnv = process.env): void {
	if (env.REX_SESSION && env.PI_CLIPBOARD_OSC52 === undefined) env.PI_CLIPBOARD_OSC52 = "1";
}

export function systemRex(options: SystemRexOptions = {}): Rex {
	const {
		env = process.env,
		rex = "rex",
		ps = "/bin/ps",
		node = process.execPath,
		viewerScript = join(dirname(fileURLToPath(import.meta.url)), "pane-viewer.mjs"),
	} = options;
	const session = env.REX_SESSION;
	const block = env.REX_BLOCK;

	const run = (command: string, args: string[]) =>
		new Promise<string>((resolve, reject) => {
			execFile(command, args, { timeout: TIMEOUT_MS, encoding: "utf8" }, (error, stdout, stderr) => {
				if (!error) return resolve(stdout);
				const missing = (error as NodeJS.ErrnoException).code === "ENOENT";
				reject(new Error(String(stderr).trim().split("\n")[0] || (missing ? `${command} not found` : FAILED)));
			});
		});

	const rexJson = async (args: string[]): Promise<Json> => {
		const value: unknown = JSON.parse(await run(rex, [...args, "--json"]));
		if (typeof value !== "object" || value === null) throw new Error(FAILED);
		return value as Json;
	};

	const inspectBlock = async (): Promise<Json> => {
		const { block: info } = await rexJson(["block", "inspect", "-s", session!, block!]);
		if (typeof info !== "object" || info === null) throw new Error(FAILED);
		return info as Json;
	};

	const isLocalApp = async (owner: string): Promise<boolean> => {
		try {
			const { client } = await rexJson(["client", "inspect", owner]);
			const { principal } = (client ?? {}) as Json;
			const { kind, transport, pid } = (principal ?? {}) as Json;
			if (kind !== "peer" || transport !== "unix" || typeof pid !== "number") return false;
			return (await run(ps, ["-o", "comm=", "-p", String(pid)])).includes(".app/Contents/MacOS/");
		} catch {
			return false;
		}
	};

	return {
		viewer: async () => {
			if (!session || !block) return "none";
			let info: Json;
			try {
				info = await inspectBlock();
			} catch {
				return "none";
			}
			if (typeof info.owner !== "string") return "elsewhere";
			return (await isLocalApp(info.owner)) ? "here" : "elsewhere";
		},
		openPane: async (file) => {
			try {
				const { window_id } = await inspectBlock();
				const layer = {
					window_id,
					bounds: [0.08, 0.06, 0.84, 0.88],
					focus: true,
					layout: {
						block: {
							flavor: "com.superlogical.terminal.shell",
							label: "prism preview",
							options: { command: [node, viewerScript, file] },
						},
					},
				};
				await run(rex, ["api", "call", "-s", session!, "session.new_layer", JSON.stringify(layer)]);
				return null;
			} catch (error) {
				return (error as Error).message;
			}
		},
	};
}
