import { createHandler, flags, type Tool, type ToolSchema } from '../../shared/handler.mts';
import { ANNOTATIONS, COMMON } from '../../shared/schema.mts';

const schema: ToolSchema = {
    name: 'next',
    description:
        "Returns the move the run needs, by its `do` field. For `dispatch`, send `message` to `agent` exactly, then call `result`. For `stop`, show the stop to the human: `moves` lists the human's moves and the effect of each, `warnings` the preflight warnings, `since` the dispatches since the previous stop, and `recorded` the human moves since the latest dispatch.",
    inputSchema: { type: 'object', properties: { run: COMMON.run }, required: ['run'], additionalProperties: false },
    annotations: { title: 'Next move', ...ANNOTATIONS.write },
};

export const nextTool: Tool = { schema, handler: createHandler(schema, (p) => ['next', ...flags(p)]) };
