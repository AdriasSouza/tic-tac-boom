import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `@react-native-async-storage/async-storage` depende de bindings nativos —
 * mockado como um Map em memória para rodar sob Node puro (mesmo racional de
 * `gameStore.test.ts`: nada aqui precisa de RN de verdade). `vi.hoisted`
 * porque `vi.mock` é hoisted para o topo do arquivo pelo Vitest, antes de
 * qualquer `const` normal — referenciar o Map sem isto quebraria por
 * "acessado antes da inicialização".
 */
const { store } = vi.hoisted(() => ({ store: new Map<string, string>() }));

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: (key: string) => Promise.resolve(store.get(key) ?? null),
    setItem: (key: string, value: string) => {
      store.set(key, value);
      return Promise.resolve();
    },
    removeItem: (key: string) => {
      store.delete(key);
      return Promise.resolve();
    },
  },
}));

import { createTestState } from '@/engine/testHelpers';
import {
  clearMatchSnapshot,
  loadMatchSnapshot,
  saveMatchSnapshot,
  type MatchSnapshot,
} from '@/store/matchPersistence';

const STORAGE_KEY = '@tic-tac-boom/match-snapshot-v1';

beforeEach(() => {
  store.clear();
});

describe('matchPersistence', () => {
  it('round-trip: salva e recarrega um snapshot válido', async () => {
    const gameState = createTestState({ turnCount: 5 });

    await saveMatchSnapshot('cpu', gameState);
    const loaded = await loadMatchSnapshot();

    expect(loaded).not.toBeNull();
    expect(loaded?.mode).toBe('cpu');
    expect(loaded?.gameState).toEqual(gameState);
    expect(loaded?.rng.seed).toBeTypeOf('number');
  });

  it('round-trip: aceita mode "classic" (Modo Clássico)', async () => {
    const gameState = createTestState({ cardsEnabled: false });

    await saveMatchSnapshot('classic', gameState);
    const loaded = await loadMatchSnapshot();

    expect(loaded).not.toBeNull();
    expect(loaded?.mode).toBe('classic');
    expect(loaded?.gameState.cardsEnabled).toBe(false);
  });

  it('devolve null quando não há nada salvo', async () => {
    expect(await loadMatchSnapshot()).toBeNull();
  });

  it('devolve null e não lança para JSON corrompido', async () => {
    store.set(STORAGE_KEY, '{isto não é json válido');
    expect(await loadMatchSnapshot()).toBeNull();
  });

  it('devolve null para um formato antigo/incompatível (faltando campo obrigatório)', async () => {
    store.set(STORAGE_KEY, JSON.stringify({ mode: 'cpu' })); // sem gameState/rng
    expect(await loadMatchSnapshot()).toBeNull();
  });

  it('devolve null e se autolimpa para um snapshot expirado (>7 dias)', async () => {
    const eightDaysAgo = Date.now() - 8 * 24 * 60 * 60 * 1000;
    const stale: MatchSnapshot = {
      mode: 'local',
      gameState: createTestState(),
      rng: { seed: 1, cursors: { RULES: 0, BOARD: 0, CARDS: 0, AI: 0, TERMINAL: 0 } },
      savedAt: eightDaysAgo,
    };
    store.set(STORAGE_KEY, JSON.stringify(stale));

    expect(await loadMatchSnapshot()).toBeNull();
    expect(store.has(STORAGE_KEY)).toBe(false);
  });

  it('clearMatchSnapshot remove o snapshot salvo', async () => {
    await saveMatchSnapshot('local', createTestState());
    await clearMatchSnapshot();
    expect(await loadMatchSnapshot()).toBeNull();
  });
});
