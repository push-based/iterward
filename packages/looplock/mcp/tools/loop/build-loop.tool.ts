import { createHandler, type Tool, type ToolSchema } from '../../shared/handler.ts';
import { ANNOTATIONS } from '../../shared/schema.ts';

const schema: ToolSchema = {
    name: 'build-loop',
    description:
        'Returns the instructions to design a Looplock loop file with the user: an interview that settles one decision at a time, then a loop file and its hooks module that `compile` accepts. Call it before you write or change a `*.loop.json` file, and follow what it returns. The loop file reference and the hooks template follow the instructions, each after a line that names its file.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { title: 'Design a loop', ...ANNOTATIONS.read },
};

export const buildLoopTool: Tool = { schema, handler: createHandler(schema, () => ['build-loop']) };
