import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
    resolve: {
        alias: {
            '@sandwichts/core': r('./packages/core/src/index.ts'),
            '@sandwichts/react': r('./packages/react/src/index.ts'),
            '@sandwichts/server': r('./packages/server/src/index.ts'),
        },
    },
    test: {
        include: ['specs/**/tests/**/*.test.{ts,tsx}'],
        environment: 'node',
    },
});
