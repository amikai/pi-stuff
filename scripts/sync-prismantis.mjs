#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const upstream = resolve(process.argv[2] ?? process.env.PRISMANTIS_SRC ?? join(root, "../prismantis"));

if (!existsSync(join(upstream, "hooks/presets.ts"))) {
	console.error(`Upstream prismantis not found at ${upstream}`);
	process.exit(1);
}

const whichPi = execFileSync("which", ["pi"], { encoding: "utf8" }).trim();
const piPkg = realpathSync(resolve(dirname(realpathSync(whichPi)), "../@earendil-works/pi-coding-agent/package.json"));
const req = createRequire(piPkg);
const babelTransform = req(join(dirname(req.resolve("jiti")), "../dist/babel.cjs"));

const coreDir = join(root, "extensions/prismantis/core");
const vendorDir = join(coreDir, "vendor");

mkdirSync(coreDir, { recursive: true });
mkdirSync(vendorDir, { recursive: true });

const TS_MODULES = [
	"charts.ts",
	"clipboard.ts",
	"clock.ts",
	"help.ts",
	"html.ts",
	"latex.ts",
	"markdown.ts",
	"presets.ts",
	"rtl.ts",
	"theme.ts",
];

const TSX_MODULES = ["figure.tsx", "mermaid.tsx", "render.tsx"];

function rewriteImports(code) {
	return code
		.replace(/from\s+['"]claude-code['"]/g, 'from "./jsx.ts"')
		.replace(
			/from\s+['"](\.\/[^'"]+)['"]/g,
			(_match, spec) => {
				if (spec.endsWith(".js") || spec.endsWith(".ts")) return `from "${spec}"`;
				return `from "${spec}.ts"`;
			},
		)
		.replace(/\n*> \[!CAUTION\]\n> Claude Code refuses trees over 20000 nodes\.[^\n]*\n*/g, "\n\n")
		.replace(/const NUMBER_MAX = 400\b/g, "const NUMBER_MAX = Infinity")
		.replace(/const DIFF_MAX = 400\b/g, "const DIFF_MAX = Infinity")
		.replace(/const DIFF_EXTRA = 5000\b/g, "const DIFF_EXTRA = Infinity");
}

for (const file of TS_MODULES) {
	const src = readFileSync(join(upstream, "hooks", file), "utf8");
	writeFileSync(join(coreDir, file), rewriteImports(src));
}

for (const file of TSX_MODULES) {
	const src = readFileSync(join(upstream, "hooks", file), "utf8");
	const imports = [];
	const typeExports = [];
	const valueExports = [];
	const stripped = src
		.replace(/^import\s+[^\n]+\n/gm, (line) => {
			imports.push(rewriteImports(line.trim()));
			return "\n";
		})
		.replace(/^export\s+type\s+([^\n]+)\n/gm, (_line, rest) => {
			typeExports.push(`export type ${rest}`);
			return `type ${rest}\n`;
		})
		.replace(/^export\s+const\s+(\w+)/gm, (_line, name) => {
			valueExports.push(name);
			return `const ${name}`;
		});
	const transformed = babelTransform({
		source: rewriteImports(stripped),
		filename: file,
		ts: true,
		jsx: { pragma: "h", pragmaFrag: "Fragment" },
	});
	if (transformed.error) {
		throw transformed.error;
	}
	const outName = file.replace(/\.tsx$/, ".ts");
	const body = transformed.code.replace(/^"use strict";\s*/, "");
	const out = [
		'import { Fragment, h } from "./jsx.ts";',
		...imports,
		...typeExports,
		body,
		`export { ${valueExports.join(", ")} };`,
		"",
	].join("\n");
	writeFileSync(join(coreDir, outName), out);
}

copyFileSync(join(upstream, "hooks/vendor/mermaid-text.js"), join(vendorDir, "mermaid-text.js"));
copyFileSync(join(upstream, "hooks/vendor/prism.js"), join(vendorDir, "prism.js"));
copyFileSync(join(upstream, "docs/THIRD_PARTY_NOTICES.md"), join(root, "extensions/prismantis/THIRD_PARTY_NOTICES.md"));

console.log(`Synced ${TS_MODULES.length + TSX_MODULES.length} modules from ${upstream}`);
