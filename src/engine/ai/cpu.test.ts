import { describe, expect, it } from 'vitest';

import { chooseCpuCardPlay } from '@/engine/ai/cpu';
import { createEmptyBoard, type GameState } from '@/engine/rules';

/**
 * Fixture mínima e independente do store — `src/engine/` não importa nada de
 * `src/store/` (nem em teste), então não reusa `createInitialState` de
 * `gameStore.ts`. Cobre todos os campos de `GameState` com valores neutros;
 * cada teste sobrescreve só o que importa para o cenário.
 */
function baseState(overrides: Partial<GameState> = {}): GameState {
  return {
    board: createEmptyBoard(),
    turn: 'MACHINE',
    turnCount: 1,
    playerHp: 5,
    machineHp: 5,
    playerEnergy: 3,
    machineEnergy: 3,
    activeRule: 'NORMAL',
    blockedCell: null,
    lockedCell: null,
    lockedCellExpiresAtTurn: null,
    doomedCell: null,
    playerHand: [],
    nextCardUid: 0,
    pendingAction: null,
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
    lastNotice: null,
    nextNoticeId: 0,
    lastAltarPrompt: null,
    nextAltarPromptId: 0,
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

describe('chooseCpuCardPlay — regressão de energia baixa', () => {
  it('nunca escolhe uma carta cara demais, mesmo quando a prioridade a favoreceria', () => {
    // machineHp<=2 e playerHp<=2 disparariam as duas primeiras prioridades
    // (cura crítica, abate) se a energia permitisse — as duas cartas custam 3.
    const state = baseState({
      machineEnergy: 1,
      machineHp: 1,
      playerHp: 1,
      machineHand: [
        { uid: 'a', cardId: 'HEAL_SELF' },
        { uid: 'b', cardId: 'DIRECT_DAMAGE' },
      ],
    });

    expect(chooseCpuCardPlay(state)).toBeNull();
  });

  it('cai para a carta mais barata disponível em vez de travar', () => {
    // HEAL_SELF (custo 3) é descartado pelo filtro de energia; LOCK_CELL
    // (custo 1, prioridade mais baixa) é o que sobra e deve ser escolhido.
    const state = baseState({
      machineEnergy: 1,
      machineHp: 1, // dispararia a cura, se ela coubesse
      machineHand: [
        { uid: 'a', cardId: 'HEAL_SELF' },
        { uid: 'c', cardId: 'LOCK_CELL' },
      ],
    });

    const decision = chooseCpuCardPlay(state);
    expect(decision?.uid).toBe('c');
    expect(decision?.cardId).toBe('LOCK_CELL');
    expect(decision?.targetIndex).toBeGreaterThanOrEqual(0);
  });
});
