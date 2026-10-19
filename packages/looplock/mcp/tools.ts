import type { Tool } from './shared/handler.ts';
import { answerTool } from './tools/decisions/answer.tool.ts';
import { nextTool } from './tools/dispatch/next.tool.ts';
import { resultTool } from './tools/dispatch/result.tool.ts';
import { gateTool } from './tools/gates/gate.tool.ts';
import { newTool } from './tools/run/new.tool.ts';
import { transitionTool } from './tools/run/transition.tool.ts';
import { validateTool } from './tools/run/validate.tool.ts';
import { showTool } from './tools/views/show.tool.ts';

/** One tool per CLI command but `compile`, `dispatch`, and `--version`, in the order of the CLI's usage line. */
export const TOOLS: Tool[] = [newTool, nextTool, resultTool, showTool, validateTool, answerTool, gateTool, transitionTool];

/** The CLI flag of each argument a tool takes. */
const FLAGS = [...new Set(TOOLS.flatMap((t) => Object.keys(t.schema.inputSchema.properties)))].map((k) => [k, `--${k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`]);

/**
 * A refusal as a tool caller reads it: the engine words a refusal for the CLI, so each flag of a tool
 * argument, such as `--note`, becomes the argument's name. A longer name, such as a custom property
 * `--note-x`, stays.
 */
export const asArguments = (text: string) => FLAGS.reduce((t, [k, flag]) => t.replace(new RegExp(`(?<![\\w-])${flag}(?![\\w-])`, 'g'), `\`${k}\``), text);
