/** A stored question, as the human sees it. */
export const questionView = ({ id, topic, question, options, recommendation, supersedes }: any) => ({ id, topic, question, options, recommendation, ...(supersedes ? { supersedes } : {}) });
