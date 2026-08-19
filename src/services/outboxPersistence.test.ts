import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Mesmo mock de `AsyncStorage` (Map em memória) já usado em
 * `matchPersistence.test.ts` — `vi.hoisted` porque `vi.mock` é hoisted para
 * o topo do arquivo pelo Vitest, antes de qualquer `const` normal.
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

import {
  MAX_OUTBOX_ENTRY_AGE_MS,
  isEntryExpired,
  loadPersistedOutbox,
  savePersistedOutbox,
  type OutboxEntry,
} from './outboxPersistence';

const STORAGE_KEY = '@tic-tac-boom/outbox-v1';

function makeEntry(overrides: Partial<OutboxEntry> = {}): OutboxEntry {
  return {
    roomCode: 'ABCD',
    action: { type: 'END_TURN', by: 'player1', at: 1000 },
    attempts: 0,
    createdAt: Date.now(),
    ...overrides,
  };
}

beforeEach(() => {
  store.clear();
});

describe('isEntryExpired', () => {
  it('entrada recém-criada não está expirada', () => {
    const now = Date.now();
    expect(isEntryExpired({ createdAt: now }, now)).toBe(false);
  });

  it('entrada mais velha que o teto está expirada', () => {
    const now = Date.now();
    expect(isEntryExpired({ createdAt: now - MAX_OUTBOX_ENTRY_AGE_MS - 1 }, now)).toBe(true);
  });

  it('exatamente no teto ainda não conta como expirada (limite exclusivo)', () => {
    const now = Date.now();
    expect(isEntryExpired({ createdAt: now - MAX_OUTBOX_ENTRY_AGE_MS }, now)).toBe(false);
  });
});

describe('savePersistedOutbox / loadPersistedOutbox — round-trip', () => {
  it('salva e recarrega a lista exatamente como foi gravada', async () => {
    const entries = [makeEntry({ roomCode: 'AAAA' }), makeEntry({ roomCode: 'BBBB', attempts: 2 })];
    await savePersistedOutbox(entries);

    const loaded = await loadPersistedOutbox();
    expect(loaded).toEqual(entries);
  });

  it('lista vazia é o padrão quando nunca houve nada salvo', async () => {
    expect(await loadPersistedOutbox()).toEqual([]);
  });

  it('JSON corrompido devolve lista vazia sem lançar', async () => {
    store.set(STORAGE_KEY, '{isto não é json válido');
    await expect(loadPersistedOutbox()).resolves.toEqual([]);
  });

  it('formato antigo/incompatível (não é array) devolve lista vazia', async () => {
    store.set(STORAGE_KEY, JSON.stringify({ notAnArray: true }));
    expect(await loadPersistedOutbox()).toEqual([]);
  });

  it('entrada malformada dentro da lista é descartada, as outras sobrevivem', async () => {
    store.set(
      STORAGE_KEY,
      JSON.stringify([makeEntry({ roomCode: 'GOOD' }), { roomCode: 'BAD' /* sem action/attempts/createdAt */ }]),
    );
    const loaded = await loadPersistedOutbox();
    expect(loaded).toHaveLength(1);
    expect(loaded[0]?.roomCode).toBe('GOOD');
  });
});

describe('loadPersistedOutbox — expiração por idade', () => {
  const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

  afterEach(() => {
    consoleErrorSpy.mockClear();
  });

  it('descarta entradas expiradas e mantém as vivas', async () => {
    const now = Date.now();
    const expired = makeEntry({ roomCode: 'OLD', createdAt: now - MAX_OUTBOX_ENTRY_AGE_MS - 1000 });
    const fresh = makeEntry({ roomCode: 'NEW', createdAt: now });
    await savePersistedOutbox([expired, fresh]);

    const loaded = await loadPersistedOutbox();
    expect(loaded).toEqual([fresh]);
  });

  it('loga (não descarta em silêncio) cada entrada expirada', async () => {
    const now = Date.now();
    await savePersistedOutbox([makeEntry({ roomCode: 'OLD', createdAt: now - MAX_OUTBOX_ENTRY_AGE_MS - 1 })]);

    await loadPersistedOutbox();

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('expirada'),
      'OLD',
      expect.anything(),
      'END_TURN',
      expect.anything(),
      expect.any(Number),
      expect.anything(),
    );
  });
});
