// pi-illustrate limits a raster to these bounds and lets the terminal scale a picture beyond them. A picture's pixel count grows with the square of its width, so a tall diagram drawn at the terminal's width is the case this limits.
export const BUDGET = { pixels: 8_000_000, side: 8192 }

// A picture drawn with no width is this many times the diagram's own size, and no budget draws a diagram narrower.
export const ZOOM = 2

// The widest PNG, for a diagram of this natural size, that keeps to BUDGET.
export const allowedWidth = (width, height) =>
  Math.floor(width * Math.min(BUDGET.side / width, BUDGET.side / height, Math.sqrt(BUDGET.pixels / (width * height))))

// The PNG width to draw a diagram of this natural size at, when `requested` pixels are asked for, and whether BUDGET cut it. It is never wider than asked for and never below ZOOM times the diagram's width.
export const widthFor = (requested, width, height) => {
  const drawn = Math.min(requested, Math.max(allowedWidth(width, height), ZOOM * width))
  return { width: drawn, limited: drawn < requested }
}
