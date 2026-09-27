import { createHandler, flags, type Tool, type ToolSchema } from '../../shared/handler.mts';
import { ANNOTATIONS, COMMON } from '../../shared/schema.mts';

const schema: ToolSchema = {
    name: 'validate',
    description:
        "Runs the guard of an artifact on its file in the run folder, the highest-numbered file for a per-attempt artifact. Returns `ok`, or refuses with one error per line, grouped by file and section; a long list goes to a file whose path the refusal names.",
    inputSchema: {
        type: 'object',
        properties: {
            artifact: { type: 'string', description: 'The artifact, from the loop file.' },
            run: COMMON.run,
        },
        required: ['artifact', 'run'],
        additionalProperties: false,
    },
    annotations: { title: 'Check a document', ...ANNOTATIONS.write },
};

export const validateTool: Tool = { schema, handler: createHandler(schema, (p) => ['validate', p.artifact, ...flags(p, ['artifact'])]) };
