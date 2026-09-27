/** The frontmatter `status` of a document, or undefined. The fixture's hooks import it, so its hash covers it. */

import { readFileSync } from 'node:fs';

export const statusOf = (path: string): string | undefined => /^status:\s*(\S+)\s*$/m.exec(readFileSync(path, 'utf8'))?.[1];
