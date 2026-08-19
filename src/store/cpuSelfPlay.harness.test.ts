import { describe, expect, it } from 'vitest';

import { mirrorForDecision } from '@/engine/ai/cpuMirror';
import { playCPUTurn, type CpuActions } from '@/engine/ai/cpu';
import type { CardId } from '@/engine/cards/definitions';
import { handKeyFor, type Combatant, type GameState } from '@/engine/rules';
import { useGameStore } from '@/store/gameStore';

/**
 * Fase 7a — harness de auto-jogo determinístico. Ferramenta de DIAGNÓSTICO
 * pra linha de base da heurística atual, não parte do CI: casa com o glob
 * `src/**\/*.test.ts` de propósito (pra rodar via `tsc`/`vitest` normalmente
 * como qualquer arquivo do projeto), mas o `describe` principal só executa
 * com `RUN_CPU_HARNESS=1` — em qualquer `npm test`/`vitest run` comum ele
 * aparece como "skipped", sem tocar `vitest.config.mts`.
 *
 * Rodar de verdade: `RUN_CPU_HARNESS=1 npx vitest run
 * src/store/cpuSelfPlay.harness.test.ts` (opcionalmente `CPU_HARNESS_GAMES=N`
 * pra mudar o tamanho do lote, default 300).
 *
 * `chooseCpuCardPlay`/`chooseCpuMove`/`playCPUTurn` NÃO são modificados aqui
 * — os dois lados usam exatamente as mesmas funções, sem parâmetro de
 * combatente (são hardcoded pra `MACHINE`, confirmado por leitura). Quando é
 * a vez do `PLAYER`, este harness alimenta as funções com
 * `mirrorForDecision(state)` — uma cópia com os dois lados trocados, testada
 * isoladamente em `cpuMirror.test.ts` — e aplica o resultado (uid/cardId/
 * índice, nenhum dos dois combatant-específico) contra o estado REAL via as
 * ações genéricas que a store já expõe (`placeMark`/`endTurn`/
 * `resolveInteraction` recebem `combatant` explícito; só `playCard`/
 * `playMachineCard` são pré-vinculadas, uma pra cada lado).
 */

const BASE_SEED = 1_000;
const DEFAULT_GAMES = 300;
const MAX_TURNS_PER_MATCH = 500;
/**
 * Teto DURO e independente do teto externo (`MAX_TURNS_PER_MATCH`). Se o
 * ciclo jogar-carta → anunciar → resolver interação → anunciar de novo nunca
 * devolver o controle (ex.: um ciclo de acknowledgements que se realimenta),
 * ESTE limite estoura primeiro e marca a partida como travamento na hora —
 * não deixa a situação escapar pro loop externo continuar esperando um
 * `turn`/`status` que nunca muda enquanto o loop interno gira sozinho pra
 * sempre. Sem este teto, um bug aqui travaria o PRÓPRIO SCRIPT, não uma
 * partida simulada.
 */
const INNER_ACK_LIMIT = 10;

interface CardPlayRecord {
  side: Combatant;
  cardId: CardId;
}

interface StuckSnapshot {
  seed: number;
  reason: 'OUTER_TURN_CEILING' | 'INNER_ACK_CEILING';
  turnCount: number;
  turn: Combatant;
  status: GameState['status'];
  pendingInteraction: GameState['pendingInteraction'];
  pendingAcknowledgement: GameState['pendingAcknowledgement'];
  playerHand: GameState['playerHand'];
  machineHand: GameState['machineHand'];
}

interface GameResult {
  seed: number;
  winner: Combatant | null;
  stuck: StuckSnapshot | null;
  cardPlays: CardPlayRecord[];
}

function snapshot(seed: number, reason: StuckSnapshot['reason']): StuckSnapshot {
  const s = useGameStore.getState();
  return {
    seed,
    reason,
    turnCount: s.turnCount,
    turn: s.turn,
    status: s.status,
    pendingInteraction: s.pendingInteraction,
    pendingAcknowledgement: s.pendingAcknowledgement,
    playerHand: s.playerHand,
    machineHand: s.machineHand,
  };
}

