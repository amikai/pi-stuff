export type TextHoverProps = {
	scope?: string;
	color?: string;
	backgroundColor?: string;
	inverse?: boolean;
};

export type RenderElement = {
	type: string;
	props: Record<string, unknown>;
	children: RenderNode[];
};

export type RenderNode = RenderElement | string | number | boolean | null | undefined | RenderNode[];

export type PluginOptions = Record<string, unknown>;

export type ElementComponent = string;

export type ElementTable = {
	Box: ElementComponent;
	Text: ElementComponent;
	Button: ElementComponent;
	Link: ElementComponent;
	Image?: ElementComponent;
};

export const EL: ElementTable = {
	Box: "Box",
	Text: "Text",
	Button: "Button",
	Link: "Link",
	Image: "Image",
};

export const Fragment = "Fragment";

function flattenChildren(children: RenderNode[], out: RenderNode[] = []): RenderNode[] {
	for (const child of children) {
		if (Array.isArray(child)) {
			flattenChildren(child, out);
		} else if (child !== null && child !== undefined && child !== false && child !== true) {
			out.push(child);
		}
	}
	return out;
}

export function h(type: string, props: Record<string, unknown> | null, ...children: RenderNode[]): RenderElement {
	return {
		type,
		props: props ?? {},
		children: flattenChildren(children),
	};
}
