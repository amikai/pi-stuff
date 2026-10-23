import type { TUI, TuiMouseEventResult } from "@earendil-works/pi-tui";

export type HoverOwner = { repaintHover(): void };

// One hover for the whole screen, so moving onto another element clears the previous one.
let hovered: { owner: HoverOwner; key: unknown } | null = null;
let moveClaimed = false;
const watched = new WeakSet<TUI>();

function setHovered(next: { owner: HoverOwner; key: unknown } | null): boolean {
	if (hovered?.owner === next?.owner && hovered?.key === next?.key) return false;
	hovered?.owner.repaintHover();
	next?.owner.repaintHover();
	hovered = next;
	return true;
}

/**
 * Call from a component's handleMouse for a `move` event with the key of the
 * element under the pointer, or undefined over none. The result is the one to
 * return from handleMouse: pi-tui drops one that is not `handled`, render flag included.
 */
export function pointerMoved(owner: HoverOwner, key: unknown): TuiMouseEventResult | undefined {
	moveClaimed = true;
	return setHovered(key === undefined ? null : { owner, key }) ? { handled: true, render: true } : undefined;
}

/** The key of the element under the pointer in `owner`, for use while it renders. */
export function hoveredKey(owner: HoverOwner): unknown {
	return hovered?.owner === owner ? hovered.key : undefined;
}

/** Clears the hover and reports whether a repaint is due. */
export function clearHover(): boolean {
	return setHovered(null);
}

/**
 * Call once the TUI has dispatched a pointer move. A move that reached no
 * owner means the pointer left them, which pi never reports.
 */
export function settlePointerMove(): boolean {
	if (moveClaimed) {
		moveClaimed = false;
		return false;
	}
	return clearHover();
}

/**
 * pi sends no event when the pointer leaves a component, and TuiAltScreen's own input listener consumes
 * mouse reports before extension listeners run, so onTerminalInput never sees them. Wrap the dispatcher instead.
 */
export function watchPointerLeave(tui: TUI): void {
	if (watched.has(tui)) return;
	const target = tui as unknown as { handleMouseEvent?: (raw: { button: number }) => void };
	const dispatch = target.handleMouseEvent;
	if (typeof dispatch !== "function") return;
	watched.add(tui);
	target.handleMouseEvent = function (this: unknown, raw) {
		dispatch.call(this, raw);
		if ((raw.button & 32) !== 0 && settlePointerMove()) tui.requestRender();
	};
}
