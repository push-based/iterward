import { createHandler, flags, type Tool, type ToolSchema } from '../../shared/handler.ts';
import { ANNOTATIONS, COMMON } from '../../shared/schema.ts';

const schema: ToolSchema = {
    name: 'result',
    description:
        "Runs the guard of the open step's document, which returns its status, and follows the loop's machine. An unusable or refused result, or a refused move, opens the same step again with the lines to fix, and a step opened too many times since the last human move parks the run. Returns `closed`, the dispatch it closed with its outcome, and the next move, as `next` does. Pass the dispatch's `id` from `next`, so a call retried after a timeout refuses instead of closing the next dispatch.",
    inputSchema: {
        type: 'object',
        properties: {
            run: COMMON.run,
            id: { type: 'integer', minimum: 1, description: "The id of the dispatch this call closes, from `next`. The call refuses before any hook runs unless that dispatch is the open one." },
        },
        required: ['run'],
        additionalProperties: false,
    },
    annotations: { title: 'Apply a result', ...ANNOTATIONS.write },
};

export const resultTool: Tool = { schema, handler: createHandler(schema, (p) => ['result', ...flags(p)]) };
