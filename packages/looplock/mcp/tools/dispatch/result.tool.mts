import { createHandler, flags, type Tool, type ToolSchema } from '../../shared/handler.mts';
import { ANNOTATIONS, COMMON } from '../../shared/schema.mts';

const schema: ToolSchema = {
    name: 'result',
    description:
        "Runs the guard of the open step's document, which returns its status, and follows the loop's machine. An unusable or refused result, or a refused move, opens the same step again with the lines to fix, and a step opened too many times since the last human move parks the run. Returns the next move, as `next` does.",
    inputSchema: { type: 'object', properties: { run: COMMON.run }, required: ['run'], additionalProperties: false },
    annotations: { title: 'Apply a result', ...ANNOTATIONS.write },
};

export const resultTool: Tool = { schema, handler: createHandler(schema, (p) => ['result', ...flags(p)]) };
