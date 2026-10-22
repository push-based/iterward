import type { Tool } from './shared/handler.ts';
import { answerTool } from './tools/decisions/answer.tool.ts';
import { dispatchTool } from './tools/dispatch/dispatch.tool.ts';
import { nextTool } from './tools/dispatch/next.tool.ts';
import { resultTool } from './tools/dispatch/result.tool.ts';
import { gateTool } from './tools/gates/gate.tool.ts';
import { buildLoopTool } from './tools/loop/build-loop.tool.ts';
import { compileTool } from './tools/loop/compile.tool.ts';
import { initTool } from './tools/loop/init.tool.ts';
import { newTool } from './tools/run/new.tool.ts';
import { transitionTool } from './tools/run/transition.tool.ts';
import { validateTool } from './tools/run/validate.tool.ts';
import { showTool } from './tools/views/show.tool.ts';

/** One tool per CLI command but `mcp` and `--version`, in the order of the CLI's usage line. */
export const TOOLS: Tool[] = [initTool, buildLoopTool, compileTool, newTool, nextTool, resultTool, showTool, dispatchTool, validateTool, answerTool, gateTool, transitionTool];

/**
 * A refusal as a tool caller reads it: the engine words a refusal for the CLI, so each flag of one of the tool's
 * arguments, such as `--note`, becomes the argument's name. A longer name, such as a custom property `--note-x`,
 * stays, and so does text in backticks, such as a command a guard quotes.
 */
export function asArguments(text: string, tool: Tool): string {
    const flags = Object.keys(tool.schema.inputSchema.properties).map((k) => [k, `--${k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`]);
    const named = (part: string) => flags.reduce((t, [k, flag]) => t.replace(new RegExp(`(?<![\\w-])${flag}(?![\\w-])`, 'g'), `\`${k}\``), part);
    return text.split(/(`[^`\n]*`)/).map((part, i) => (i % 2 ? part : named(part))).join('');
}
