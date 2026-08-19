import { describe, expect, it } from 'vitest';

import {
  CHAOS_SURGE_CHANCE,
  ENERGY_CAP,
  OPENING_HAND_SIZE,
  PLACEMENT_COST,
  canPlaceAt,
  createEmptyBoard,
  getVanishingIndex,
  isHighlightedOldestValid,
  isImmuneToTraps,
  regenEnergy,
  type Board,
  type Piece,
} from '@/engine/rules';
import { getChannel, seedMatch } from '@/engine/rng';
import { createTestState } from '@/engine/testHelpers';

function withPieces(owner: Piece['owner'], indexes: number[]): Board {
  const board = createEmptyBoard();
  indexes.forEach((index, i) => {
    board[index] = { owner, mark: owner === 'PLAYER' ? 'X' : 'O', turnPlaced: i };
  });
  return board;
}

describe('regenEnergy', () => {
  it('soma +1 aos dois lados quando ambos estão abaixo do teto', () => {
    expect(regenEnergy(0, 1)).toEqual({ playerEnergy: 1, machineEnergy: 2 });
  });

  it('não passa do teto mesmo partindo de valores altos', () => {
    expect(regenEnergy(ENERGY_CAP, ENERGY_CAP)).toEqual({
      playerEnergy: ENERGY_CAP,
      machineEnergy: ENERGY_CAP,
    });
    expect(regenEnergy(ENERGY_CAP - 1, ENERGY_CAP)).toEqual({
      playerEnergy: ENERGY_CAP,
      machineEnergy: ENERGY_CAP,
    });
  });

  it('os dois lados regeneram juntos, independente um do outro', () => {
    // Um lado no teto e o outro não: cada um segue sua própria conta.
    const result = regenEnergy(ENERGY_CAP, 0);
    expect(result.playerEnergy).toBe(ENERGY_CAP);
    expect(result.machineEnergy).toBe(1);
  });
});

describe('isImmuneToTraps', () => {
  it('Lendária e Boom são imunes; Comum/Rara/Épica não são', () => {
    expect(isImmuneToTraps('LEGENDARY')).toBe(true);
    expect(isImmuneToTraps('BOOM')).toBe(true);
    expect(isImmuneToTraps('COMMON')).toBe(false);
    expect(isImmuneToTraps('RARE')).toBe(false);
    expect(isImmuneToTraps('EPIC')).toBe(false);
  });
});

describe('getVanishingIndex — forced (ANOMALIA/OBSOLESCÊNCIA)', () => {
  it('sem forced, comportamento padrão: a mais antiga por turnPlaced', () => {
    const board = withPieces('MACHINE', [0, 1, 2]); // turnPlaced 0,1,2 nesta ordem
    expect(getVanishingIndex(board, 'MACHINE', 'NORMAL')).toBe(0);
  });

  it('forced RANDOM: sorteia entre as peças do owner (nunca undefined, sempre uma das 3)', () => {
    const board = withPieces('MACHINE', [0, 1, 2]);
    const result = getVanishingIndex(board, 'MACHINE', 'NORMAL', { owner: 'MACHINE', mode: 'RANDOM' });
    expect([0, 1, 2]).toContain(result);
  });

  it('forced CHOSEN válido: devolve o índice marcado, mesmo não sendo o mais antigo', () => {
    const board = withPieces('MACHINE', [0, 1, 2]); // 2 é a mais NOVA (turnPlaced mais alto)
    const forced = { owner: 'MACHINE' as const, mode: 'CHOSEN' as const, index: 2, turnPlaced: 2 };
    expect(getVanishingIndex(board, 'MACHINE', 'NORMAL', forced)).toBe(2);
  });

  it('forced CHOSEN expirado (a peça já saiu por outro caminho): cai pro padrão', () => {
    const board = withPieces('MACHINE', [0, 1, 2]);
    // Marca aponta pra uma peça que não existe mais nesse turnPlaced (ex: foi
    // demolida e outra ocupou o lugar, ou o índice ficou vazio).
    const forced = { owner: 'MACHINE' as const, mode: 'CHOSEN' as const, index: 5, turnPlaced: 99 };
    expect(getVanishingIndex(board, 'MACHINE', 'NORMAL', forced)).toBe(0); // volta pra mais antiga
  });

  it('forced de outro owner é ignorado', () => {
    const board = withPieces('MACHINE', [0, 1, 2]);
    const forced = { owner: 'PLAYER' as const, mode: 'RANDOM' as const };
    expect(getVanishingIndex(board, 'MACHINE', 'NORMAL', forced)).toBe(0);
  });
});

describe('canPlaceAt — bloqueio de colocação da REBOBINAR', () => {
  it('recusa colocação só para o combatente com a própria flag ativa', () => {
    const state = createTestState({ turn: 'MACHINE', machinePlacementBlocked: true });
    expect(canPlaceAt(state, 0, 'MACHINE')).toBe(false);
  });

  it('não afeta o outro lado — a flag é por combatente, não compartilhada', () => {
    const state = createTestState({ turn: 'MACHINE', machinePlacementBlocked: true });
    // PLAYER não está bloqueado (e nem é a vez dele, mas isso é outra guarda —
    // aqui o que se prova é que `playerPlacementBlocked` continua `false`).
    expect(state.playerPlacementBlocked).toBe(false);

    const playerTurn = createTestState({ turn: 'PLAYER', machinePlacementBlocked: true });
    expect(canPlaceAt(playerTurn, 0, 'PLAYER')).toBe(true);
  });

  it('sem nenhuma flag ativa, colocação segue liberada normalmente', () => {
    const state = createTestState({ turn: 'PLAYER' });
    expect(canPlaceAt(state, 0, 'PLAYER')).toBe(true);
  });
});