/** View que `cpu.ts` deve enxergar para decidir por `decidingSide` — real para MACHINE, espelhada para PLAYER. */
function viewFor(decidingSide: Combatant, real: GameState): GameState {
  return decidingSide === 'MACHINE' ? real : mirrorForDecision(real);
}

function buildActions(decidingSide: Combatant, cardPlays: CardPlayRecord[]): CpuActions {
  return {
    placeMark: (index) => useGameStore.getState().placeMark(decidingSide, index),
    playCard: (uid, targetIndex) => {
      const hand = useGameStore.getState()[handKeyFor(decidingSide)];
      const cardId = hand.find((c) => c.uid === uid)?.cardId;
      const played =
        decidingSide === 'PLAYER'
          ? useGameStore.getState().playCard(uid, targetIndex)
          : useGameStore.getState().playMachineCard(uid, targetIndex);
      if (played && cardId) cardPlays.push({ side: decidingSide, cardId });
      return played;
    },
    endTurn: () => {
      useGameStore.getState().endTurn(decidingSide);
    },
    resolveInteraction: (selection) => useGameStore.getState().resolveInteraction(decidingSide, selection),
  };
}

/**
 * Conduz UMA tentativa de turno de `decidingSide` até o fim — inclusive o
 * ciclo de `pendingAcknowledgement` que, sem UI nenhuma clicando "Entendi",
 * ninguém mais resolveria (`playCPUTurn` só ABORTA quando encontra uma
 * confirmação pendente; é o hook React, ausente aqui, que normalmente
 * re-dispara depois que ela limpa).
 *
 * @returns snapshot de travamento se o teto interno estourar, `null` caso
 * contrário (turno resolvido, ou não era a vez de `decidingSide`).
 */
async function driveTurn(seed: number, decidingSide: Combatant, cardPlays: CardPlayRecord[]): Promise<StuckSnapshot | null> {
  for (let attempt = 0; attempt < INNER_ACK_LIMIT; attempt++) {
    const real = useGameStore.getState();
    if (real.status !== 'PLAYING' || real.turn !== decidingSide) return null;

    const actions = buildActions(decidingSide, cardPlays);
    await playCPUTurn(viewFor(decidingSide, real), actions, {
      minDelay: 0,
      maxDelay: 0,
      getState: () => viewFor(decidingSide, useGameStore.getState()),
    });

    const after = useGameStore.getState();
    if (after.status !== 'PLAYING' || after.turn !== decidingSide) return null;

    if (after.pendingAcknowledgement !== null) {
      useGameStore.getState().acknowledgePending();
      continue;
    }

    // Nada mais a fazer nesta tentativa (ex.: `endTurn()` já rodou por dentro
    // de `playCPUTurn` mas o turno formalmente ainda não avançou — não deve
    // acontecer hoje, mas devolver aqui em vez de girar é o comportamento
    // seguro: o loop EXTERNO reavalia e seu próprio teto pega o caso.
    return null;
  }

  return snapshot(seed, 'INNER_ACK_CEILING');
}

async function playOneGame(seed: number): Promise<GameResult> {
  useGameStore.getState().startMatch(seed, false);
  const cardPlays: CardPlayRecord[] = [];

  for (let turns = 0; turns < MAX_TURNS_PER_MATCH; turns++) {
    const state = useGameStore.getState();
    if (state.status !== 'PLAYING') break;

    const stuck = await driveTurn(seed, state.turn, cardPlays);
    if (stuck) return { seed, winner: null, stuck, cardPlays };

    if (useGameStore.getState().status === 'ROUND_OVER') {
      useGameStore.getState().startNextRound();
    }
  }

  const final = useGameStore.getState();
  if (final.status === 'PLAYING') {
    return { seed, winner: null, stuck: snapshot(seed, 'OUTER_TURN_CEILING'), cardPlays };
  }

  return { seed, winner: final.matchWinner, stuck: null, cardPlays };
}

/* -------------------------------------------------------------------------- */
/*                                  RELATÓRIO                                  */
/* -------------------------------------------------------------------------- */

