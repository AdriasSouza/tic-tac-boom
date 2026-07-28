/**
 * Gerador pseudoaleatório determinístico (Mulberry32).
 *
 * Por que não `Math.random()`:
 * - **Replay / compartilhar partida:** com a seed, a mesma sequência de
 *   jogadas produz exatamente a mesma partida. Sem isso não existe replay.
 * - **Testes:** casos de borda de cartas caóticas viram flaky sem seed fixa.
 * - **Multiplayer:** ambos os lados simulam o mesmo caos sem trocar pacote a
 *   cada sorteio.
 *
 * Mulberry32 tem estado de 32 bits, período de 2^32 e roda em ~2ns por
 * chamada — mais que suficiente para um jogo de tabuleiro e trivial de
 * serializar (um único inteiro).
 */

/* -------------------------------------------------------------------------- */
/*                                    TIPOS                                    */
/* -------------------------------------------------------------------------- */

export interface Rng {
  /** Float em [0, 1). Primitiva — todo o resto é derivado daqui. */
  next(): number;
  /** Float em [min, max). */
  range(min: number, max: number): number;
  /** Inteiro em [min, max] — **inclusivo nas duas pontas**. */
  int(min: number, max: number): number;
  /** Sorteia um item. Lança se a lista estiver vazia. */
  pick<T>(items: readonly T[]): T;
  /** Sorteia por peso: `[['A', 3], ['B', 1]]` ⇒ A sai 3x mais que B. */
  weighted<T>(entries: readonly (readonly [T, number])[]): T;
  /** `true` com a probabilidade dada (0..1). */
  chance(probability: number): boolean;
  /** Fisher-Yates imutável — devolve cópia embaralhada. */
  shuffle<T>(items: readonly T[]): T[];

  /** Estado interno (32 bits). Serializável — use para salvar/restaurar. */
  getState(): number;
  setState(state: number): void;

  /**
   * Deriva um gerador filho independente a partir de um rótulo.
   * **Não consome** a sequência do pai: dois forks do mesmo rótulo e mesma
   * seed sempre produzem o mesmo stream.
   */
  fork(label: string): Rng;
}

/* -------------------------------------------------------------------------- */
/*                                   INTERNOS                                  */
/* -------------------------------------------------------------------------- */

/** Hash de string para inteiro de 32 bits (xmur3). Usado em seeds textuais. */
function hashString(input: string): number {
  let h = 1779033703 ^ input.length;
  for (let i = 0; i < input.length; i++) {
    h = Math.imul(h ^ input.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^ (h >>> 16)) >>> 0;
}

/** Normaliza qualquer entrada para um inteiro de 32 bits sem sinal. */
function normalizeSeed(seed: number | string): number {
  if (typeof seed === 'string') return hashString(seed);
  return (Number.isFinite(seed) ? seed : 0) >>> 0;
}

/* -------------------------------------------------------------------------- */
/*                                   FÁBRICA                                   */
/* -------------------------------------------------------------------------- */

/** Cria um gerador independente a partir de uma seed numérica ou textual. */
export function createRng(seed: number | string): Rng {
  const rootSeed = normalizeSeed(seed);
  let state = rootSeed;

  const next = (): number => {
    // Mulberry32
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const rng: Rng = {
    next,

    range: (min, max) => min + next() * (max - min),

    int: (min, max) => {
      const lo = Math.ceil(min);
      const hi = Math.floor(max);
      if (hi < lo) return lo;
      return lo + Math.floor(next() * (hi - lo + 1));
    },

    pick: <T,>(items: readonly T[]): T => {
      if (items.length === 0) throw new Error('[rng] pick() recebeu uma lista vazia');
      return items[Math.floor(next() * items.length)];
    },

    weighted: <T,>(entries: readonly (readonly [T, number])[]): T => {
      const total = entries.reduce((sum, [, weight]) => sum + Math.max(0, weight), 0);
      if (total <= 0) throw new Error('[rng] weighted() precisa de ao menos um peso positivo');

      let roll = next() * total;
      for (const [value, weight] of entries) {
        roll -= Math.max(0, weight);
        if (roll < 0) return value;
      }
      return entries[entries.length - 1][0]; // guarda contra erro de ponto flutuante
    },

    chance: (probability) => next() < probability,

    shuffle: <T,>(items: readonly T[]): T[] => {
      const out = [...items];
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
      }
      return out;
    },

    getState: () => state >>> 0,
    setState: (value) => {
      state = value >>> 0;
    },

    // Deriva da seed ORIGINAL, não do estado atual: por isso não consome o pai.
    fork: (label) => createRng(hashString(`${label}#${rootSeed}`)),
  };

  return rng;
}

/**
 * Única fonte de entropia real do projeto.
 *
 * `Math.random()` aparece aqui e **em nenhum outro lugar** — a partir deste
 * ponto tudo é derivado da seed. Se você ver `Math.random()` fora deste
 * arquivo, é bug.
 */
export function generateSeed(): number {
  return (Math.floor(Math.random() * 0xffffffff) ^ Date.now()) >>> 0;
}

/* -------------------------------------------------------------------------- */
/*                             CANAIS DA PARTIDA                               */
/* -------------------------------------------------------------------------- */

/**
 * Canais independentes.
 *
 * Streams separados são essenciais: o `TERMINAL` sorteia intervalos de glitch
 * em ritmo dependente de frame rate. Se ele compartilhasse a sequência com
 * `RULES`, um device mais lento consumiria números em ordem diferente e o
 * replay dessincronizaria. Cada canal avança sozinho.
 */
export type RngChannel = 'RULES' | 'BOARD' | 'CARDS' | 'AI' | 'TERMINAL';

const CHANNELS: readonly RngChannel[] = ['RULES', 'BOARD', 'CARDS', 'AI', 'TERMINAL'];

let matchSeed = 0;
let channels: Record<RngChannel, Rng> | null = null;

/**
 * (Re)semeia a partida inteira. Chamado por `startMatch` no gameStore.
 * Retorna a seed efetivamente usada — guarde-a para reproduzir a partida.
 */
export function seedMatch(seed: number | string = generateSeed()): number {
  matchSeed = normalizeSeed(seed);
  const root = createRng(matchSeed);

  channels = CHANNELS.reduce(
    (acc, label) => {
      acc[label] = root.fork(label);
      return acc;
    },
    {} as Record<RngChannel, Rng>,
  );

  return matchSeed;
}

/** Acessa um canal. Semeia automaticamente se ninguém chamou `seedMatch`. */
export function getChannel(channel: RngChannel): Rng {
  if (!channels) seedMatch();
  return channels![channel];
}

/** Seed da partida atual — exiba na tela de fim de jogo para o jogador copiar. */
export function getMatchSeed(): number {
  return matchSeed;
}

/** Snapshot completo (seed + cursor de cada canal), para save game / replay. */
export interface RngSnapshot {
  seed: number;
  cursors: Record<RngChannel, number>;
}

export function snapshotRng(): RngSnapshot {
  return {
    seed: matchSeed,
    cursors: CHANNELS.reduce(
      (acc, label) => {
        acc[label] = getChannel(label).getState();
        return acc;
      },
      {} as Record<RngChannel, number>,
    ),
  };
}

export function restoreRng(snapshot: RngSnapshot): void {
  seedMatch(snapshot.seed);
  for (const label of CHANNELS) {
    channels![label].setState(snapshot.cursors[label]);
  }
}
