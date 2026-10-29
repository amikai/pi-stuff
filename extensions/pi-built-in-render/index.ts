import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { makeDocument } from "./catalog.ts";
import { BuiltInDocumentComponent, decodeDocument, ENTRY_TYPE } from "./render.ts";

export { SECTIONS, makeDocument, type SectionSpec } from "./catalog.ts";
export { diagramCodeSpan, transformBuiltInMermaid } from "./mermaid.ts";
export {
	BuiltInDocumentComponent,
	ENTRY_TYPE,
	decodeDocument,
	type DecodedDocument,
	type DemoDocument,
	type SectionBlock,
} from "./render.ts";

export default function piBuiltInRenderExtension(pi: ExtensionAPI): void {
	pi.registerEntryRenderer<unknown>(ENTRY_TYPE, (entry, _options, theme) => {
		const decoded = decodeDocument(entry.data);
		return decoded.kind === "valid"
			? new BuiltInDocumentComponent(decoded.document, theme)
			: new Text(decoded.explanation, 1, 0);
	});
	pi.registerMessageRenderer<unknown>(ENTRY_TYPE, (message, options, theme) => {
		const decoded = decodeDocument(message.details);
		return decoded.kind === "valid"
			? new BuiltInDocumentComponent(decoded.document, theme, options.outputPad)
			: new Text(decoded.explanation, options.outputPad, 0);
	});
	pi.on("context", (event) => ({
		messages: event.messages.filter((message) => message.role !== "custom" || message.customType !== ENTRY_TYPE),
	}));
	pi.registerCommand("pi-built-in-render", {
		description: "Demonstrate Pi's stock Markdown, math, Mermaid, diff, and image renderers",
		handler: async (args, ctx) => {
			if (args.trim()) {
				ctx.ui.notify("/pi-built-in-render takes no arguments.", "warning");
				return;
			}
			if (ctx.mode !== "tui") {
				ctx.ui.notify("Built-in rendering requires interactive terminal mode.", "warning");
				return;
			}
			pi.appendEntry(ENTRY_TYPE, makeDocument());
		},
	});
}
