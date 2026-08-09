import { createEmptyBoard, type GameState } from '@/engine/rules';

/**
 * Fixture mínima e independente do store — `src/engine/` não importa nada de
 * `src/store/` (nem em teste), então não reusa `createInitialState` de
 * `gameStore.ts`. Cobre todos os campos de `GameState` com valores neutros;
 * cada teste sobrescreve só o que importa para o cenário.
 *
 * Extraída de `src/engine/ai/cpu.test.ts` (Fase 1) para não duplicar entre
 * `cpu.test.ts` e `registry.effects.test.ts` (Fase 2).
 */
export function createTestState(overrides: Partial<GameState> = {}): GameState {
  return {
    board: createEmptyBoard(),
    turn: 'PLAYER',
    turnCount: 1,
    playerHp: 5,
    machineHp: 5,
    playerEnergy: 3,
    machineEnergy: 3,
    activeRule: 'NORMAL',
    blockedCell: null,
    lockedCell: null,
    lockedCellExpiresAtTurn: null,
    forcedVanish: null,
    playerPlacementBlocked: false,
    machinePlacementBlocked: false,
    highlightedOldestFor: null,
    fullIntelRevealFor: null,
    playerHand: [],
    nextCardUid: 0,
    pendingInteraction: null,
    playerTraps: [],
    machineTraps: [],
    playerRevealedUids: [],
    machineRevealedUids: [],
    pendingAcknowledgement: null,
    nextAcknowledgementId: 0,
    machineHand: [],
    machineCardTurn: null,
    ruleExpiresAtTurn: null,
    lastDamageEvent: null,
    nextDamageEventId: 0,
    lastExtraTurn: null,
    nextExtraTurnId: 0,
    lastChaosRoulette: null,
    nextChaosRouletteId: 0,
    chaosRouletteSpinning: false,
    lastNotice: null,
    nextNoticeId: 0,
    isPaused: false,
    isOnline: false,
    terminalLog: [],
    nextLogId: 0,
    extraTurnPending: null,
    status: 'PLAYING',
    roundWinner: null,
    winningLine: null,
    matchWinner: null,
    matchOverReason: null,
    lastVanishedIndex: null,
    matchSeed: 1,
    ...overrides,
  };
}
