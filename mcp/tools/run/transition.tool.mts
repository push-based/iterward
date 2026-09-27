import { createHandler, flags, type Tool, type ToolSchema } from '../../shared/handler.mts';
import { ANNOTATIONS, COMMON } from '../../shared/schema.mts';

const schema: ToolSchema = {
    name: 'transition',
    description:
        "Moves the run along one of the human's moves that the stop lists, with the human's note. Call it only with the human's own decision. A move back past a gate drops the gate's freeze.",
    inputSchema: {
        type: 'object',
        properties: {
            run: COMMON.run,
            to: { type: 'string', description: 'The state to move to, from the stop\'s `moves`.' },
            note: COMMON.note,
        },
        required: ['run', 'to', 'note'],
        additionalProperties: false,
    },
    annotations: { title: 'Move the run', ...ANNOTATIONS.write },
};

export const transitionTool: Tool = { schema, handler: createHandler(schema, (p) => ['transition', ...flags(p)]) };
