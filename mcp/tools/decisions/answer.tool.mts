import { createHandler, flags, type Tool, type ToolSchema } from '../../shared/handler.mts';
import { ANNOTATIONS, COMMON } from '../../shared/schema.mts';

const schema: ToolSchema = {
    name: 'answer',
    description:
        "Records the human's answers to pending questions, all of them or none: for each answer, the loop writes it into the question file, the question resolves, and its file freezes. Send every answer of one human message in one call, so the client asks the human to allow it once. Call it only with the human's own answers. Returns each answered question with its chosen key, and the questions still pending.",
    inputSchema: {
        type: 'object',
        properties: {
            run: COMMON.run,
            answers: {
                type: 'array',
                description: 'One entry for each question the human answered, at least 1.',
                items: {
                    type: 'object',
                    properties: {
                        id: { type: 'string', description: 'The question ID, such as RFC-7.' },
                        option: { type: 'string', description: 'The key of the option the human chose, or `custom` when no option fits.' },
                        answer: { type: 'string', description: "The human's words for this question, stored as given." },
                    },
                    required: ['id', 'option', 'answer'],
                    additionalProperties: false,
                },
            },
        },
        required: ['run', 'answers'],
        additionalProperties: false,
    },
    annotations: { title: 'Record answers', ...ANNOTATIONS.write },
};

// The answers go to the CLI as one JSON array, so each entry keeps its fields.
export const answerTool: Tool = { schema, handler: createHandler(schema, (p) => ['answer', ...flags(p, ['answers']), '--answers', JSON.stringify(p.answers)]) };
