import { describe, expect, it } from 'vitest';

import { createTestState } from '@/engine/testHelpers';
import type { Board } from '@/engine/rules';

import { mirrorForDecision } from './cpuMirror';

/**
 * Peça de maior risco do harness da Fase 7a: um erro aqui não quebra o
 * harness, produz uma taxa de vitória enviesada em silêncio (ex.: inverter
 * `owner` sem inverter `mark` faz `findWinner`/`simulate` de `cpu.ts`
 * decidirem errado sem exception nenhuma). Cobertura deliberadamente por
 * conferência manual célula a célula, não só por propriedade.
 */
describe('mirrorForDecision', () => {
  it('é uma involução — aplicar duas vezes devolve exatamente o estado original', () => {
    const board: Board = [
      { owner: 'PLAYER', mark: 'X', turnPlaced: 0 },
      null,
      { owner: 'MACHINE', mark: 'O', turnPlaced: 1 },
      null,
      { owner: 'PLAYER', mark: 'X', turnPlaced: 2 },
      null,
      null,
      null,
      { owner: 'MACHINE', mark: 'O', turnPlaced: 3 },
    ];

    const state = createTestState({
      turn: 'MACHINE',
      board,
      playerHand: [{ uid: 'p1', cardId: 'HEAL_SELF' }],
      machineHand: [{ uid: 'm1', cardId: 'DIRECT_DAMAGE' }, { uid: 'm2', cardId: 'STUDY' }],
      playerEnergy: 1,
      machineEnergy: 3,
      playerHp: 4,
      machineHp: 2,
      playerTraps: [{ uid: 't1', cardId: 'SHIELD_TRAP' }],
      machineTraps: [],
      playerPlacementBlocked: true,
      machinePlacementBlocked: false,
      extraTurnPending: 'PLAYER',
      pendingInteraction: {
        kind: 'PICK_MANY_FROM_HAND',
        caster: 'MACHINE',
        cardId: 'INTEL_REVEAL',
        cardUid: 'esp',
        handIndex: 0,
        priorSelections: [],
        source: 'PLAYER',
        optionUids: ['p1'],
        count: 1,
      },
    });

    expect(mirrorForDecision(mirrorForDecision(state))).toEqual(state);
  });

  it('involução também vale com pendingInteraction nulo e extraTurnPending nulo', () => {
    const state = createTestState({
      pendingInteraction: null,
      extraTurnPending: null,
    });

    expect(mirrorForDecision(mirrorForDecision(state))).toEqual(state);
  });

  it('conferido à mão, célula a célula: tabuleiro parcialmente preenchido troca dono E símbolo juntos', () => {
    // 0:PLAYER/X  1:vazio     2:MACHINE/O
    // 3:vazio     4:PLAYER/X  5:vazio
    // 6:MACHINE/O 7:vazio     8:vazio
    const board: Board = [
      { owner: 'PLAYER', mark: 'X', turnPlaced: 5 },
      null,
      { owner: 'MACHINE', mark: 'O', turnPlaced: 6 },
      null,
      { owner: 'PLAYER', mark: 'X', turnPlaced: 7 },
      null,
      { owner: 'MACHINE', mark: 'O', turnPlaced: 8 },
      null,
      null,
    ];

    const state = createTestState({ board });
    const mirrored = mirrorForDecision(state);

    // Vazias continuam vazias, no MESMO índice — geometria não muda, só posse.
    expect(mirrored.board[1]).toBeNull();
    expect(mirrored.board[3]).toBeNull();
    expect(mirrored.board[5]).toBeNull();
    expect(mirrored.board[7]).toBeNull();
    expect(mirrored.board[8]).toBeNull();

    // Cada peça troca dono E símbolo, mas mantém `turnPlaced` (identidade da
    // peça) e o ÍNDICE (posição no tabuleiro não é geometricamente afetada).
    expect(mirrored.board[0]).toEqual({ owner: 'MACHINE', mark: 'O', turnPlaced: 5 });
    expect(mirrored.board[2]).toEqual({ owner: 'PLAYER', mark: 'X', turnPlaced: 6 });
    expect(mirrored.board[4]).toEqual({ owner: 'MACHINE', mark: 'O', turnPlaced: 7 });
    expect(mirrored.board[6]).toEqual({ owner: 'PLAYER', mark: 'X', turnPlaced: 8 });
  });

  it('conferido à mão: mãos, energia, HP, armadilhas e bloqueio de posicionamento trocam de lado', () => {
    const state = createTestState({
      playerHand: [{ uid: 'p1', cardId: 'HEAL_SELF' }],
      machineHand: [{ uid: 'm1', cardId: 'DIRECT_DAMAGE' }],
      playerEnergy: 1,
      machineEnergy: 3,
      playerHp: 4,
      machineHp: 2,
      playerTraps: [{ uid: 't1', cardId: 'SHIELD_TRAP' }],
      machineTraps: [{ uid: 't2', cardId: 'BOMB_TRAP' }],
      playerPlacementBlocked: true,
      machinePlacementBlocked: false,
    });

    const mirrored = mirrorForDecision(state);

    expect(mirrored.machineHand).toEqual([{ uid: 'p1', cardId: 'HEAL_SELF' }]);
    expect(mirrored.playerHand).toEqual([{ uid: 'm1', cardId: 'DIRECT_DAMAGE' }]);
    expect(mirrored.machineEnergy).toBe(1);
    expect(mirrored.playerEnergy).toBe(3);
    expect(mirrored.machineHp).toBe(4);
    expect(mirrored.playerHp).toBe(2);
    expect(mirrored.machineTraps).toEqual([{ uid: 't1', cardId: 'SHIELD_TRAP' }]);
    expect(mirrored.playerTraps).toEqual([{ uid: 't2', cardId: 'BOMB_TRAP' }]);
    expect(mirrored.machinePlacementBlocked).toBe(true);
    expect(mirrored.playerPlacementBlocked).toBe(false);
  });

  it('conferido à mão: turn, extraTurnPending e pendingInteraction (caster + source) trocam de combatente', () => {
    const state = createTestState({
      turn: 'PLAYER',
      extraTurnPending: 'MACHINE',
      pendingInteraction: {
        kind: 'PICK_ONE_FROM_HAND',
        caster: 'PLAYER',
        cardId: 'HAND_RAID',
        cardUid: 'saque',
        handIndex: 2,
        priorSelections: [],
        source: 'MACHINE',
        optionUids: ['m1', 'm2'],
      },
    });

    const mirrored = mirrorForDecision(state);

    expect(mirrored.turn).toBe('MACHINE');
    expect(mirrored.extraTurnPending).toBe('PLAYER');
    expect(mirrored.pendingInteraction).toMatchObject({ caster: 'MACHINE', source: 'PLAYER' });
  });

  it('conferido à mão: pendingInteraction sem `source` (ex. BOARD_TARGET) só troca caster', () => {
    const state = createTestState({
      pendingInteraction: {
        kind: 'BOARD_TARGET',
        caster: 'MACHINE',
        cardId: 'LOCK_CELL',
        cardUid: 'lock',
        handIndex: 0,
        priorSelections: [],
      },
    });

    const mirrored = mirrorForDecision(state);

    expect(mirrored.pendingInteraction).toEqual({
      kind: 'BOARD_TARGET',
      caster: 'PLAYER',
      cardId: 'LOCK_CELL',
      cardUid: 'lock',
      handIndex: 0,
      priorSelections: [],
    });
  });

  it('conferido à mão: campos não-combatant-específicos ficam intocados (activeRule, forcedVanish, status, turnCount...)', () => {
    const state = createTestState({
      activeRule: 'BLOCKED_CELL',
      blockedCell: 4,
      lockedCell: 2,
      forcedVanish: { owner: 'PLAYER', mode: 'RANDOM' },
      highlightedOldestFor: { caster: 'PLAYER', owner: 'MACHINE', index: 3, turnPlaced: 1 },
      fullIntelRevealFor: 'MACHINE',
      status: 'PLAYING',
      turnCount: 17,
    });

    const mirrored = mirrorForDecision(state);

    expect(mirrored.activeRule).toBe('BLOCKED_CELL');
    expect(mirrored.blockedCell).toBe(4);
    expect(mirrored.lockedCell).toBe(2);
    expect(mirrored.forcedVanish).toEqual({ owner: 'PLAYER', mode: 'RANDOM' });
    expect(mirrored.highlightedOldestFor).toEqual({
      caster: 'PLAYER',
      owner: 'MACHINE',
      index: 3,
      turnPlaced: 1,
    });
    expect(mirrored.fullIntelRevealFor).toBe('MACHINE');
    expect(mirrored.status).toBe('PLAYING');
    expect(mirrored.turnCount).toBe(17);
  });
});
