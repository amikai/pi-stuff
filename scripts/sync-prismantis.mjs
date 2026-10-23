#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

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
const themesDir = join(root, "themes");

mkdirSync(coreDir, { recursive: true });
mkdirSync(vendorDir, { recursive: true });
mkdirSync(themesDir, { recursive: true });

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
		);
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
		source: stripped,
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

const { PRESETS, PRESET_BACKGROUNDS, PRESET_NAMES } = await import(pathToFileURL(join(coreDir, "presets.ts")).href);
const { tint } = await import(pathToFileURL(join(coreDir, "render.ts")).href);

function buildPiTheme(name, palette, bg) {
	const isLight = /latte|light|dawn/.test(name);
	const appearance = isLight ? "light" : "dark";
	if (name === "mono") {
		return {
			$schema: "https://pi.dev/schemas/theme.schema.json",
			name: "prismantis-mono",
			appearance: "dark",
			colors: {
				accent: "",
				border: "",
				borderAccent: "",
				borderMuted: "",
				success: "",
				error: "",
				warning: "",
				muted: "",
				dim: "",
				text: "",
				thinkingText: "",
				selectedBg: "",
				scrollbarTrack: "",
				scrollbarThumb: "",
				searchMatchBg: "",
				searchMatchText: "",
				userMessageBg: "",
				userMessageText: "",
				customMessageBg: "",
				customMessageText: "",
				customMessageLabel: "",
				toolPendingBg: "",
				toolSuccessBg: "",
				toolErrorBg: "",
				toolTitle: "",
				toolOutput: "",
				mdHeading: "",
				mdLink: "",
				mdLinkUrl: "",
				mdCode: "",
				mdCodeBlock: "",
				mdCodeBlockBorder: "",
				mdQuote: "",
				mdQuoteBorder: "",
				mdHr: "",
				mdListBullet: "",
				toolDiffAdded: "",
				toolDiffRemoved: "",
				toolDiffContext: "",
				syntaxComment: "",
				syntaxKeyword: "",
				syntaxFunction: "",
				syntaxVariable: "",
				syntaxString: "",
				syntaxNumber: "",
				syntaxType: "",
				syntaxOperator: "",
				syntaxPunctuation: "",
				thinkingOff: "",
				thinkingMinimal: "",
				thinkingLow: "",
				thinkingMedium: "",
				thinkingHigh: "",
				thinkingXhigh: "",
				thinkingMax: "",
				bashMode: "",
			},
		};
	}

	const baseBg = bg ?? (isLight ? "#ffffff" : "#1e1e2e");
	const mix = (color, share) => tint(baseBg, color, share) ?? baseBg;
	const panelShare = isLight ? 0.12 : 0.18;

	return {
		$schema: "https://pi.dev/schemas/theme.schema.json",
		name: `prismantis-${name}`,
		appearance,
		vars: {
			accent: palette.accent,
			heading: palette.heading,
			strong: palette.strong,
			emphasis: palette.emphasis,
			inlineCode: palette.inlineCode,
			codeText: palette.codeText,
			codeCommand: palette.codeCommand,
			codeFlag: palette.codeFlag,
			codeString: palette.codeString,
			codeComment: palette.codeComment,
			link: palette.link,
			path: palette.path,
			number: palette.number,
			quote: palette.quote,
			rule: palette.rule,
			tableHeader: palette.tableHeader,
			tableRule: palette.tableRule,
			bullet: palette.bullet,
			diagram: palette.diagram,
			diagramText: palette.diagramText,
			diffAdded: palette.diffAdded,
			diffRemoved: palette.diffRemoved,
		},
		colors: {
			accent: "accent",
			border: "tableRule",
			borderAccent: "accent",
			borderMuted: "rule",
			success: "diffAdded",
			error: "diffRemoved",
			warning: "tableHeader",
			muted: "quote",
			dim: "codeComment",
			text: "codeText",
			thinkingText: "quote",
			selectedBg: mix(palette.accent, panelShare),
			scrollbarTrack: "rule",
			scrollbarThumb: "quote",
			searchMatchBg: mix(palette.tableHeader, isLight ? 0.25 : 0.28),
			searchMatchText: "codeText",
			userMessageBg: mix(palette.accent, isLight ? 0.1 : 0.14),
			userMessageText: "codeText",
			customMessageBg: mix(palette.diagram, isLight ? 0.1 : 0.14),
			customMessageText: "codeText",
			customMessageLabel: "accent",
			toolPendingBg: mix(palette.quote, isLight ? 0.08 : 0.12),
			toolSuccessBg: mix(palette.diffAdded, isLight ? 0.1 : 0.14),
			toolErrorBg: mix(palette.diffRemoved, isLight ? 0.12 : 0.16),
			toolTitle: "codeText",
			toolOutput: "quote",
			mdHeading: "heading",
			mdLink: "link",
			mdLinkUrl: "codeComment",
			mdCode: "inlineCode",
			mdCodeBlock: "codeText",
			mdCodeBlockBorder: "codeComment",
			mdQuote: "quote",
			mdQuoteBorder: "accent",
			mdHr: "rule",
			mdListBullet: "bullet",
			toolDiffAdded: "diffAdded",
			toolDiffRemoved: "diffRemoved",
			toolDiffContext: "codeComment",
			syntaxComment: "codeComment",
			syntaxKeyword: "codeFlag",
			syntaxFunction: "codeCommand",
			syntaxVariable: "emphasis",
			syntaxString: "codeString",
			syntaxNumber: "number",
			syntaxType: "inlineCode",
			syntaxOperator: "codeFlag",
			syntaxPunctuation: "quote",
			thinkingOff: "rule",
			thinkingMinimal: "codeComment",
			thinkingLow: "link",
			thinkingMedium: "accent",
			thinkingHigh: "emphasis",
			thinkingXhigh: "heading",
			thinkingMax: "codeFlag",
			bashMode: "diffAdded",
		},
		export: {
			pageBg: baseBg,
			cardBg: mix(palette.codeText, isLight ? 0.04 : 0.06),
			infoBg: mix(palette.accent, panelShare),
		},
	};
}

for (const name of PRESET_NAMES) {
	const themeJson = buildPiTheme(name, PRESETS[name], PRESET_BACKGROUNDS[name]);
	writeFileSync(join(themesDir, `prismantis-${name}.json`), `${JSON.stringify(themeJson, null, 2)}\n`);
}

console.log(`Synced ${TS_MODULES.length + TSX_MODULES.length} modules and ${PRESET_NAMES.length} themes from ${upstream}`);
