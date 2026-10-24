import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { registerHooks } from "node:module";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import type { createBashTool, ExtensionAPI } from "@earendil-works/pi-coding-agent";

const whichPi = execFileSync("which", ["pi"], { encoding: "utf8" }).trim();
const piPkg = realpathSync(resolve(dirname(realpathSync(whichPi)), "../@earendil-works/pi-coding-agent/package.json"));
const parentURL = pathToFileURL(piPkg).href;
registerHooks({
	resolve(specifier, context, nextResolve) {
		if (specifier.startsWith("@earendil-works/")) {
			return nextResolve(specifier, { ...context, parentURL });
		}
		return nextResolve(specifier, context);
	},
});

const {
	default: uvExtension,
	getBlockedCommandMessage,
	interceptedCommandsPath,
} = await import("../extensions/uv.ts");

type BashTool = ReturnType<typeof createBashTool>;

function registerBashTool(): BashTool {
	let registered: BashTool | undefined;
	uvExtension({
		registerTool(tool: BashTool) {
			registered = tool;
		},
	});
	assert.ok(registered, "expected uvExtension to register a bash tool");
	return registered;
}

async function runBash(
	tool: BashTool,
	command: string,
): Promise<{ readonly text: string; readonly isError: boolean }> {
	const result = await tool.execute("call-1", { command });
	const text = result.content
		.filter((part): part is { type: "text"; text: string } => part.type === "text")
		.map((part) => part.text)
		.join("\n");
	return {
		text,
		isError: "isError" in result && result.isError === true,
	};
}

test("getBlockedCommandMessage blocks direct, explicit-path, and chained disallowed Python commands", () => {
	const cases: readonly { readonly command: string; readonly expectedSubstring: string }[] = [
		{ command: "pip install requests", expectedSubstring: "Error: pip is disabled. Use uv instead:" },
		{ command: "/usr/local/bin/pip list", expectedSubstring: "Error: pip is disabled. Use uv instead:" },
		{ command: "echo ok && pip install six", expectedSubstring: "Error: pip is disabled. Use uv instead:" },
		{ command: "pip3 install requests", expectedSubstring: "Error: pip3 is disabled. Use uv instead:" },
		{ command: "true || /opt/homebrew/bin/pip3 freeze", expectedSubstring: "Error: pip3 is disabled. Use uv instead:" },
		{ command: "poetry add pytest", expectedSubstring: "Error: poetry is disabled. Use uv instead:" },
		{ command: "cd app; poetry install", expectedSubstring: "Error: poetry is disabled. Use uv instead:" },
		{ command: "python -m pip install requests", expectedSubstring: "Error: 'python -m pip' is disabled." },
		{ command: ".venv/bin/python -m pip list", expectedSubstring: "Error: 'python -m pip' is disabled." },
		{ command: "python3.12 -mpip install requests", expectedSubstring: "Error: 'python -m pip' is disabled." },
		{ command: "echo hi\npython3 -m pip install flask", expectedSubstring: "Error: 'python -m pip' is disabled." },
		{ command: "python -m venv .venv", expectedSubstring: "Error: 'python -m venv' is disabled." },
		{ command: "/usr/bin/python3.11 -mvenv env", expectedSubstring: "Error: 'python -m venv' is disabled." },
		{
			command: "python -m py_compile script.py",
			expectedSubstring: "Error: 'python -m py_compile' is disabled because it writes .pyc files to __pycache__.",
		},
		{
			command: "ls | .venv/bin/python3 -mpy_compile foo.py",
			expectedSubstring: "Error: 'python -m py_compile' is disabled because it writes .pyc files to __pycache__.",
		},
	];

	for (const { command, expectedSubstring } of cases) {
		const message = getBlockedCommandMessage(command);
		assert.ok(
			message?.includes(expectedSubstring),
			`expected ${JSON.stringify(command)} to be blocked with ${JSON.stringify(expectedSubstring)}, got ${JSON.stringify(message)}`,
		);
	}

	assert.equal(getBlockedCommandMessage("uv run python script.py"), null);
	assert.equal(getBlockedCommandMessage("python script.py"), null);
	assert.equal(getBlockedCommandMessage("uv run python -m ast script.py >/dev/null"), null);
});

test("registered bash tool spawnHook rejects disallowed commands before execution", async () => {
	const bashTool = registerBashTool();

	await assert.rejects(
		() => runBash(bashTool, "pip install requests"),
		/Error: pip is disabled\. Use uv instead:/,
	);
	await assert.rejects(
		() => runBash(bashTool, ".venv/bin/python -m venv .venv"),
		/Error: 'python -m venv' is disabled\. Use uv instead:/,
	);
});

test("PATH shims block indirect disallowed invocations that bypass the spawn regex", async () => {
	const bashTool = registerBashTool();

	const indirectCases: readonly { readonly command: string; readonly pattern: RegExp }[] = [
		{ command: "env $(printf 'p''ip') --version", pattern: /Error: pip is disabled\. Use uv instead:/ },
		{ command: "env $(printf 'p''ip3') --version", pattern: /Error: pip3 is disabled\. Use uv instead:/ },
		{ command: "env $(printf 'poe''try') --version", pattern: /Error: poetry is disabled\. Use uv instead:/ },
		{
			command: "python -m $(printf 'p''ip') --version",
			pattern: /Error: 'python -m pip' is disabled\. Use uv instead:/,
		},
		{
			command: "python3 -m $(printf 've''nv') .venv",
			pattern: /Error: 'python3 -m venv' is disabled\. Use uv instead:/,
		},
		{
			command: "python -m $(printf 'py_''compile') script.py",
			pattern: /Error: 'python -m py_compile' is disabled because it writes \.pyc files to __pycache__\./,
		},
	];

	for (const { command, pattern } of indirectCases) {
		const result = await runBash(bashTool, command);
		assert.equal(result.isError, true, `expected ${command} to fail`);
		assert.match(result.text, pattern);
		assert.match(result.text, /Command exited with code 1/);
	}
});

test("PATH shims forward python and python3 through uv run to a non-shim interpreter", async () => {
	const bashTool = registerBashTool();

	const calcResult = await runBash(bashTool, 'python -c "print(6 * 7)"');
	assert.equal(calcResult.isError, false);
	assert.equal(calcResult.text.trim(), "42");

	const exeResult = await runBash(bashTool, 'python3 -c "import sys; print(sys.executable)"');
	assert.equal(exeResult.isError, false);
	const exeOutput = exeResult.text.trim();
	assert.ok(exeOutput.length > 0, "expected sys.executable output");
	assert.ok(
		!exeOutput.startsWith(interceptedCommandsPath),
		`expected non-shim interpreter path, got ${exeOutput}`,
	);
});
