import { createHandler, flags, type Tool, type ToolSchema } from '../../shared/handler.ts';
import { ANNOTATIONS } from '../../shared/schema.ts';

const schema: ToolSchema = {
    name: 'init',
    description:
        "Copies the default loop of the Looplock package into the repository: the loop file, its hooks, and its agent templates. Refuses a folder that exists. Returns the loop file's path, which `compile` and `new` take as `config`.",
    inputSchema: {
        type: 'object',
        properties: { to: { type: 'string', description: 'The folder to copy to, relative to the repository root the server runs in. Defaults to loops/default.' } },
        additionalProperties: false,
    },
    annotations: { title: 'Copy the default loop', ...ANNOTATIONS.write },
};

export const initTool: Tool = { schema, handler: createHandler(schema, (p) => ['init', ...flags(p)]) };
