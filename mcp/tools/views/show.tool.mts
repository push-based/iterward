import { createHandler, flags, type Tool, type ToolSchema } from '../../shared/handler.mts';
import { ANNOTATIONS, COMMON } from '../../shared/schema.mts';

const schema: ToolSchema = {
    name: 'show',
    description: "Returns the run's state: its status, gate decisions, questions, frozen files, preflight warnings, how many times the current step opened since the last human move, and open dispatch.",
    inputSchema: { type: 'object', properties: { run: COMMON.run }, required: ['run'], additionalProperties: false },
    annotations: { title: 'Show the run', ...ANNOTATIONS.read },
};

export const showTool: Tool = { schema, handler: createHandler(schema, (p) => ['show', ...flags(p)]) };
