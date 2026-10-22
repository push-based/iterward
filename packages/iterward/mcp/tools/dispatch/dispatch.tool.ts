import { createHandler, flags, type Tool, type ToolSchema } from '../../shared/handler.ts';
import { ANNOTATIONS, COMMON } from '../../shared/schema.ts';

const schema: ToolSchema = {
    name: 'dispatch',
    description:
        "Returns the run's open dispatch: its `id`, `step`, `agent`, `attempt`, `document`, `openedAt`, and `message`, byte for byte as `next` returned it. An agent that got only the run path calls it to read its message, then follows the message. It refuses when no dispatch is open for the run, and changes nothing.",
    inputSchema: { type: 'object', properties: { run: COMMON.run }, required: ['run'], additionalProperties: false },
    annotations: { title: 'Read the open dispatch', ...ANNOTATIONS.read },
};

export const dispatchTool: Tool = { schema, handler: createHandler(schema, (p) => ['dispatch', ...flags(p)]) };
