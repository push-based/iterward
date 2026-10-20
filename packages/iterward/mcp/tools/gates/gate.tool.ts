import { createHandler, flags, type Tool, type ToolSchema } from '../../shared/handler.ts';
import { ANNOTATIONS, COMMON } from '../../shared/schema.ts';

const schema: ToolSchema = {
    name: 'gate',
    description:
        "Records the human's approval or rejection of a gate. Call it only with the human's own decision. An approval freezes the gate's files and moves the run on; a rejection needs the human's note and moves the run to the step that revises. Returns the stored note, so the orchestrator quotes what the run holds.",
    inputSchema: {
        type: 'object',
        properties: {
            gate: { type: 'string', description: 'The gate name, from the stop.' },
            run: COMMON.run,
            decision: { type: 'string', enum: ['approved', 'rejected'], description: "The human's decision." },
            note: COMMON.note,
        },
        required: ['gate', 'run', 'decision'],
        additionalProperties: false,
    },
    annotations: { title: 'Record a gate decision', ...ANNOTATIONS.write },
};

export const gateTool: Tool = { schema, handler: createHandler(schema, (p) => ['gate', p.gate, ...flags(p, ['gate'])]) };
