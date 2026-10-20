import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';

export default defineConfig(
    { ignores: ['dist/'] },
    js.configs.recommended,
    tseslint.configs.recommended,
    {
        rules: {
            // The engine reads loop, run, and hook JSON as `any` on purpose, and strict tsc checks the rest.
            '@typescript-eslint/no-explicit-any': 'off',
            // `catch {}` marks a failure that the code ignores on purpose, such as unparsable JSON.
            'no-empty': ['error', { allowEmptyCatch: true }],
            // `const { drops: _, ...edge } = x` drops a key, so the dropped name stays unused.
            '@typescript-eslint/no-unused-vars': ['error', { ignoreRestSiblings: true }],
        },
    },
);
