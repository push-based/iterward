import { createHandler, flags, type Tool, type ToolSchema } from '../../shared/handler.mts';
import { ANNOTATIONS, COMMON } from '../../shared/schema.mts';

const schema: ToolSchema = {
    name: 'answer',
    description:
        "Records the human's answer to a pending question: the loop writes it into the question file, the question resolves, and its file freezes. Call it only with the human's own answer. Returns the chosen key and the questions still pending.",
    inputSchema: {
        type: 'object',
        properties: {
            run: COMMON.run,
            id: { type: 'string', description: 'The question ID, such as RFC-7.' },
            option: { type: 'string', description: 'The key of the option the human chose, or `custom` when no option fits.' },
            answer: { type: 'string', description: "The human's words, stored as given." },
        },
        required: ['run', 'id', 'option', 'answer'],
        additionalProperties: false,
    },
    annotations: { title: 'Record an answer', ...ANNOTATIONS.write },
};

export const answerTool: Tool = { schema, handler: createHandler(schema, (p) => ['answer', ...flags(p)]) };