function formatReport(results: GameResult[]): string {
  const lines: string[] = [];
  const n = results.length;
  const stuckGames = results.filter((r) => r.stuck !== null);
  const finished = results.filter((r) => r.stuck === null);

  const wins: Record<Combatant, number> = { PLAYER: 0, MACHINE: 0 };
  for (const r of finished) {
    if (r.winner) wins[r.winner] += 1;
  }

  lines.push(`\n=== Fase 7a — auto-jogo CPU x CPU (${n} partidas, seeds ${BASE_SEED}..${BASE_SEED + n - 1}) ===`);
  lines.push(`Terminadas: ${finished.length}/${n} · Travadas: ${stuckGames.length}/${n}`);
  lines.push(
    `Vitórias — PLAYER: ${wins.PLAYER} (${pct(wins.PLAYER, finished.length)}) · MACHINE: ${wins.MACHINE} (${pct(wins.MACHINE, finished.length)})`,
  );

  const perCard = new Map<CardId, { gamesPlayerAtLeastOnce: number; gamesMachineAtLeastOnce: number; totalPlays: number; winsWhenPlayerPlayed: number; winsWhenMachinePlayed: number }>();

  for (const r of results) {
    const playedByPlayer = new Set<CardId>();
    const playedByMachine = new Set<CardId>();
    for (const play of r.cardPlays) {
      const entry = perCard.get(play.cardId) ?? {
        gamesPlayerAtLeastOnce: 0,
        gamesMachineAtLeastOnce: 0,
        totalPlays: 0,
        winsWhenPlayerPlayed: 0,
        winsWhenMachinePlayed: 0,
      };
      entry.totalPlays += 1;
      perCard.set(play.cardId, entry);
      (play.side === 'PLAYER' ? playedByPlayer : playedByMachine).add(play.cardId);
    }
    for (const cardId of playedByPlayer) {
      const entry = perCard.get(cardId)!;
      entry.gamesPlayerAtLeastOnce += 1;
      if (r.stuck === null && r.winner === 'PLAYER') entry.winsWhenPlayerPlayed += 1;
    }
    for (const cardId of playedByMachine) {
      const entry = perCard.get(cardId)!;
      entry.gamesMachineAtLeastOnce += 1;
      if (r.stuck === null && r.winner === 'MACHINE') entry.winsWhenMachinePlayed += 1;
    }
  }

  lines.push('\n--- Frequência e vitória condicionada por carta ---');
  lines.push('cardId | jogos com >=1 jogada (P/M) | jogadas totais | vitória do lado quando jogou (P/M)');
  const sortedCardIds = [...perCard.keys()].sort();
  for (const cardId of sortedCardIds) {
    const e = perCard.get(cardId)!;
    lines.push(
      `${cardId} | ${e.gamesPlayerAtLeastOnce}/${e.gamesMachineAtLeastOnce} | ${e.totalPlays} | ${pct(e.winsWhenPlayerPlayed, e.gamesPlayerAtLeastOnce)}/${pct(e.winsWhenMachinePlayed, e.gamesMachineAtLeastOnce)}`,
    );
  }

  if (stuckGames.length > 0) {
    lines.push('\n--- Travamentos (amostra até 10) ---');
    for (const r of stuckGames.slice(0, 10)) {
      lines.push(JSON.stringify(r.stuck, null, 2));
    }
  }

  return lines.join('\n');
}

function pct(count: number, total: number): string {
  if (total === 0) return 'n/a';
  return `${((count / total) * 100).toFixed(1)}%`;
}

/* -------------------------------------------------------------------------- */
/*                                    TESTE                                    */
/* -------------------------------------------------------------------------- */

describe.skipIf(process.env.RUN_CPU_HARNESS !== '1')('Fase 7a — lote de auto-jogo CPU x CPU (diagnóstico, não roda no CI)', () => {
  it(
    'roda N partidas determinísticas e reporta métricas brutas (sem interpretar)',
    async () => {
      const n = Number(process.env.CPU_HARNESS_GAMES ?? DEFAULT_GAMES);
      const results: GameResult[] = [];

      for (let i = 0; i < n; i++) {
        results.push(await playOneGame(BASE_SEED + i));
      }

      expect(results).toHaveLength(n);

      // eslint-disable-next-line no-console
      console.log(formatReport(results));
    },
    900_000, // ~1.5s/jogo observado no smoke test de 10 — 300 jogos ficam bem dentro de 15min
  );
});
