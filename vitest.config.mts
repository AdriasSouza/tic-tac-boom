import path from 'node:path';
import { defineConfig } from 'vitest/config';

/**
 * Runner mínimo para `src/engine/` e `src/store/gameStore.ts` — nenhum dos
 * dois importa React/React Native (ver os comentários de topo desses
 * arquivos), então não precisam de jsdom nem do preset `babel-preset-expo`
 * (esse é só para o app RN). Só o alias `@/*` precisa ser resolvido, o mesmo
 * mapeamento de `tsconfig.json`.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
    },
  },
  test: {
    include: ['src/**/*.test.ts'],
  },
});
