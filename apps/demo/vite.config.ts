import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
    plugins: [react()],
    resolve: {
        // Consume workspace packages from source so dev doesn't need a
        // rebuild loop per change.
        alias: {
            '@sandwichts/core': r('../../packages/core/src/index.ts'),
            '@sandwichts/react': r('../../packages/react/src/index.ts'),
        },
    },
});
