import { createHandler, flags, type Tool, type ToolSchema } from '../../shared/handler.mts';
import { ANNOTATIONS, COMMON } from '../../shared/schema.mts';

const schema: ToolSchema = {
    name: 'result',
    description:
        "Reads the open dispatch's document and applies the action of its status. An unusable or refused result re-dispatches the agent with the reason, and parks the run past a limit. Returns the next move, as `next` does.",
    inputSchema: { type: 'object', properties: { run: COMMON.run }, required: ['run'], additionalProperties: false },
    annotations: { title: 'Apply a result', ...ANNOTATIONS.write },
};

export const resultTool: Tool = { schema, handler: createHandler(schema, (p) => ['result', ...flags(p)]) };
