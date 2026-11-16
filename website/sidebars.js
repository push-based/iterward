// @ts-check

/**
 * The pages grouped by their Diátaxis type. Explanation has no group of its own: it lives in the introduction.
 *
 * @type {import('@docusaurus/plugin-content-docs').SidebarsConfig}
 */
export default {
    docs: [
        'README',
        { type: 'category', label: 'Tutorial', collapsed: false, items: ['docs/tutorial'] },
        {
            type: 'category',
            label: 'How-to guides',
            collapsed: false,
            items: ['docs/create-a-loop', 'docs/testing', 'docs/mcp-setup', 'docs/background-agents'],
        },
        {
            type: 'category',
            label: 'Reference',
            collapsed: false,
            items: [
                'docs/configuration',
                'docs/cli',
                'docs/mcp',
                'docs/protocol',
                'docs/run-format',
                {
                    type: 'category',
                    label: 'The default loop',
                    link: { type: 'doc', id: 'examples/default/README' },
                    items: ['examples/default/agents/README'],
                },
            ],
        },
    ],
};