describe('canPlaceAt — custo de energia (PLACEMENT_COST, Fase 8b)', () => {
  it('recusa colocação com energia insuficiente', () => {
    const state = createTestState({ turn: 'PLAYER', playerEnergy: 0 });
    expect(canPlaceAt(state, 0, 'PLAYER')).toBe(false);
  });

  it('com energia exatamente igual ao custo, libera normalmente', () => {
    const state = createTestState({ turn: 'PLAYER', playerEnergy: PLACEMENT_COST });
    expect(canPlaceAt(state, 0, 'PLAYER')).toBe(true);
  });

  it('REBOBINAR + energia insuficiente ao mesmo tempo: ainda recusa, sem precisar distinguir o motivo (defesa em profundidade)', () => {
    const state = createTestState({
      turn: 'MACHINE',
      machinePlacementBlocked: true,
      machineEnergy: 0,
    });
    expect(canPlaceAt(state, 0, 'MACHINE')).toBe(false);
  });

  it('TURNO_EXTRA/MINA: a 1ª colocação da sequência (extraTurnPending) é isenta do custo', () => {
    const state = createTestState({ turn: 'MACHINE', machineEnergy: 0, extraTurnPending: 'MACHINE' });
    expect(canPlaceAt(state, 0, 'MACHINE')).toBe(true);
  });

  it('TURNO_EXTRA/MINA: a 2ª colocação da sequência (extraTurnCostWaived) também é isenta', () => {
    const state = createTestState({
      turn: 'MACHINE',
      machineEnergy: 0,
      extraTurnPending: null, // já consumida pela 1ª colocação
      extraTurnCostWaived: 'MACHINE',
    });
    expect(canPlaceAt(state, 0, 'MACHINE')).toBe(true);
  });

  it('a isenção de turno extra é só pra ESTE combatente — o outro lado paga normal', () => {
    const state = createTestState({ turn: 'PLAYER', playerEnergy: 0, extraTurnCostWaived: 'MACHINE' });
    expect(canPlaceAt(state, 0, 'PLAYER')).toBe(false);
  });
});

describe('isHighlightedOldestValid — auto-invalidação do destaque de VIDENTE', () => {
  it('sem destaque nenhum: inválido', () => {
    expect(isHighlightedOldestValid(createTestState())).toBe(false);
  });

  it('a peça continua lá, mesmo owner e turnPlaced: válido', () => {
    const board = withPieces('MACHINE', [2]); // turnPlaced 0
    const state = createTestState({
      board,
      highlightedOldestFor: { caster: 'PLAYER', owner: 'MACHINE', index: 2, turnPlaced: 0 },
    });
    expect(isHighlightedOldestValid(state)).toBe(true);
  });

  it('a célula esvaziou (peça destruída/sumiu): inválido', () => {
    const state = createTestState({
      board: createEmptyBoard(),
      highlightedOldestFor: { caster: 'PLAYER', owner: 'MACHINE', index: 2, turnPlaced: 0 },
    });
    expect(isHighlightedOldestValid(state)).toBe(false);
  });

  it('outra peça ocupou o mesmo índice depois (turnPlaced não bate): inválido', () => {
    const board = withPieces('MACHINE', [2]); // turnPlaced 0, mas a marca esperava outro
    const state = createTestState({
      board,
      highlightedOldestFor: { caster: 'PLAYER', owner: 'MACHINE', index: 2, turnPlaced: 99 },
    });
    expect(isHighlightedOldestValid(state)).toBe(false);
  });
});

describe('OPENING_HAND_SIZE — início de progressão', () => {
  it('é 0: a partida começa sem cartas, de propósito', () => {
    expect(OPENING_HAND_SIZE).toBe(0);
  });
});

describe('CHAOS_SURGE_CHANCE — sorteio de surto de caos (canal RULES)', () => {
  it('taxa observada fica perto de 25% em 20 000 sorteios', () => {
    seedMatch(1);
    const rng = getChannel('RULES');
    const total = 20_000;
    let hits = 0;
    for (let i = 0; i < total; i++) {
      if (rng.chance(CHAOS_SURGE_CHANCE)) hits++;
    }
    const rate = hits / total;
    // Mesma folga de ±10% relativo já usada pra distribuição de raridade
    // (`registry.test.ts`) — larga o bastante pra não ser "flaky", apertada
    // o bastante pra pegar um `chance()` quebrado.
    expect(rate).toBeGreaterThan(CHAOS_SURGE_CHANCE * 0.9);
    expect(rate).toBeLessThan(CHAOS_SURGE_CHANCE * 1.1);
  });

  it('a mesma seed reproduz a mesma sequência de surtos — replay/multiplayer preservados', () => {
    seedMatch(42);
    const a = Array.from({ length: 500 }, () => getChannel('RULES').chance(CHAOS_SURGE_CHANCE));
    seedMatch(42);
    const b = Array.from({ length: 500 }, () => getChannel('RULES').chance(CHAOS_SURGE_CHANCE));
    expect(a).toEqual(b);
    // E não é sempre a mesma resposta — senão o teste acima passaria por
    // acidente com uma implementação quebrada que sempre devolve `false`.
    expect(a.some(Boolean)).toBe(true);
    expect(a.every(Boolean)).toBe(false);
  });
});
