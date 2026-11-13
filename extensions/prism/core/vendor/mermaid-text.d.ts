export function renderMermaidAscii(
  text: string,
  options?: {
    useAscii?: boolean;
    colorMode?: "none" | "auto" | "truecolor";
    theme?: Record<string, string>;
    paddingX?: number;
    paddingY?: number;
  },
): string;
export function setChartSize(width: number, height: number): void;
