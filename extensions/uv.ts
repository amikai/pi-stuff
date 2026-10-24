/**
 * Redirects Python tooling (`pip`, `pip3`, `poetry`, `python`, `python3`) in
 * the `bash` tool to `uv` equivalents via a spawn hook and PATH shims.
 *
 * From mitsuhiko/agent-stuff (`extensions/uv.ts`, commit
 * a3f8ab1108a48fec9e175f6cd5d9aaa4694ce29d).
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createBashTool } from "@earendil-works/pi-coding-agent";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

type BlockedCommandRule = {
	readonly pattern: RegExp;
	readonly message: string;
};

export const interceptedCommandsPath = join(dirname(fileURLToPath(import.meta.url)), "..", "intercepted-commands");

const BLOCKED_COMMANDS: readonly BlockedCommandRule[] = [
	{
		pattern: /(?:^|\n|[;|&]{1,2})\s*(?:\S+\/)?pip\s*(?:$|\s)/m,
		message: [
			"Error: pip is disabled. Use uv instead:",
			"",
			"  To install a package for a script: uv run --with PACKAGE python script.py",
			"  To add a dependency to the project: uv add PACKAGE",
			"",
		].join("\n"),
	},
	{
		pattern: /(?:^|\n|[;|&]{1,2})\s*(?:\S+\/)?pip3\s*(?:$|\s)/m,
		message: [
			"Error: pip3 is disabled. Use uv instead:",
			"",
			"  To install a package for a script: uv run --with PACKAGE python script.py",
			"  To add a dependency to the project: uv add PACKAGE",
			"",
		].join("\n"),
	},
	{
		pattern: /(?:^|\n|[;|&]{1,2})\s*(?:\S+\/)?poetry\s*(?:$|\s)/m,
		message: [
			"Error: poetry is disabled. Use uv instead:",
			"",
			"  To initialize a project: uv init",
			"  To add a dependency: uv add PACKAGE",
			"  To sync dependencies: uv sync",
			"  To run commands: uv run COMMAND",
			"",
		].join("\n"),
	},
	{
		pattern: /(?:^|\n|[;|&]{1,2})\s*(?:\S+\/)?python(?:3(?:\.\d+)?)?\b[^\n;|&]*(?:\s-m\s*pip\b|\s-mpip\b)/m,
		message: [
			"Error: 'python -m pip' is disabled. Use uv instead:",
			"",
			"  To install a package for a script: uv run --with PACKAGE python script.py",
			"  To add a dependency to the project: uv add PACKAGE",
			"",
		].join("\n"),
	},
	{
		pattern: /(?:^|\n|[;|&]{1,2})\s*(?:\S+\/)?python(?:3(?:\.\d+)?)?\b[^\n;|&]*(?:\s-m\s*venv\b|\s-mvenv\b)/m,
		message: [
			"Error: 'python -m venv' is disabled. Use uv instead:",
			"",
			"  To create a virtual environment: uv venv",
			"",
		].join("\n"),
	},
	{
		pattern: /(?:^|\n|[;|&]{1,2})\s*(?:\S+\/)?python(?:3(?:\.\d+)?)?\b[^\n;|&]*(?:\s-m\s*py_compile\b|\s-mpy_compile\b)/m,
		message: [
			"Error: 'python -m py_compile' is disabled because it writes .pyc files to __pycache__.",
			"",
			"  To verify syntax without bytecode output: uv run python -m ast path/to/file.py >/dev/null",
			"",
		].join("\n"),
	},
];

export function getBlockedCommandMessage(command: string): string | null {
	for (const rule of BLOCKED_COMMANDS) {
		if (rule.pattern.test(command)) {
			return rule.message;
		}
	}
	return null;
}

export default function uvExtension(pi: Pick<ExtensionAPI, "registerTool">): void {
	const bashTool = createBashTool(process.cwd(), {
		commandPrefix: `export PATH="${interceptedCommandsPath}:$PATH"`,
		spawnHook: (ctx) => {
			const blockedMessage = getBlockedCommandMessage(ctx.command);
			if (blockedMessage) {
				throw new Error(blockedMessage);
			}
			return ctx;
		},
	});

	pi.registerTool(bashTool);
}
