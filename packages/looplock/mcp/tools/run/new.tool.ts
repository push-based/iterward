import { createHandler, flags, type Tool, type ToolSchema } from '../../shared/handler.ts';
import { ANNOTATIONS, COMMON } from '../../shared/schema.ts';

const schema: ToolSchema = {
    name: 'new',
    description:
        "Starts a run of a loop file. Runs the loop's preflight first, and refuses its errors, a run file that exists, and a run folder that holds other files. Returns the run's status and the preflight warnings.",
    inputSchema: {
        type: 'object',
        properties: {
            config: COMMON.config,
            run: COMMON.run,
            inputs: { type: 'object', additionalProperties: { type: 'string' }, description: 'The loop inputs, such as {"subject": "the settings page"}.' },
        },
        required: ['config', 'run'],
        additionalProperties: false,
    },
    annotations: { title: 'Start a run', ...ANNOTATIONS.write, openWorldHint: true },
};

// The inputs go first, so `config` and `run` win over an input of the same name.
const argv = (p: Record<string, any>) => ['new', ...Object.entries(p.inputs ?? {}).flatMap(([k, v]) => [`--${k}`, String(v)]), ...flags(p, ['inputs'])];

export const newTool: Tool = { schema, handler: createHandler(schema, argv) };
