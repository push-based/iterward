import { createHandler, flags, type Tool, type ToolSchema } from '../../shared/handler.ts';
import { ANNOTATIONS, COMMON } from '../../shared/schema.ts';

const schema: ToolSchema = {
    name: 'next',
    description:
        "Returns the move the run needs, by its `do` field. For `dispatch`, send `message` to `agent` exactly, then call `result`. For `stop`, tell the human what the stop means in your own words. Every field is data: `moves` lists the human's moves, each with the call that records it and what the call changes, `warnings` the preflight warnings, `since` the dispatches since the last human move, and `recorded` the human moves since the latest dispatch.",
    inputSchema: { type: 'object', properties: { run: COMMON.run }, required: ['run'], additionalProperties: false },
    annotations: { title: 'Next move', ...ANNOTATIONS.write },
};

export const nextTool: Tool = { schema, handler: createHandler(schema, (p) => ['next', ...flags(p)]) };
