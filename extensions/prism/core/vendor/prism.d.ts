export type Grammar = Record<string, unknown>;
export type Token = { type: string; content: string | Token | (string | Token)[]; alias?: string | string[] };
export const languages: Record<string, Grammar | null | undefined>;
export function tokenize(text: string, grammar: Grammar): (string | Token)[];
