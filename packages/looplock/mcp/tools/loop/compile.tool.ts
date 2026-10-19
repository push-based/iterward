import { createHandler, flags, type Tool, type ToolSchema } from '../../shared/handler.ts';
import { ANNOTATIONS, COMMON } from '../../shared/schema.ts';

const schema: ToolSchema = {
    name: 'compile',
    description:
        "Compiles a loop file, and returns it with each step's outcomes resolved to their targets and each hook as its `\"<file>#<export>\"`. Refuses a loop file the engine can't run, with one line for each problem. It imports the hook modules and calls no hook.",
    inputSchema: { type: 'object', properties: { config: COMMON.config }, required: ['config'], additionalProperties: false },
    annotations: { title: 'Compile a loop file', ...ANNOTATIONS.read },
};

export const compileTool: Tool = { schema, handler: createHandler(schema, (p) => ['compile', ...flags(p)]) };
