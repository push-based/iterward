// @ts-check

import { themes as prismThemes } from 'prism-react-renderer';

const repository = 'https://github.com/push-based/iterward';

/** @type {import('@docusaurus/types').Config} */
export default {
    title: 'Iterward',
    tagline: 'LLMs do the work. Iterward decides what happens next.',
    url: 'https://push-based.github.io',
    baseUrl: '/iterward/',
    // GitHub Pages serves docs/cli.html at /docs/cli, with no redirect to a trailing slash.
    trailingSlash: false,
    onBrokenLinks: 'throw',
    onBrokenAnchors: 'throw',
    // The logos live in the repository's assets folder, which the READMEs also use.
    staticDirectories: ['../assets'],
    markdown: {
        // The pages are the package's own Markdown files, which GitHub and npm also render,
        // so parse each .md file as CommonMark, not as MDX.
        format: 'detect',
        mermaid: true,
        hooks: { onBrokenMarkdownLinks: 'throw' },
        // The package README opens with a logo, not a Markdown heading, and can't carry front matter.
        parseFrontMatter: async (params) => {
            const result = await params.defaultParseFrontMatter(params);
            if (params.filePath.endsWith('packages/iterward/README.md')) {
                Object.assign(result.frontMatter, { title: 'Introduction', hide_title: true });
            }
            return result;
        },
    },
    themes: ['@docusaurus/theme-mermaid'],
    // Geist and Geist Mono are the typefaces of the PushBased design system.
    stylesheets: ['https://fonts.googleapis.com/css2?family=Geist:wght@100..900&family=Geist+Mono:wght@100..900&display=swap'],
    presets: [
        [
            'classic',
            /** @type {import('@docusaurus/preset-classic').Options} */
            ({
                docs: {
                    // The site has no pages of its own: it renders the files the package ships.
                    path: '../packages/iterward',
                    include: ['README.md', 'docs/*.md', 'examples/default/**/README.md'],
                    routeBasePath: '/',
                    sidebarPath: './sidebars.js',
                    editUrl: ({ docPath }) => `${repository}/edit/main/packages/iterward/${docPath}`,
                },
                blog: false,
                theme: { customCss: './src/css/custom.css' },
            }),
        ],
    ],
    themeConfig: {
        // The README picks its logo and diagram by the system color scheme, so the site follows it too.
        // A manual switch of the site's color mode leaves those two images in the system's scheme.
        colorMode: { respectPrefersColorScheme: true },
        // Without this, Docusaurus highlights code with a dark theme in both color modes.
        prism: { theme: prismThemes.github, darkTheme: prismThemes.dracula },
        navbar: {
            logo: { alt: 'Iterward', src: 'iterward-logo.png', srcDark: 'iterward-logo-dark.png' },
            items: [
                { href: 'https://www.npmjs.com/package/@push-based/iterward', label: 'npm', position: 'right' },
                { href: repository, label: 'GitHub', position: 'right' },
            ],
        },
    },
};
