/** The option key: the leading capital letter of "A. …", "A — …", or "A) …". */
export const optionKey = (text: unknown): string | undefined => /^\s*([A-Z])\b/.exec(String(text))?.[1];
