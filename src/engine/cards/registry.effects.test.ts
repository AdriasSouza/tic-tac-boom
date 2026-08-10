import { describe, expect, it } from 'vitest';

import { CENTER_INDEX } from '@/engine/events';
import { createRng, getChannel, seedMatch, type Rng } from '@/engine/rng';
import { findWinner, getOldestPieceIndex, getVanishingIndex } from '@/engine/rules';
import type { Board, Piece } from '@/engine/rules';
import { createTestState } from '@/engine/testHelpers';
import { drawCardId, getCard } from '@/engine/cards/registry';

const rng = createRng(1);

/** `rng` com alguns métodos sobrescritos — para forçar um ramo sem depender de seed. */
function fixedRng(overrides: Partial<Rng>): Rng {
  return { ...createRng(1), ...overrides };
}

function piece(owner: Piece['owner'], turnPlaced: number): Piece {
  return { owner, mark: owner === 'PLAYER' ? 'X' : 'O', turnPlaced };
}

function boardWith(entries: Partial<Record<number, Piece>>): Board {
  const board: Board = Array(9).fill(null);
  for (const [index, p] of Object.entries(entries)) board[Number(index)] = p ?? null;
  return board;
}

/* -------------------------------------------------------------------------- */
/*                                   LIMPAR                                    */
/* -------------------------------------------------------------------------- */

describe('LIMPAR (CLEAR_BLOCK) — regra confirmada: cobre bloqueio do caos E trava da TRAVAR', () => {
  const card = getCard('CLEAR_BLOCK');

  it('limpa o bloqueio do caos na célula alvo', () => {
    const state = createTestState({ activeRule: 'BLOCKED_CELL', blockedCell: 3, ruleExpiresAtTurn: 9 });
    const result = card.effect({ state, caster: 'PLAYER', uid: 'x', targetIndex: 3, rng });
    expect(result?.patch).toMatchObject({ activeRule: 'NORMAL', blockedCell: null, ruleExpiresAtTurn: null });
  });

  it('limpa a trava da TRAVAR na célula alvo (efeito alterado — antes só cobria o caos)', () => {
    const state = createTestState({ lockedCell: 5, lockedCellExpiresAtTurn: 9 });
    const result = card.effect({ state, caster: 'PLAYER', uid: 'x', targetIndex: 5, rng });
    expect(result?.patch).toMatchObject({ lockedCell: null, lockedCellExpiresAtTurn: null });
  });

  it('canPlay: indisponível sem nenhum efeito persistente no tabuleiro', () => {
    const state = createTestState();
    expect(card.canPlay?.({ state, caster: 'PLAYER', uid: 'x' })).toBe(false);
  });

  it('isValidTarget: só a célula com efeito persistente ativo', () => {
    const state = createTestState({ lockedCell: 2 });
    expect(card.isValidTarget?.({ state, caster: 'PLAYER', index: 2 })).toBe(true);
    expect(card.isValidTarget?.({ state, caster: 'PLAYER', index: 3 })).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/*                                   TRAVAR                                    */
/* -------------------------------------------------------------------------- */

describe('TRAVAR (LOCK_CELL) — regra confirmada: mantida sem mudança', () => {
  const card = getCard('LOCK_CELL');

  it('lacra a célula alvo por CARD_RULE_MIN_DURATION_TURNS turnos', () => {
    const state = createTestState({ turnCount: 4 });
    const result = card.effect({ state, caster: 'PLAYER', uid: 'x', targetIndex: 6, rng });
    expect(result?.patch).toMatchObject({ lockedCell: 6, lockedCellExpiresAtTurn: 6 });
  });

  it('canPlay: indisponível sem nenhuma célula vazia e destravada', () => {
    const full = boardWith(Object.fromEntries(Array.from({ length: 9 }, (_, i) => [i, piece('PLAYER', i)])));
    const state = createTestState({ board: full });
    expect(card.canPlay?.({ state, caster: 'PLAYER', uid: 'x' })).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/*                                  DEMOLIR                                    */
/* -------------------------------------------------------------------------- */

describe('DEMOLIR (BREAK_PIECE) — regra confirmada: mantida sem mudança', () => {
  const card = getCard('BREAK_PIECE');

  it('destrói qualquer peça, inclusive a própria', () => {
    const state = createTestState({ board: boardWith({ 0: piece('PLAYER', 0) }) });
    const result = card.effect({ state, caster: 'PLAYER', uid: 'x', targetIndex: 0, rng });
    expect(result?.patch?.board?.[0]).toBeNull();
  });

  it('canPlay: indisponível com tabuleiro vazio', () => {
    const state = createTestState();
    expect(card.canPlay?.({ state, caster: 'PLAYER', uid: 'x' })).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/*                                  ESTUDAR                                    */
/* -------------------------------------------------------------------------- */

describe('ESTUDAR (STUDY) — mecânica idêntica; raridade subiu para ÉPICA (patch pós-Fase 7a)', () => {
  const card = getCard('STUDY');

  it('compra 2 cartas', () => {
    const state = createTestState();
    const result = card.effect({ state, caster: 'PLAYER', uid: 'x', rng });
    expect(result?.draw).toEqual({ target: 'PLAYER', count: 2 });
  });

  it('canPlay: indisponível com a mão cheia (HAND_LIMIT)', () => {
    const state = createTestState({
      playerHand: Array.from({ length: 5 }, (_, i) => ({ uid: `c${i}`, cardId: 'HEAL_SELF' as const })),
    });
    expect(card.canPlay?.({ state, caster: 'PLAYER', uid: 'x' })).toBe(false);
  });

  it('raridade ÉPICA, custo mantido em 2⚡', () => {
    expect(card.rarity).toBe('EPIC');
    expect(card.cost).toBe(2);
  });
});

/* -------------------------------------------------------------------------- */
/*                                ESTUDAR II                                   */
/* -------------------------------------------------------------------------- */

describe('ESTUDAR II (STUDY_II) — mecânica idêntica; raridade LENDÁRIA, custo 3 (patch pós-Fase 7a)', () => {
  const card = getCard('STUDY_II');

  it('compra 3 cartas', () => {
    const state = createTestState();
    const result = card.effect({ state, caster: 'PLAYER', uid: 'x', rng });
    expect(result?.draw).toEqual({ target: 'PLAYER', count: 3 });
  });

  it('canPlay: indisponível com a mão cheia', () => {
    const state = createTestState({
      playerHand: Array.from({ length: 5 }, (_, i) => ({ uid: `c${i}`, cardId: 'HEAL_SELF' as const })),
    });
    expect(card.canPlay?.({ state, caster: 'PLAYER', uid: 'x' })).toBe(false);
  });

  it('raridade LENDÁRIA, custo 3⚡', () => {
    expect(card.rarity).toBe('LEGENDARY');
    expect(card.cost).toBe(3);
  });
});

/* -------------------------------------------------------------------------- */
/*                                   ATAQUE                                    */
/* -------------------------------------------------------------------------- */

describe('ATAQUE (DIRECT_DAMAGE) — regra confirmada: mantida sem mudança', () => {
  it('causa 1 de dano ao oponente', () => {
    const state = createTestState();
    const result = getCard('DIRECT_DAMAGE').effect({ state, caster: 'PLAYER', uid: 'x', rng });
    expect(result?.damage).toEqual({ target: 'MACHINE', amount: 1 });
  });
});

/* -------------------------------------------------------------------------- */
/*                                    CURA                                     */
/* -------------------------------------------------------------------------- */

describe('CURA (HEAL_SELF) — regra confirmada: mantida sem mudança', () => {
  const card = getCard('HEAL_SELF');

  it('recupera 1 HP do próprio caster', () => {
    const state = createTestState({ playerHp: 3 });
    const result = card.effect({ state, caster: 'PLAYER', uid: 'x', rng });
    expect(result?.heal).toEqual({ target: 'PLAYER', amount: 1 });
  });

  it('canPlay: indisponível com HP já no teto', () => {
    const state = createTestState({ playerHp: 5 });
    expect(card.canPlay?.({ state, caster: 'PLAYER', uid: 'x' })).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/*                                TURNO EXTRA                                  */
/* -------------------------------------------------------------------------- */

describe('TURNO EXTRA (TURNO_EXTRA) — regra confirmada: renomeada, mecânica idêntica', () => {
  const card = getCard('TURNO_EXTRA');

  it('concede extraTurnPending pro próprio caster', () => {
    const state = createTestState();
    const result = card.effect({ caster: 'PLAYER', state, uid: 'x', rng });
    expect(result?.patch).toEqual({ extraTurnPending: 'PLAYER' });
  });

  it('canPlay: não empilha — falso se já pendente pro mesmo caster', () => {
    const state = createTestState({ extraTurnPending: 'PLAYER' });
    expect(card.canPlay?.({ state, caster: 'PLAYER', uid: 'x' })).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/*                                    MINA                                     */
/* -------------------------------------------------------------------------- */

describe('MINA (BOMB_TRAP) — dano rebaixado de 2 para 1 (patch pós-Fase 7a)', () => {
  const card = getCard('BOMB_TRAP');

  it('triggerCondition: dispara quando o oponente ocupa o centro', () => {
    const state = createTestState();
    expect(card.triggerCondition?.({ type: 'PIECE_PLACED', player: 'MACHINE', index: CENTER_INDEX }, state)).toBe(true);
    expect(card.triggerCondition?.({ type: 'PIECE_PLACED', player: 'MACHINE', index: 0 }, state)).toBe(false);
  });

  it('effect: 1 de dano no oponente e extraTurnPending pro defensor', () => {
    const state = createTestState();
    const result = card.effect({ state, caster: 'PLAYER', uid: 'x', rng });
    expect(result?.damage).toEqual({ target: 'MACHINE', amount: 1 });
    expect(result?.patch).toEqual({ extraTurnPending: 'PLAYER' });
  });
});

/* -------------------------------------------------------------------------- */
/*                                 PURIFICAR                                   */
/* -------------------------------------------------------------------------- */

describe('PURIFICAR (CLEANSE) — efeito alterado: 1 célula → tabuleiro inteiro', () => {
  const card = getCard('CLEANSE');

  it('limpa o bloqueio do caos E a trava da TRAVAR de uma vez, em células diferentes', () => {
    const state = createTestState({
      activeRule: 'BLOCKED_CELL',
      blockedCell: 1,
      ruleExpiresAtTurn: 9,
      lockedCell: 7,
      lockedCellExpiresAtTurn: 9,
    });
    const result = card.effect({ state, caster: 'PLAYER', uid: 'x', rng });
    expect(result?.patch).toMatchObject({
      activeRule: 'NORMAL',
      blockedCell: null,
      ruleExpiresAtTurn: null,
      lockedCell: null,
      lockedCellExpiresAtTurn: null,
    });
  });

  it('PURIFICAR: indisponível com tabuleiro limpo (confirmado — consistente com DEMOLIR sem peça e LIMPAR sem efeito ativo: nenhuma carta de tabuleiro é jogável sem alvo)', () => {
    const state = createTestState();
    expect(card.canPlay?.({ state, caster: 'PLAYER', uid: 'x' })).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/*                                  PROTEÇÃO                                   */
/* -------------------------------------------------------------------------- */

describe('PROTEÇÃO (SHIELD_TRAP) — regra confirmada: gatilho por categoria, não lista fixa', () => {
  const card = getCard('SHIELD_TRAP');
  const state = createTestState();

  it('dispara contra HAND_RAID (lê/retira da mão)', () => {
    expect(card.triggerCondition?.({ type: 'CARD_ABOUT_TO_RESOLVE', player: 'MACHINE', cardId: 'HAND_RAID' }, state)).toBe(true);
  });

  it('dispara contra SABOTAGE (lê/retira da mão)', () => {
    expect(card.triggerCondition?.({ type: 'CARD_ABOUT_TO_RESOLVE', player: 'MACHINE', cardId: 'SABOTAGE' }, state)).toBe(true);
  });

  it('dispara contra PEEK_RANDOM (lê da mão, categoria ampliada nesta fase)', () => {
    expect(card.triggerCondition?.({ type: 'CARD_ABOUT_TO_RESOLVE', player: 'MACHINE', cardId: 'PEEK_RANDOM' }, state)).toBe(true);
  });

  it('NÃO dispara contra DIRECT_DAMAGE (fora da categoria)', () => {
    expect(card.triggerCondition?.({ type: 'CARD_ABOUT_TO_RESOLVE', player: 'MACHINE', cardId: 'DIRECT_DAMAGE' }, state)).toBe(false);
  });

  it('cancela a carta do oponente ao disparar e nomeia a carta anulada no log (patch pós-Fase 7a)', () => {
    const result = card.effect({
      state,
      caster: 'PLAYER',
      uid: 'x',
      rng,
      event: { type: 'CARD_ABOUT_TO_RESOLVE', player: 'MACHINE', cardId: 'HAND_RAID' },
    });
    expect(result?.cancelsAction).toBe(true);
    expect(result?.log).toMatchObject({ code: 'TRAP_SHIELD', value: 'HAND_RAID' });
  });
});

/* -------------------------------------------------------------------------- */
/*                                  ANTIMAGIA                                  */
/* -------------------------------------------------------------------------- */

describe('ANTIMAGIA (ANTI_SPELL_TRAP) — carta nova: cobertura universal por exclusão de raridade', () => {
  const card = getCard('ANTI_SPELL_TRAP');
  const state = createTestState();

  it('dispara contra qualquer ação não-Lendária/Boom (ex: DIRECT_DAMAGE, EPIC)', () => {
    expect(card.triggerCondition?.({ type: 'CARD_ABOUT_TO_RESOLVE', player: 'MACHINE', cardId: 'DIRECT_DAMAGE' }, state)).toBe(true);
  });

  it('dispara contra o ARMAR de outra armadilha não-lendária (ex: SHIELD_TRAP)', () => {
    expect(card.triggerCondition?.({ type: 'CARD_ABOUT_TO_RESOLVE', player: 'MACHINE', cardId: 'SHIELD_TRAP' }, state)).toBe(true);
  });

  it('NÃO dispara contra carta Lendária (HAND_SWAP)', () => {
    expect(card.triggerCondition?.({ type: 'CARD_ABOUT_TO_RESOLVE', player: 'MACHINE', cardId: 'HAND_SWAP' }, state)).toBe(false);
  });

  it('NÃO dispara contra o armar/detonar da MINA (Lendária, imune por CLAUDE.md 4)', () => {
    expect(card.triggerCondition?.({ type: 'CARD_ABOUT_TO_RESOLVE', player: 'MACHINE', cardId: 'BOMB_TRAP' }, state)).toBe(false);
  });

  it('NÃO dispara contra carta Boom (CHAOS_ROULETTE)', () => {
    expect(card.triggerCondition?.({ type: 'CARD_ABOUT_TO_RESOLVE', player: 'MACHINE', cardId: 'CHAOS_ROULETTE' }, state)).toBe(false);
  });

  it('cancela a carta do oponente ao disparar e nomeia a carta anulada no log (patch pós-Fase 7a)', () => {
    const result = card.effect({
      state,
      caster: 'PLAYER',
      uid: 'x',
      rng,
      event: { type: 'CARD_ABOUT_TO_RESOLVE', player: 'MACHINE', cardId: 'DIRECT_DAMAGE' },
    });
    expect(result?.cancelsAction).toBe(true);
    expect(result?.log).toMatchObject({ code: 'TRAP_ANTI_SPELL', value: 'DIRECT_DAMAGE' });
  });
});

/* -------------------------------------------------------------------------- */
/*                                  RICOCHETE                                  */
/* -------------------------------------------------------------------------- */

describe('RICOCHETE (REFLECT_TRAP) — carta nova: inverte quando bem definido, senão só anula', () => {
  const card = getCard('REFLECT_TRAP');
  const state = createTestState();

  it('dispara contra efeitos direcionados ao oponente (targetsOpponentResource)', () => {
    expect(card.triggerCondition?.({ type: 'CARD_ABOUT_TO_RESOLVE', player: 'MACHINE', cardId: 'DIRECT_DAMAGE' }, state)).toBe(true);
    expect(card.triggerCondition?.({ type: 'CARD_ABOUT_TO_RESOLVE', player: 'MACHINE', cardId: 'HAND_RAID' }, state)).toBe(true);
    expect(card.triggerCondition?.({ type: 'CARD_ABOUT_TO_RESOLVE', player: 'MACHINE', cardId: 'OBSOLESCENCE' }, state)).toBe(true);
    expect(card.triggerCondition?.({ type: 'CARD_ABOUT_TO_RESOLVE', player: 'MACHINE', cardId: 'QUEUE_SHUFFLE' }, state)).toBe(true);
  });

  it('NÃO dispara contra efeito não direcionado ao oponente (ex: STUDY)', () => {
    expect(card.triggerCondition?.({ type: 'CARD_ABOUT_TO_RESOLVE', player: 'MACHINE', cardId: 'STUDY' }, state)).toBe(false);
  });

  it('inverte DIRECT_DAMAGE — dano atinge o próprio atacante, e nomeia a carta no log (patch pós-Fase 7a)', () => {
    const result = card.effect({
      state,
      caster: 'PLAYER',
      uid: 'x',
      rng,
      event: { type: 'CARD_ABOUT_TO_RESOLVE', player: 'MACHINE', cardId: 'DIRECT_DAMAGE' },
    });
    expect(result?.cancelsAction).toBe(true);
    expect(result?.damage).toEqual({ target: 'MACHINE', amount: 1 });
    expect(result?.log).toMatchObject({ code: 'TRAP_RICOCHET', value: 'DIRECT_DAMAGE' });
  });

  it('inverte HAND_RAID — rouba 1 carta do atacante para o defensor, sem repetir o RNG da carta original', () => {
    const raidState = createTestState({ machineHand: [{ uid: 'm1', cardId: 'HEAL_SELF' }] });
    const result = card.effect({
      state: raidState,
      caster: 'PLAYER',
      uid: 'x',
      rng,
      event: { type: 'CARD_ABOUT_TO_RESOLVE', player: 'MACHINE', cardId: 'HAND_RAID' },
    });
    expect(result?.patch?.playerHand).toEqual([{ uid: 'm1', cardId: 'HEAL_SELF' }]);
    expect(result?.patch?.machineHand).toEqual([]);
  });

  it('OBSOLESCENCE/QUEUE_SHUFFLE: sem inversor registrado, só anula (fallback da spec)', () => {
    const result = card.effect({
      state,
      caster: 'PLAYER',
      uid: 'x',
      rng,
      event: { type: 'CARD_ABOUT_TO_RESOLVE', player: 'MACHINE', cardId: 'OBSOLESCENCE' },
    });
    expect(result?.cancelsAction).toBe(true);
    expect(result?.patch).toBeUndefined();
    expect(result?.damage).toBeUndefined();
  });

  it('inverte APAGÃO (carta nova, patch pós-Fase 7a) — a energia de quem lançou zera, não a do defensor', () => {
    const blackoutState = createTestState({ playerEnergy: 3, machineEnergy: 1 });
    const result = card.effect({
      state: blackoutState,
      caster: 'PLAYER',
      uid: 'x',
      rng,
      event: { type: 'CARD_ABOUT_TO_RESOLVE', player: 'MACHINE', cardId: 'BLACKOUT' },
    });
    expect(result?.cancelsAction).toBe(true);
    expect(result?.energyDrain).toEqual({ target: 'MACHINE', amount: 1 });
  });
});

/* -------------------------------------------------------------------------- */
/*                                   VIDENTE                                   */
/* -------------------------------------------------------------------------- */

describe('VIDENTE (HIGHLIGHT_OLDEST) — leitura pura; canPlay agora exige >=3 peças do oponente (patch pós-Fase 7a)', () => {
  const card = getCard('HIGHLIGHT_OLDEST');

  it('destaca a peça mais antiga (por turnPlaced) entre 3 peças do oponente', () => {
    const state = createTestState({
      board: boardWith({ 0: piece('MACHINE', 5), 1: piece('MACHINE', 2), 2: piece('MACHINE', 8) }),
    });
    const result = card.effect({ state, caster: 'PLAYER', uid: 'x', rng });
    expect(result?.log).toMatchObject({ code: 'CARD_HIGHLIGHT_OLDEST', subject: 'PLAYER', target: 'MACHINE', value: 1 });
    expect(result?.patch).toEqual({
      highlightedOldestFor: { caster: 'PLAYER', owner: 'MACHINE', index: 1, turnPlaced: 2 },
    });
  });

  it('canPlay: indisponível com o oponente sem peça nenhuma', () => {
    const state = createTestState();
    expect(card.canPlay?.({ state, caster: 'PLAYER', uid: 'x' })).toBe(false);
  });

  it('canPlay: indisponível com o oponente tendo só 1-2 peças (patch pós-Fase 7a — antes bastava >=1)', () => {
    const state = createTestState({ board: boardWith({ 0: piece('MACHINE', 0), 1: piece('MACHINE', 1) }) });
    expect(card.canPlay?.({ state, caster: 'PLAYER', uid: 'x' })).toBe(false);
  });

  it('canPlay: disponível com o oponente tendo 3 peças', () => {
    const state = createTestState({
      board: boardWith({ 0: piece('MACHINE', 0), 1: piece('MACHINE', 1), 2: piece('MACHINE', 2) }),
    });
    expect(card.canPlay?.({ state, caster: 'PLAYER', uid: 'x' })).toBe(true);
  });

  it('AMALDIÇOAR ativo: revela o índice MARCADO, não o mais velho por turnPlaced (patch pós-Fase 7a)', () => {
    const state = createTestState({
      board: boardWith({ 0: piece('MACHINE', 1), 1: piece('MACHINE', 2), 2: piece('MACHINE', 3) }),
      // A mais velha por turnPlaced seria o índice 0 — mas AMALDIÇOAR marcou o índice 2.
      forcedVanish: { owner: 'MACHINE', mode: 'CHOSEN', index: 2, turnPlaced: 3 },
    });
    const result = card.effect({ state, caster: 'PLAYER', uid: 'x', rng });
    expect(result?.patch?.highlightedOldestFor).toMatchObject({ index: 2, turnPlaced: 3 });
  });

  it('RANDOM_FADE ativo: a previsão bate com getVanishingIndex e o canal BOARD não é consumido de verdade (patch pós-Fase 7a)', () => {
    const board = boardWith({ 0: piece('MACHINE', 0), 1: piece('MACHINE', 1), 2: piece('MACHINE', 2) });
    const state = createTestState({ board, activeRule: 'RANDOM_FADE' });

    // A previsão do VIDENTE precisa bater com o índice que getVanishingIndex
    // (rules.ts) escolheria de verdade, consumindo o MESMO canal BOARD, na
    // MESMA seed — ou a "espiada" estaria mentindo.
    seedMatch(42);
    const expectedIndex = getVanishingIndex(board, 'MACHINE', 'RANDOM_FADE', null);

    seedMatch(42); // reseta pro mesmo ponto de antes do pick acima
    const cursorBefore = getChannel('BOARD').getState();
    const result = card.effect({ state, caster: 'PLAYER', uid: 'x', rng });
    const cursorAfter = getChannel('BOARD').getState();

    expect(result?.patch?.highlightedOldestFor?.index).toBe(expectedIndex);
    // O canal BOARD precisa continuar EXATAMENTE onde estava antes do peek —
    // a próxima remoção "de verdade" não pode ver o efeito da espiada.
    expect(cursorAfter).toBe(cursorBefore);
  });
});

/* -------------------------------------------------------------------------- */
/*                                  ANOMALIA                                   */
/* -------------------------------------------------------------------------- */

describe('ANOMALIA (QUEUE_SHUFFLE) — carta nova: força a próxima peça do oponente a sumir aleatoriamente', () => {
  const card = getCard('QUEUE_SHUFFLE');

  it('marca forcedVanish RANDOM pro oponente', () => {
    const state = createTestState();
    const result = card.effect({ state, caster: 'PLAYER', uid: 'x', rng });
    expect(result?.patch).toEqual({ forcedVanish: { owner: 'MACHINE', mode: 'RANDOM' } });
  });

  it('sem canPlay — jogável mesmo com o oponente sem peça nenhuma ainda (presunção, não confirmado pela spec)', () => {
    expect(card.canPlay).toBeUndefined();
  });
});

/* -------------------------------------------------------------------------- */
/*                                OBSOLESCÊNCIA                                */
/* -------------------------------------------------------------------------- */

describe('AMALDIÇOAR (id OBSOLESCENCE, renomeada no patch pós-Fase 7a) — força posição na fila, sem revelar o alvo no log', () => {
  const card = getCard('OBSOLESCENCE');

  it('nome exibido é AMALDIÇOAR', () => {
    expect(card.name).toBe('AMALDIÇOAR');
  });

  it('marca forcedVanish CHOSEN com o índice e turnPlaced da peça alvo, sem `value` no log/notice (não revela o alvo)', () => {
    const state = createTestState({
      board: boardWith({ 0: piece('MACHINE', 0), 1: piece('MACHINE', 1), 4: piece('MACHINE', 7) }),
    });
    const result = card.effect({ state, caster: 'PLAYER', uid: 'x', targetIndex: 4, rng });
    expect(result?.patch).toEqual({
      forcedVanish: { owner: 'MACHINE', mode: 'CHOSEN', index: 4, turnPlaced: 7 },
    });
    expect(result?.log?.value).toBeUndefined();
    expect(result?.notice?.value).toBeUndefined();
  });

  it('canPlay: indisponível com o oponente sem peça nenhuma', () => {
    const state = createTestState();
    expect(card.canPlay?.({ state, caster: 'PLAYER', uid: 'x' })).toBe(false);
  });

  it('canPlay: indisponível com o oponente tendo só 1-2 peças (patch pós-Fase 7a — antes bastava >=1)', () => {
    const state = createTestState({ board: boardWith({ 0: piece('MACHINE', 0), 1: piece('MACHINE', 1) }) });
    expect(card.canPlay?.({ state, caster: 'PLAYER', uid: 'x' })).toBe(false);
  });

  it('canPlay: disponível com o oponente tendo 3 peças', () => {
    const state = createTestState({
      board: boardWith({ 0: piece('MACHINE', 0), 1: piece('MACHINE', 1), 2: piece('MACHINE', 2) }),
    });
    expect(card.canPlay?.({ state, caster: 'PLAYER', uid: 'x' })).toBe(true);
  });

  it('isValidTarget: só peça do oponente', () => {
    const state = createTestState({ board: boardWith({ 0: piece('PLAYER', 0), 1: piece('MACHINE', 0) }) });
    expect(card.isValidTarget?.({ state, caster: 'PLAYER', index: 0 })).toBe(false);
    expect(card.isValidTarget?.({ state, caster: 'PLAYER', index: 1 })).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/*                     forcedVanish — único por partida (decisão)              */
/* -------------------------------------------------------------------------- */

describe('forcedVanish — a marcação mais recente vence, decisão registrada no plano', () => {
  it('ANOMALIA depois de OBSOLESCÊNCIA: RANDOM sobrescreve o CHOSEN anterior', () => {
    const state = createTestState({
      forcedVanish: { owner: 'MACHINE', mode: 'CHOSEN', index: 3, turnPlaced: 1 },
    });
    const result = getCard('QUEUE_SHUFFLE').effect({ state, caster: 'PLAYER', uid: 'x', rng });
    expect(result?.patch).toEqual({ forcedVanish: { owner: 'MACHINE', mode: 'RANDOM' } });
  });

  it('OBSOLESCÊNCIA depois de ANOMALIA: CHOSEN sobrescreve o RANDOM anterior', () => {
    const state = createTestState({
      forcedVanish: { owner: 'MACHINE', mode: 'RANDOM' },
      board: boardWith({ 6: piece('MACHINE', 9) }),
    });
    const result = getCard('OBSOLESCENCE').effect({ state, caster: 'PLAYER', uid: 'x', targetIndex: 6, rng });
    expect(result?.patch).toEqual({
      forcedVanish: { owner: 'MACHINE', mode: 'CHOSEN', index: 6, turnPlaced: 9 },
    });
  });
});

/* -------------------------------------------------------------------------- */
/*                               PERMUTA CAÓTICA                               */
/* -------------------------------------------------------------------------- */

describe('PERMUTA CAÓTICA (HAND_SWAP) — efeito alterado: 1 carta aleatória → mão inteira', () => {
  const card = getCard('HAND_SWAP');

  it('troca as mãos inteiras, excluindo a própria carta jogada do lado do caster', () => {
    const state = createTestState({
      playerHand: [
        { uid: 'played', cardId: 'HAND_SWAP' },
        { uid: 'p1', cardId: 'HEAL_SELF' },
      ],
      machineHand: [{ uid: 'm1', cardId: 'DIRECT_DAMAGE' }],
    });
    const result = card.effect({ state, caster: 'PLAYER', uid: 'played', rng });
    expect(result?.patch?.playerHand).toEqual([{ uid: 'm1', cardId: 'DIRECT_DAMAGE' }]);
    expect(result?.patch?.machineHand).toEqual([{ uid: 'p1', cardId: 'HEAL_SELF' }]);
  });

  it('sem canPlay — troca ocorre mesmo com a mão do oponente vazia (decisão já registrada em docs/CARTAS.md)', () => {
    expect(card.canPlay).toBeUndefined();
  });
});

/* -------------------------------------------------------------------------- */
/*                                  REBOBINAR                                  */
/* -------------------------------------------------------------------------- */

describe('REBOBINAR — carta nova (Fase 2.5): bloqueia colocação do oponente, resto do turno normal', () => {
  const card = getCard('REBOBINAR');

  it('marca a flag de bloqueio do OPONENTE, sem tocar a do próprio caster', () => {
    const state = createTestState();
    const result = card.effect({ state, caster: 'PLAYER', uid: 'x', rng });
    expect(result?.patch).toEqual({ machinePlacementBlocked: true });
  });

  it('funciona nos dois sentidos — MACHINE mirando PLAYER bloqueia playerPlacementBlocked', () => {
    const state = createTestState();
    const result = card.effect({ state, caster: 'MACHINE', uid: 'x', rng });
    expect(result?.patch).toEqual({ playerPlacementBlocked: true });
  });

  it('sem canPlay — sempre jogável, mesmo recarimbando um alvo já bloqueado (dois turnos seguidos é jogada legítima, não desperdício a evitar)', () => {
    expect(card.canPlay).toBeUndefined();

    const alreadyBlocked = createTestState({ machinePlacementBlocked: true });
    const result = card.effect({ state: alreadyBlocked, caster: 'PLAYER', uid: 'x', rng });
    expect(result?.patch).toEqual({ machinePlacementBlocked: true });
  });

  it('sem canPlay — jogável mesmo com o PRÓPRIO caster bloqueado (jogar aqui não desbloqueia quem joga)', () => {
    const casterBlocked = createTestState({ playerPlacementBlocked: true });
    const result = card.effect({ state: casterBlocked, caster: 'PLAYER', uid: 'x', rng });
    // O efeito só toca a flag do OPONENTE — a do próprio caster não está no
    // patch, então ela continua `true` até o caster terminar o próprio turno.
    expect(result?.patch).toEqual({ machinePlacementBlocked: true });
    expect(result?.patch).not.toHaveProperty('playerPlacementBlocked');
  });
});

/* -------------------------------------------------------------------------- */
/*                    FASE 4 — CARTAS COM INTERAÇÃO (carta real)               */
/* -------------------------------------------------------------------------- */
/* `card.effect()` chamado diretamente, duas vezes (como `resolveCardPlay`/
   `resolveInteraction` já fazem): 1ª chamada sem `interaction` (abre), 2ª com
   `interaction` preenchido (resolve). O clamp de `count`/a orquestração de
   `pendingInteraction` em si são responsabilidade do STORE (Fase 3), testados
   à parte em `pendingInteraction.test.ts`/`gameStore.test.ts` — aqui só a
   LÓGICA da carta. */

describe('SABOTAGEM (SABOTAGE) — escolha manual, substitui o rng.pick de antes', () => {
  const card = getCard('SABOTAGE');

  it('abre PICK_ONE_FROM_HAND com a mão oculta do oponente', () => {
    const state = createTestState({
      machineHand: [
        { uid: 'm1', cardId: 'HEAL_SELF' },
        { uid: 'm2', cardId: 'DIRECT_DAMAGE' },
      ],
    });
    const result = card.effect({ state, caster: 'PLAYER', uid: 'x', rng });
    expect(result?.interaction).toEqual({
      kind: 'PICK_ONE_FROM_HAND',
      source: 'MACHINE',
      optionUids: ['m1', 'm2'],
    });
  });

  it('canPlay: indisponível com a mão do oponente vazia', () => {
    const state = createTestState();
    expect(card.canPlay?.({ state, caster: 'PLAYER', uid: 'x' })).toBe(false);
  });

  it('resolve: descarta a carta escolhida e revela a identidade via acknowledge (humano)', () => {
    const state = createTestState({
      machineHand: [
        { uid: 'm1', cardId: 'HEAL_SELF' },
        { uid: 'm2', cardId: 'DIRECT_DAMAGE' },
      ],
    });
    const result = card.effect({
      state,
      caster: 'PLAYER',
      uid: 'x',
      rng,
      interaction: { selection: { kind: 'PICK_ONE_FROM_HAND', uid: 'm2' }, priorSelections: [] },
    });
    expect(result?.patch).toEqual({ machineHand: [{ uid: 'm1', cardId: 'HEAL_SELF' }] });
    expect(result?.log).toMatchObject({ code: 'CARD_SPY_DISCARD', value: 'DIRECT_DAMAGE' });
    expect(result?.acknowledge).toMatchObject({ code: 'HAND_REVEALED', cardId: 'DIRECT_DAMAGE' });
  });

  it('resolve: sem acknowledge quando quem joga é a CPU (offline)', () => {
    const state = createTestState({ machineHand: [], playerHand: [{ uid: 'p1', cardId: 'HEAL_SELF' }] });
    const result = card.effect({
      state,
      caster: 'MACHINE',
      uid: 'x',
      rng,
      interaction: { selection: { kind: 'PICK_ONE_FROM_HAND', uid: 'p1' }, priorSelections: [] },
    });
    expect(result?.acknowledge).toBeUndefined();
  });

  it('resolve: uid inexistente na mão devolve null (passo inválido)', () => {
    const state = createTestState({ machineHand: [{ uid: 'm1', cardId: 'HEAL_SELF' }] });
    const result = card.effect({
      state,
      caster: 'PLAYER',
      uid: 'x',
      rng,
      interaction: { selection: { kind: 'PICK_ONE_FROM_HAND', uid: 'fantasma' }, priorSelections: [] },
    });
    expect(result).toBeNull();
  });
});

describe('ESPIADA (PEEK_RANDOM) — escolha manual, substitui o rng.pick de antes', () => {
  const card = getCard('PEEK_RANDOM');

  it('abre PICK_ONE_FROM_HAND com a mão oculta do oponente', () => {
    const state = createTestState({ machineHand: [{ uid: 'm1', cardId: 'HEAL_SELF' }] });
    const result = card.effect({ state, caster: 'PLAYER', uid: 'x', rng });
    expect(result?.interaction).toEqual({
      kind: 'PICK_ONE_FROM_HAND',
      source: 'MACHINE',
      optionUids: ['m1'],
    });
  });

  it('canPlay: indisponível com a mão do oponente vazia', () => {
    const state = createTestState();
    expect(card.canPlay?.({ state, caster: 'PLAYER', uid: 'x' })).toBe(false);
  });

  it('resolve: marca o uid espiado como revelado, sem remover nada da mão', () => {
    const state = createTestState({ machineHand: [{ uid: 'm1', cardId: 'HEAL_SELF' }] });
    const result = card.effect({
      state,
      caster: 'PLAYER',
      uid: 'x',
      rng,
      interaction: { selection: { kind: 'PICK_ONE_FROM_HAND', uid: 'm1' }, priorSelections: [] },
    });
    expect(result?.patch).toEqual({ machineRevealedUids: ['m1'] });
    expect(result?.log).toMatchObject({ code: 'CARD_SPY_PEEK', value: 'HEAL_SELF' });
  });

  it('resolve: uid já revelado não recria o array (dedupe)', () => {
    const state = createTestState({
      machineHand: [{ uid: 'm1', cardId: 'HEAL_SELF' }],
      machineRevealedUids: ['m1'],
    });
    const result = card.effect({
      state,
      caster: 'PLAYER',
      uid: 'x',
      rng,
      interaction: { selection: { kind: 'PICK_ONE_FROM_HAND', uid: 'm1' }, priorSelections: [] },
    });
    expect(result?.patch).toEqual({});
  });
});

describe('SAQUE (HAND_RAID) — falha agora destrói; sucesso abre escolha manual', () => {
  const card = getCard('HAND_RAID');

  it('canPlay: indisponível com a mão do oponente vazia', () => {
    const state = createTestState();
    expect(card.canPlay?.({ state, caster: 'PLAYER', uid: 'x' })).toBe(false);
  });

  it('falha (50%): destrói 1 carta aleatória do oponente (efeito alterado — antes era no-op)', () => {
    const state = createTestState({ machineHand: [{ uid: 'm1', cardId: 'HEAL_SELF' }] });
    const result = card.effect({
      state,
      caster: 'PLAYER',
      uid: 'x',
      rng: fixedRng({ chance: () => false, pick: (items) => items[0] }),
    });
    expect(result?.patch).toEqual({ machineHand: [] });
    expect(result?.log).toMatchObject({ code: 'CARD_RAID_DESTROYED', value: 'HEAL_SELF' });
  });

  it('sucesso (50%): abre PICK_ONE_FROM_HAND em vez de sortear', () => {
    const state = createTestState({ machineHand: [{ uid: 'm1', cardId: 'HEAL_SELF' }] });
    const result = card.effect({
      state,
      caster: 'PLAYER',
      uid: 'x',
      rng: fixedRng({ chance: () => true }),
    });
    expect(result?.interaction).toEqual({
      kind: 'PICK_ONE_FROM_HAND',
      source: 'MACHINE',
      optionUids: ['m1'],
    });
  });

  it('resolve: rouba a carta escolhida MANTENDO o uid (decisão da Fase 4 — sem ressurreição cortada)', () => {
    const state = createTestState({
      playerHand: [], // a própria carta SAQUE já saiu da mão ao abrir a interação
      machineHand: [{ uid: 'm1', cardId: 'HEAL_SELF' }],
    });
    const result = card.effect({
      state,
      caster: 'PLAYER',
      uid: 'saque',
      rng,
      interaction: { selection: { kind: 'PICK_ONE_FROM_HAND', uid: 'm1' }, priorSelections: [] },
    });
    expect(result?.patch).toEqual({
      playerHand: [{ uid: 'm1', cardId: 'HEAL_SELF' }],
      machineHand: [],
    });
    expect(result?.log).toMatchObject({ code: 'CARD_RAID_STOLE', value: 'HEAL_SELF' });
  });
});

describe('SAQUE II (HAND_RAID_II) — mesmo formato de SAQUE, odds 25/75', () => {
  const card = getCard('HAND_RAID_II');

  it('custo 3⚡, raridade ÉPICA (SAQUE é 2⚡/RARA)', () => {
    expect(card.cost).toBe(3);
    expect(card.rarity).toBe('EPIC');
  });

  it('falha (25%): destrói 1 carta aleatória do oponente', () => {
    const state = createTestState({ machineHand: [{ uid: 'm1', cardId: 'HEAL_SELF' }] });
    const result = card.effect({
      state,
      caster: 'PLAYER',
      uid: 'x',
      rng: fixedRng({ chance: () => false, pick: (items) => items[0] }),
    });
    expect(result?.log).toMatchObject({ code: 'CARD_RAID_DESTROYED' });
  });

  it('sucesso (75%): abre PICK_ONE_FROM_HAND', () => {
    const state = createTestState({ machineHand: [{ uid: 'm1', cardId: 'HEAL_SELF' }] });
    const result = card.effect({
      state,
      caster: 'PLAYER',
      uid: 'x',
      rng: fixedRng({ chance: () => true }),
    });
    expect(result?.interaction).toMatchObject({ kind: 'PICK_ONE_FROM_HAND' });
  });

  it('RICOCHETE rouba de graça (mesma inversão de HAND_RAID, entrada própria na tabela)', () => {
    // Prova indireta: se a carta não tivesse entrada em RICOCHET_INVERSIONS,
    // a cobertura completa está em gameStore.test.ts (ponta a ponta, com trap
    // armada) — este teste só confirma que a carta é elegível (readsOrRemovesFromHand
    // + targetsOpponentResource), pré-requisito pro trigger de PROTEÇÃO/RICOCHETE.
    expect(card.readsOrRemovesFromHand).toBe(true);
    expect(card.targetsOpponentResource).toBe(true);
  });
});

describe('TROCAR (SINGLE_CARD_TRADE) — encadeamento de 2 passos com carta real', () => {
  const card = getCard('SINGLE_CARD_TRADE');

  it('canPlay: indisponível sem outra carta própria além da TROCAR', () => {
    const state = createTestState({
      playerHand: [{ uid: 't', cardId: 'SINGLE_CARD_TRADE' }],
      machineHand: [{ uid: 'm1', cardId: 'HEAL_SELF' }],
    });
    expect(card.canPlay?.({ state, caster: 'PLAYER', uid: 't' })).toBe(false);
  });

  it('canPlay: indisponível com a mão do oponente vazia', () => {
    const state = createTestState({
      playerHand: [
        { uid: 't', cardId: 'SINGLE_CARD_TRADE' },
        { uid: 'o', cardId: 'HEAL_SELF' },
      ],
    });
    expect(card.canPlay?.({ state, caster: 'PLAYER', uid: 't' })).toBe(false);
  });

  it('passo 1: oferece a mão PRÓPRIA, excluindo a própria TROCAR', () => {
    const state = createTestState({
      playerHand: [
        { uid: 't', cardId: 'SINGLE_CARD_TRADE' },
        { uid: 'o', cardId: 'HEAL_SELF' },
      ],
      machineHand: [{ uid: 'm1', cardId: 'DIRECT_DAMAGE' }],
    });
    const result = card.effect({ state, caster: 'PLAYER', uid: 't', rng });
    expect(result?.interaction).toEqual({
      kind: 'PICK_ONE_FROM_HAND',
      source: 'PLAYER',
      optionUids: ['o'],
    });
  });

  it('passo 2: pede a mão OCULTA do oponente', () => {
    const state = createTestState({
      playerHand: [{ uid: 'o', cardId: 'HEAL_SELF' }], // a TROCAR já saiu ao abrir
      machineHand: [{ uid: 'm1', cardId: 'DIRECT_DAMAGE' }],
    });
    const result = card.effect({
      state,
      caster: 'PLAYER',
      uid: 't',
      rng,
      interaction: {
        selection: { kind: 'PICK_ONE_FROM_HAND', uid: 'o' },
        priorSelections: [],
      },
    });
    expect(result?.interaction).toEqual({
      kind: 'PICK_ONE_FROM_HAND',
      source: 'MACHINE',
      optionUids: ['m1'],
    });
  });

  it('passo 3: troca as duas cartas escolhidas, mantendo os uids', () => {
    const state = createTestState({
      playerHand: [{ uid: 'o', cardId: 'HEAL_SELF' }],
      machineHand: [{ uid: 'm1', cardId: 'DIRECT_DAMAGE' }],
    });
    const result = card.effect({
      state,
      caster: 'PLAYER',
      uid: 't',
      rng,
      interaction: {
        selection: { kind: 'PICK_ONE_FROM_HAND', uid: 'm1' },
        priorSelections: [{ kind: 'PICK_ONE_FROM_HAND', uid: 'o' }],
      },
    });
    expect(result?.patch).toEqual({
      playerHand: [{ uid: 'm1', cardId: 'DIRECT_DAMAGE' }],
      machineHand: [{ uid: 'o', cardId: 'HEAL_SELF' }],
    });
    expect(result?.log).toMatchObject({ code: 'CARD_SINGLE_TRADE', value: 'DIRECT_DAMAGE' });
  });

  it('passo 3: uid oferecido ou recebido inexistente devolve null', () => {
    const state = createTestState({
      playerHand: [{ uid: 'o', cardId: 'HEAL_SELF' }],
      machineHand: [{ uid: 'm1', cardId: 'DIRECT_DAMAGE' }],
    });
    const result = card.effect({
      state,
      caster: 'PLAYER',
      uid: 't',
      rng,
      interaction: {
        selection: { kind: 'PICK_ONE_FROM_HAND', uid: 'fantasma' },
        priorSelections: [{ kind: 'PICK_ONE_FROM_HAND', uid: 'o' }],
      },
    });
    expect(result).toBeNull();
  });
});

describe('ALTAR DE SACRIFÍCIO (ALTAR_OF_SACRIFICE) — SACRIFICE_DRAG, fusão de raridade + invocação (Fase 6b)', () => {
  const card = getCard('ALTAR_OF_SACRIFICE');

  it('raridade LENDÁRIA, custo 1⚡ (patch pós-Fase 7a — antes BOOM/0⚡)', () => {
    expect(card.rarity).toBe('LEGENDARY');
    expect(card.cost).toBe(1);
  });

  it('canPlay: indisponível com menos de 2 outras cartas na mão', () => {
    const state = createTestState({
      playerHand: [
        { uid: 'altar', cardId: 'ALTAR_OF_SACRIFICE' },
        { uid: 'o1', cardId: 'HEAL_SELF' },
      ],
    });
    expect(card.canPlay?.({ state, caster: 'PLAYER', uid: 'altar' })).toBe(false);
  });

  it('canPlay: disponível com exatamente 2 outras cartas na mão', () => {
    const state = createTestState({
      playerHand: [
        { uid: 'altar', cardId: 'ALTAR_OF_SACRIFICE' },
        { uid: 'o1', cardId: 'HEAL_SELF' },
        { uid: 'o2', cardId: 'DIRECT_DAMAGE' },
      ],
    });
    expect(card.canPlay?.({ state, caster: 'PLAYER', uid: 'altar' })).toBe(true);
  });

  it('abre SACRIFICE_DRAG com as uids da mão menos o próprio Altar, count 2', () => {
    const state = createTestState({
      playerHand: [
        { uid: 'altar', cardId: 'ALTAR_OF_SACRIFICE' },
        { uid: 'o1', cardId: 'HEAL_SELF' },
        { uid: 'o2', cardId: 'DIRECT_DAMAGE' },
      ],
    });
    const result = card.effect({ state, caster: 'PLAYER', uid: 'altar', rng });
    expect(result?.interaction).toEqual({
      kind: 'SACRIFICE_DRAG',
      eligibleUids: ['o1', 'o2'],
      count: 2,
    });
  });

  it('resolve: funde 2 cartas da MESMA raridade (COMMON+COMMON -> RARE), remove as 2 e o Altar não sobra', () => {
    // O Altar já saiu da mão ao ABRIR a interação (timing unificado da Fase
    // 3) — por isso não aparece aqui, igual ao passo 2/3 de TROCAR acima.
    const state = createTestState({
      playerHand: [
        { uid: 'o1', cardId: 'CLEAR_BLOCK' }, // COMMON
        { uid: 'o2', cardId: 'LOCK_CELL' }, // COMMON
      ],
      nextCardUid: 5,
    });
    const result = card.effect({
      state,
      caster: 'PLAYER',
      uid: 'altar',
      rng,
      interaction: { selection: { kind: 'SACRIFICE_DRAG', uids: ['o1', 'o2'] }, priorSelections: [] },
    });

    expect(result?.patch?.nextCardUid).toBe(6);
    const hand = result?.patch?.playerHand as { uid: string; cardId: string }[];
    expect(hand).toHaveLength(1);
    expect(hand[0].uid).toBe(`${hand[0].cardId}#5`);
    expect(getCard(hand[0].cardId as Parameters<typeof getCard>[0]).rarity).toBe('RARE');
    expect(result?.log).toMatchObject({ code: 'CARD_ALTAR_INVOKED', value: hand[0].cardId });
    expect(result?.notice).toMatchObject({ code: 'CARD_ALTAR_INVOKED', value: hand[0].cardId });
  });

  it('resolve: funde 2 raridades diferentes (COMMON+LEGENDARY -> min(COMMON,LEGENDARY)+1 = RARE)', () => {
    const state = createTestState({
      playerHand: [
        { uid: 'o1', cardId: 'CLEAR_BLOCK' }, // COMMON
        { uid: 'o2', cardId: 'FULL_INTEL' }, // LEGENDARY
      ],
      nextCardUid: 0,
    });
    const result = card.effect({
      state,
      caster: 'PLAYER',
      uid: 'altar',
      rng,
      interaction: { selection: { kind: 'SACRIFICE_DRAG', uids: ['o1', 'o2'] }, priorSelections: [] },
    });

    const hand = result?.patch?.playerHand as { uid: string; cardId: string }[];
    expect(getCard(hand[0].cardId as Parameters<typeof getCard>[0]).rarity).toBe('RARE');
  });

  it('resolve: funde LEGENDARY + LEGENDARY -> BOOM (caso de borda nomeado em CLAUDE.md #5)', () => {
    const state = createTestState({
      playerHand: [
        { uid: 'o1', cardId: 'FULL_INTEL' }, // LEGENDARY
        { uid: 'o2', cardId: 'HAND_SWAP' }, // LEGENDARY
      ],
      nextCardUid: 0,
    });
    const result = card.effect({
      state,
      caster: 'PLAYER',
      uid: 'altar',
      rng,
      interaction: { selection: { kind: 'SACRIFICE_DRAG', uids: ['o1', 'o2'] }, priorSelections: [] },
    });

    const hand = result?.patch?.playerHand as { uid: string; cardId: string }[];
    expect(getCard(hand[0].cardId as Parameters<typeof getCard>[0]).rarity).toBe('BOOM');
  });

  it('resolve: BOOM + BOOM devolve null (patch pós-Fase 7a — não é mais um ritual válido)', () => {
    const state = createTestState({
      playerHand: [
        { uid: 'o1', cardId: 'CHAOS_ROULETTE' }, // BOOM
        { uid: 'o2', cardId: 'CHAOS_ROULETTE' }, // BOOM
      ],
    });
    const result = card.effect({
      state,
      caster: 'PLAYER',
      uid: 'altar',
      rng,
      interaction: { selection: { kind: 'SACRIFICE_DRAG', uids: ['o1', 'o2'] }, priorSelections: [] },
    });
    expect(result).toBeNull();
  });

  it('resolve: uid inexistente devolve null (mesma defesa de TROCAR)', () => {
    const state = createTestState({
      playerHand: [
        { uid: 'o1', cardId: 'HEAL_SELF' },
        { uid: 'o2', cardId: 'DIRECT_DAMAGE' },
      ],
    });
    const result = card.effect({
      state,
      caster: 'PLAYER',
      uid: 'altar',
      rng,
      interaction: { selection: { kind: 'SACRIFICE_DRAG', uids: ['o1', 'fantasma'] }, priorSelections: [] },
    });
    expect(result).toBeNull();
  });

  it('resolve: as 2 uids da seleção iguais devolve null (não pode sacrificar a mesma carta 2x)', () => {
    const state = createTestState({
      playerHand: [
        { uid: 'o1', cardId: 'HEAL_SELF' },
        { uid: 'o2', cardId: 'DIRECT_DAMAGE' },
      ],
    });
    const result = card.effect({
      state,
      caster: 'PLAYER',
      uid: 'altar',
      rng,
      interaction: { selection: { kind: 'SACRIFICE_DRAG', uids: ['o1', 'o1'] }, priorSelections: [] },
    });
    expect(result).toBeNull();
  });

  it('determinismo: a mesma seed sorteia a mesma carta invocada', () => {
    const state = createTestState({
      playerHand: [
        { uid: 'o1', cardId: 'CLEAR_BLOCK' },
        { uid: 'o2', cardId: 'LOCK_CELL' },
      ],
      nextCardUid: 0,
    });
    const interaction = {
      selection: { kind: 'SACRIFICE_DRAG' as const, uids: ['o1', 'o2'] as const },
      priorSelections: [],
    };

    const resultA = card.effect({ state, caster: 'PLAYER', uid: 'altar', rng: createRng(42), interaction });
    const resultB = card.effect({ state, caster: 'PLAYER', uid: 'altar', rng: createRng(42), interaction });

    expect(resultA?.log).toEqual(resultB?.log);
  });
});

describe('ESPIONAGEM (INTEL_REVEAL) — revela sem descartar; count sempre 2 (clamp é do store)', () => {
  const card = getCard('INTEL_REVEAL');

  it('canPlay: indisponível com a mão do oponente vazia', () => {
    const state = createTestState();
    expect(card.canPlay?.({ state, caster: 'PLAYER', uid: 'x' })).toBe(false);
  });

  it('abre PICK_MANY_FROM_HAND pedindo 2 — mesmo com a mão do oponente tendo só 1 carta (clamp é do openInteraction, Fase 3)', () => {
    const state = createTestState({ machineHand: [{ uid: 'm1', cardId: 'HEAL_SELF' }] });
    const result = card.effect({ state, caster: 'PLAYER', uid: 'x', rng });
    expect(result?.interaction).toEqual({
      kind: 'PICK_MANY_FROM_HAND',
      source: 'MACHINE',
      optionUids: ['m1'],
      count: 2,
    });
  });

  it('resolve: marca os uids escolhidos como revelados, sem remover nada da mão', () => {
    const state = createTestState({
      machineHand: [
        { uid: 'm1', cardId: 'HEAL_SELF' },
        { uid: 'm2', cardId: 'DIRECT_DAMAGE' },
      ],
    });
    const result = card.effect({
      state,
      caster: 'PLAYER',
      uid: 'x',
      rng,
      interaction: { selection: { kind: 'PICK_MANY_FROM_HAND', uids: ['m1', 'm2'] }, priorSelections: [] },
    });
    expect(result?.patch).toEqual({ machineRevealedUids: ['m1', 'm2'] });
    expect(result?.log).toMatchObject({ code: 'CARD_INTEL_REVEAL', value: 2 });
  });

  it('resolve: uids já revelados não se duplicam no array', () => {
    const state = createTestState({
      machineHand: [
        { uid: 'm1', cardId: 'HEAL_SELF' },
        { uid: 'm2', cardId: 'DIRECT_DAMAGE' },
      ],
      machineRevealedUids: ['m1'],
    });
    const result = card.effect({
      state,
      caster: 'PLAYER',
      uid: 'x',
      rng,
      interaction: { selection: { kind: 'PICK_MANY_FROM_HAND', uids: ['m1', 'm2'] }, priorSelections: [] },
    });
    expect(result?.patch).toEqual({ machineRevealedUids: ['m1', 'm2'] });
  });
});

describe('PROCRASTINAR (CARD_DRAFT) — opções geradas na hora, não são cartas de nenhuma mão', () => {
  const card = getCard('CARD_DRAFT');

  it('custo 1⚡ (patch pós-Fase 7a — antes 2⚡)', () => {
    expect(card.cost).toBe(1);
  });

  it('abre PICK_ONE_REVEALED com 3 opções vindas do canal CARDS', () => {
    const state = createTestState();
    const result = card.effect({ state, caster: 'PLAYER', uid: 'x', rng: createRng(1) });
    expect(result?.interaction?.kind).toBe('PICK_ONE_REVEALED');
    if (result?.interaction?.kind === 'PICK_ONE_REVEALED') {
      expect(result.interaction.options).toHaveLength(3);
    }
  });

  it('resolve: adiciona a carta escolhida à mão com um uid novo, sem estourar HAND_LIMIT', () => {
    const state = createTestState({ playerHand: [], nextCardUid: 7 });
    const result = card.effect({
      state,
      caster: 'PLAYER',
      uid: 'x',
      rng,
      interaction: { selection: { kind: 'PICK_ONE_REVEALED', cardId: 'HEAL_SELF' }, priorSelections: [] },
    });
    expect(result?.patch).toEqual({
      playerHand: [{ uid: 'HEAL_SELF#7', cardId: 'HEAL_SELF' }],
      nextCardUid: 8,
    });
    expect(result?.log).toMatchObject({ code: 'CARD_DRAFT_PICK', value: 'HEAL_SELF' });
  });
});

describe('PROCRASTINAR II (CARD_DRAFT_TIERED) — distribuição garantida 2 comuns + 2 épicas + 1 lendária', () => {
  const card = getCard('CARD_DRAFT_TIERED');

  it('custo 2⚡ (patch pós-Fase 7a — antes 3⚡)', () => {
    expect(card.cost).toBe(2);
  });

  it('abre PICK_ONE_REVEALED com 5 opções na distribuição garantida (não o sorteio ponderado normal)', () => {
    const state = createTestState();
    const result = card.effect({ state, caster: 'PLAYER', uid: 'x', rng: createRng(1) });
    expect(result?.interaction?.kind).toBe('PICK_ONE_REVEALED');
    if (result?.interaction?.kind === 'PICK_ONE_REVEALED') {
      const rarities = result.interaction.options.map((id) => getCard(id).rarity);
      expect(rarities.filter((r) => r === 'COMMON')).toHaveLength(2);
      expect(rarities.filter((r) => r === 'EPIC')).toHaveLength(2);
      expect(rarities.filter((r) => r === 'LEGENDARY')).toHaveLength(1);
    }
  });

  it('resolve: mesma resolução final de PROCRASTINAR (mesmo log, mesmo formato de uid)', () => {
    const state = createTestState({ playerHand: [], nextCardUid: 0 });
    const result = card.effect({
      state,
      caster: 'PLAYER',
      uid: 'x',
      rng,
      interaction: { selection: { kind: 'PICK_ONE_REVEALED', cardId: 'HAND_SWAP' }, priorSelections: [] },
    });
    expect(result?.patch).toEqual({
      playerHand: [{ uid: 'HAND_SWAP#0', cardId: 'HAND_SWAP' }],
      nextCardUid: 1,
    });
    expect(result?.log).toMatchObject({ code: 'CARD_DRAFT_PICK', value: 'HAND_SWAP' });
  });
});

/* -------------------------------------------------------------------------- */
/*                               VISÃO ABSOLUTA                                */
/* -------------------------------------------------------------------------- */

describe('VISÃO ABSOLUTA (FULL_INTEL) — revelação automática com prazo (fecha a carta)', () => {
  const card = getCard('FULL_INTEL');

  it('canPlay: indisponível com a mão do oponente vazia', () => {
    const state = createTestState();
    expect(card.canPlay?.({ state, caster: 'PLAYER', uid: 'x' })).toBe(false);
  });

  it('ramo humano: patch marca fullIntelRevealFor, além do acknowledge de sempre', () => {
    const state = createTestState({ machineHand: [{ uid: 'm1', cardId: 'HEAL_SELF' }] });
    const result = card.effect({ state, caster: 'PLAYER', uid: 'x', rng });
    expect(result?.patch).toEqual({ fullIntelRevealFor: 'PLAYER' });
    expect(result?.acknowledge).toMatchObject({ code: 'HAND_REVEALED', kind: 'INTEL_FLIP' });
  });

  it('ramo IA (offline): patch marca fullIntelRevealFor também, sem acknowledge', () => {
    const state = createTestState({ playerHand: [{ uid: 'p1', cardId: 'HEAL_SELF' }] });
    const result = card.effect({ state, caster: 'MACHINE', uid: 'x', rng });
    expect(result?.patch).toEqual({ fullIntelRevealFor: 'MACHINE' });
    expect(result?.acknowledge).toBeUndefined();
  });
});

/* -------------------------------------------------------------------------- */
/*                               TIC TAC BOOM!                                 */
/* -------------------------------------------------------------------------- */

describe('TIC TAC BOOM! (CHAOS_ROULETTE) — reshuffle total das peças existentes (Fase 6a)', () => {
  const card = getCard('CHAOS_ROULETTE');

  it('preserva a contagem exata de X e O — nunca cria nem perde peça', () => {
    const board = boardWith({
      0: piece('PLAYER', 1),
      4: piece('MACHINE', 2),
      8: piece('MACHINE', 3),
    });
    const state = createTestState({ board });
    const result = card.effect({ state, caster: 'PLAYER', uid: 'x', rng });
    const newBoard = result?.patch?.board as Board;

    expect(newBoard.filter((c) => c?.mark === 'X')).toHaveLength(1);
    expect(newBoard.filter((c) => c?.mark === 'O')).toHaveLength(2);
    expect(newBoard.filter((c) => c !== null)).toHaveLength(3);
  });

  it('usa células antes vazias — reshuffle TOTAL, não permutação só entre células ocupadas', () => {
    // Só a célula 0 tem peça. Um `shuffle` controlado manda essa peça pra
    // célula 5, que estava vazia — prova que o mecanismo não está restrito
    // a reorganizar dentro do conjunto de células já ocupadas.
    const board = boardWith({ 0: piece('PLAYER', 1) });
    const state = createTestState({ board });
    const result = card.effect({
      state,
      caster: 'PLAYER',
      uid: 'x',
      rng: fixedRng({
        shuffle: (<T,>(_items: readonly T[]) => [5, 0, 1, 2, 3, 4, 6, 7, 8] as unknown as T[]),
      }),
    });
    const newBoard = result?.patch?.board as Board;

    expect(newBoard[5]).toEqual(piece('PLAYER', 1));
    expect(newBoard[0]).toBeNull();
  });

  it('turnPlaced é preservado (não recalculado) — "mais antiga" continua correta na nova posição', () => {
    const board = boardWith({
      0: piece('PLAYER', 5),
      3: piece('PLAYER', 1), // a mais antiga
      6: piece('PLAYER', 9),
    });
    const state = createTestState({ board });
    const result = card.effect({ state, caster: 'PLAYER', uid: 'x', rng: createRng(7) });
    const newBoard = result?.patch?.board as Board;

    const turnPlacedValues = newBoard
      .filter((c): c is Piece => c !== null)
      .map((c) => c.turnPlaced)
      .sort((a, b) => a - b);
    expect(turnPlacedValues).toEqual([1, 5, 9]);

    // A peça de turnPlaced 1 continua sendo "a mais antiga", onde quer que
    // tenha caído — getOldestPieceIndex não conhece célula, só turnPlaced.
    const oldestIndex = getOldestPieceIndex(newBoard, 'PLAYER');
    expect(oldestIndex).not.toBeNull();
    expect(newBoard[oldestIndex!]?.turnPlaced).toBe(1);
  });

  it('determinístico por seed — mesma seed produz o mesmo board', () => {
    const board = boardWith({
      1: piece('PLAYER', 1),
      4: piece('MACHINE', 2),
      7: piece('PLAYER', 3),
    });
    const state = createTestState({ board });
    const resultA = card.effect({ state, caster: 'PLAYER', uid: 'x', rng: createRng(42) });
    const resultB = card.effect({ state, caster: 'PLAYER', uid: 'x', rng: createRng(42) });

    expect(resultA?.patch?.board).toEqual(resultB?.patch?.board);
  });

  it('fechamento duplo: a CONTAGEM decide o destino, não a posição de origem (board de entrada invertido do resultado esperado)', () => {
    // X começa em 6,7,8; O começa em 0,1,2 — o OPOSTO de onde cada símbolo
    // vai terminar. Se o teste passasse por coincidência de ordem de
    // iteração, essa inversão o quebraria.
    const board = boardWith({
      6: piece('PLAYER', 1),
      7: piece('PLAYER', 2),
      8: piece('PLAYER', 3),
      0: piece('MACHINE', 4),
      1: piece('MACHINE', 5),
      2: piece('MACHINE', 6),
    });
    const state = createTestState({ board });
    const result = card.effect({
      state,
      caster: 'PLAYER',
      uid: 'x',
      rng: fixedRng({ shuffle: (items) => [...items] }), // identidade — sem embaralhar de verdade
    });
    const newBoard = result?.patch?.board as Board;

    expect([0, 1, 2].every((i) => newBoard[i]?.mark === 'X')).toBe(true);
    expect([3, 4, 5].every((i) => newBoard[i]?.mark === 'O')).toBe(true);
    expect(newBoard.slice(6, 9)).toEqual([null, null, null]);

    // As duas linhas fecham ao mesmo tempo — findWinner pega a PRIMEIRA de
    // WIN_LINES ([0,1,2]), o desempate oficial decidido em
    // docs/NOTAS_TECNICAS.md. Cobertura ponta a ponta em gameStore.test.ts.
    expect(findWinner(newBoard)).toMatchObject({ winner: 'PLAYER', line: [0, 1, 2] });
  });
});

/* -------------------------------------------------------------------------- */
/*                                  RENOVAR                                    */
/* -------------------------------------------------------------------------- */

describe('RENOVAR (RENEW_PIECE) — carta nova (patch pós-Fase 7a): peça própria vira a mais nova da fila', () => {
  const card = getCard('RENEW_PIECE');

  it('recarimba turnPlaced para o turno atual, mantendo owner/mark', () => {
    const state = createTestState({
      board: boardWith({ 0: piece('PLAYER', 1), 1: piece('PLAYER', 2) }),
      turnCount: 9,
    });
    const result = card.effect({ state, caster: 'PLAYER', uid: 'x', targetIndex: 0, rng });
    const newBoard = result?.patch?.board as Board;
    expect(newBoard[0]).toEqual({ owner: 'PLAYER', mark: 'X', turnPlaced: 9 });
  });

  it('a peça renovada passa a ser a mais nova — getOldestPieceIndex não aponta mais pra ela', () => {
    const state = createTestState({
      board: boardWith({ 0: piece('PLAYER', 1), 1: piece('PLAYER', 2), 2: piece('PLAYER', 3) }),
      turnCount: 20,
    });
    const result = card.effect({ state, caster: 'PLAYER', uid: 'x', targetIndex: 0, rng });
    const newBoard = result?.patch?.board as Board;
    // Antes, 0 (turnPlaced 1) era a mais antiga. Depois de renovada (turnPlaced
    // 20), a mais antiga passa a ser 1 (turnPlaced 2).
    expect(getOldestPieceIndex(newBoard, 'PLAYER')).toBe(1);
  });

  it('isValidTarget: só peça PRÓPRIA', () => {
    const state = createTestState({ board: boardWith({ 0: piece('PLAYER', 0), 1: piece('MACHINE', 0) }) });
    expect(card.isValidTarget?.({ state, caster: 'PLAYER', index: 0 })).toBe(true);
    expect(card.isValidTarget?.({ state, caster: 'PLAYER', index: 1 })).toBe(false);
  });

  it('canPlay: indisponível com só 1 peça própria (já é a mais nova de qualquer jeito)', () => {
    const state = createTestState({ board: boardWith({ 0: piece('PLAYER', 0) }) });
    expect(card.canPlay?.({ state, caster: 'PLAYER', uid: 'x' })).toBe(false);
  });

  it('canPlay: disponível com 2+ peças próprias', () => {
    const state = createTestState({ board: boardWith({ 0: piece('PLAYER', 0), 1: piece('PLAYER', 1) }) });
    expect(card.canPlay?.({ state, caster: 'PLAYER', uid: 'x' })).toBe(true);
  });

  it('alvo inexistente/vazio devolve null', () => {
    const state = createTestState();
    const result = card.effect({ state, caster: 'PLAYER', uid: 'x', targetIndex: 0, rng });
    expect(result).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/*                                  RECICLAR                                   */
/* -------------------------------------------------------------------------- */

describe('RECICLAR (MULLIGAN) — carta nova (patch pós-Fase 7a): descarta 1 carta própria, compra 1 nova', () => {
  const card = getCard('MULLIGAN');

  it('canPlay: indisponível com a RECICLAR sendo a única carta na mão', () => {
    const state = createTestState({ playerHand: [{ uid: 'x', cardId: 'MULLIGAN' }] });
    expect(card.canPlay?.({ state, caster: 'PLAYER', uid: 'x' })).toBe(false);
  });

  it('canPlay: disponível com mais alguma carta na mão', () => {
    const state = createTestState({
      playerHand: [
        { uid: 'x', cardId: 'MULLIGAN' },
        { uid: 'o1', cardId: 'HEAL_SELF' },
      ],
    });
    expect(card.canPlay?.({ state, caster: 'PLAYER', uid: 'x' })).toBe(true);
  });

  it('1º passo: abre PICK_ONE_FROM_HAND com source=caster (mão própria, face-up) excluindo a própria RECICLAR', () => {
    const state = createTestState({
      playerHand: [
        { uid: 'x', cardId: 'MULLIGAN' },
        { uid: 'o1', cardId: 'HEAL_SELF' },
        { uid: 'o2', cardId: 'DIRECT_DAMAGE' },
      ],
    });
    const result = card.effect({ state, caster: 'PLAYER', uid: 'x', rng });
    expect(result?.interaction).toEqual({
      kind: 'PICK_ONE_FROM_HAND',
      source: 'PLAYER',
      optionUids: ['o1', 'o2'],
    });
  });

  it('2º passo: descarta a carta escolhida e declara a compra de 1 (draw, não mint manual)', () => {
    const state = createTestState({
      // A própria RECICLAR já saiu da mão ao abrir a interação (timing
      // unificado da Fase 3).
      playerHand: [{ uid: 'o1', cardId: 'HEAL_SELF' }],
    });
    const result = card.effect({
      state,
      caster: 'PLAYER',
      uid: 'x',
      rng,
      interaction: { selection: { kind: 'PICK_ONE_FROM_HAND', uid: 'o1' }, priorSelections: [] },
    });
    expect(result?.patch).toEqual({ playerHand: [] });
    expect(result?.draw).toEqual({ target: 'PLAYER', count: 1 });
    expect(result?.log).toMatchObject({ code: 'CARD_MULLIGAN', subject: 'PLAYER' });
  });

  it('2º passo: uid inexistente devolve null', () => {
    const state = createTestState({ playerHand: [{ uid: 'o1', cardId: 'HEAL_SELF' }] });
    const result = card.effect({
      state,
      caster: 'PLAYER',
      uid: 'x',
      rng,
      interaction: { selection: { kind: 'PICK_ONE_FROM_HAND', uid: 'fantasma' }, priorSelections: [] },
    });
    expect(result).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/*                                  DESLIZAR                                   */
/* -------------------------------------------------------------------------- */

describe('DESLIZAR (SLIDE_PIECE) — carta nova (patch pós-Fase 7a): move peça própria para vizinho vazio, sem mudar a idade', () => {
  const card = getCard('SLIDE_PIECE');

  it('isValidTarget: só peça própria com >=1 vizinho ortogonal vazio', () => {
    // índice 4 (centro): vizinhos 1,3,5,7. Todos ocupados -> sem alvo válido.
    const state = createTestState({
      board: boardWith({
        4: piece('PLAYER', 0),
        1: piece('MACHINE', 1),
        3: piece('MACHINE', 2),
        5: piece('MACHINE', 3),
        7: piece('MACHINE', 4),
      }),
    });
    expect(card.isValidTarget?.({ state, caster: 'PLAYER', index: 4 })).toBe(false);
  });

  it('isValidTarget: peça própria com vizinho vazio é alvo válido; peça do oponente nunca é', () => {
    const state = createTestState({ board: boardWith({ 4: piece('PLAYER', 0), 1: piece('MACHINE', 1) }) });
    expect(card.isValidTarget?.({ state, caster: 'PLAYER', index: 4 })).toBe(true);
    expect(card.isValidTarget?.({ state, caster: 'PLAYER', index: 1 })).toBe(false);
  });

  it('canPlay: indisponível sem nenhuma peça própria com vizinho vazio (tabuleiro cheio ao redor)', () => {
    const state = createTestState({
      board: boardWith({
        4: piece('PLAYER', 0),
        1: piece('MACHINE', 1),
        3: piece('MACHINE', 2),
        5: piece('MACHINE', 3),
        7: piece('MACHINE', 4),
      }),
    });
    expect(card.canPlay?.({ state, caster: 'PLAYER', uid: 'x' })).toBe(false);
  });

  it('canPlay: disponível com alguma peça própria tendo vizinho vazio', () => {
    const state = createTestState({ board: boardWith({ 4: piece('PLAYER', 0) }) });
    expect(card.canPlay?.({ state, caster: 'PLAYER', uid: 'x' })).toBe(true);
  });

  it('1º passo: abre PICK_BOARD_CELL com os vizinhos VAZIOS do alvo escolhido', () => {
    const state = createTestState({ board: boardWith({ 4: piece('PLAYER', 0), 1: piece('MACHINE', 1) }) });
    const result = card.effect({ state, caster: 'PLAYER', uid: 'x', targetIndex: 4, rng });
    expect(result?.interaction?.kind).toBe('PICK_BOARD_CELL');
    if (result?.interaction?.kind === 'PICK_BOARD_CELL') {
      // Vizinhos de 4 são 1,3,5,7 — 1 está ocupado (MACHINE), sobram 3,5,7.
      // Ordem não importa (é só a lista de alvos válidos p/ a UI destacar).
      expect([...result.interaction.eligibleIndexes].sort()).toEqual([3, 5, 7]);
    }
  });

  it('2º passo: move a peça — some da origem, aparece no destino com o MESMO turnPlaced', () => {
    const state = createTestState({ board: boardWith({ 4: piece('PLAYER', 7) }) });
    const result = card.effect({
      state,
      caster: 'PLAYER',
      uid: 'x',
      rng,
      interaction: {
        selection: { kind: 'PICK_BOARD_CELL', index: 5 },
        priorSelections: [{ kind: 'BOARD_TARGET', index: 4 }],
      },
    });
    const newBoard = result?.patch?.board as Board;
    expect(newBoard[4]).toBeNull();
    expect(newBoard[5]).toEqual({ owner: 'PLAYER', mark: 'X', turnPlaced: 7 });
    expect(result?.log).toMatchObject({ code: 'CARD_SLIDE_PIECE', value: 5 });
  });

  it('2º passo: destino não-adjacente (ou ocupado) devolve null — mesma defesa que as outras cartas de 2 passos', () => {
    const state = createTestState({ board: boardWith({ 4: piece('PLAYER', 7), 8: piece('MACHINE', 1) }) });
    const result = card.effect({
      state,
      caster: 'PLAYER',
      uid: 'x',
      rng,
      interaction: {
        selection: { kind: 'PICK_BOARD_CELL', index: 8 }, // não é vizinho ortogonal de 4
        priorSelections: [{ kind: 'BOARD_TARGET', index: 4 }],
      },
    });
    expect(result).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/*                                 PRESSÁGIO                                   */
/* -------------------------------------------------------------------------- */

describe('PRESSÁGIO (SCRY_DECK) — carta nova (patch pós-Fase 7a): espia as 3 próximas cartas sem sacar', () => {
  const card = getCard('SCRY_DECK');

  it('sem canPlay — sempre jogável', () => {
    expect(card.canPlay).toBeUndefined();
  });

  it('revela 3 CardIds via acknowledge (kind INTEL_FLIP, reaproveitado de VISÃO ABSOLUTA)', () => {
    const state = createTestState();
    seedMatch(99);
    const result = card.effect({ state, caster: 'PLAYER', uid: 'x', rng: getChannel('CARDS') });
    expect(result?.acknowledge?.kind).toBe('INTEL_FLIP');
    expect(result?.acknowledge?.revealedCards).toHaveLength(3);
  });

  it('não consome o canal CARDS de verdade — a próxima compra real sai igual a uma sem PRESSÁGIO no meio', () => {
    const state = createTestState();

    seedMatch(7);
    const withoutScry = [drawCardId(getChannel('CARDS')), drawCardId(getChannel('CARDS'))];

    seedMatch(7);
    card.effect({ state, caster: 'PLAYER', uid: 'x', rng: getChannel('CARDS') }); // PRESSÁGIO no meio
    const withScry = [drawCardId(getChannel('CARDS')), drawCardId(getChannel('CARDS'))];

    expect(withScry).toEqual(withoutScry);
  });

  it('a mão da IA (offline) não ganha acknowledge — igual às outras cartas de informação', () => {
    const state = createTestState();
    const result = card.effect({ state, caster: 'MACHINE', uid: 'x', rng });
    expect(result?.acknowledge).toBeUndefined();
  });
});

/* -------------------------------------------------------------------------- */
/*                              BATERIA RESERVA                                */
/* -------------------------------------------------------------------------- */

describe('BATERIA RESERVA (BACKUP_BATTERY) — carta nova: escudo de 1 uso contra o próximo dano', () => {
  const card = getCard('BACKUP_BATTERY');

  it('canPlay: indisponível com o escudo já ativo — não empilha', () => {
    const state = createTestState({ playerShield: true });
    expect(card.canPlay?.({ state, caster: 'PLAYER', uid: 'x' })).toBe(false);
  });

  it('canPlay: disponível sem escudo ativo', () => {
    const state = createTestState({ playerShield: false });
    expect(card.canPlay?.({ state, caster: 'PLAYER', uid: 'x' })).toBe(true);
  });

  it('ativa o escudo do caster', () => {
    const state = createTestState();
    const result = card.effect({ state, caster: 'PLAYER', uid: 'x', rng });
    expect(result?.patch).toEqual({ playerShield: true });
    expect(result?.log).toMatchObject({ code: 'CARD_BACKUP_BATTERY', subject: 'PLAYER' });
  });
});

/* -------------------------------------------------------------------------- */
/*                              CÁPSULA DO TEMPO                               */
/* -------------------------------------------------------------------------- */

describe('CÁPSULA DO TEMPO (TIME_CAPSULE) — carta nova: a regra real vive em takeDamage (gameStore.ts), não em effect()', () => {
  const card = getCard('TIME_CAPSULE');

  it('é uma TRAP sem triggerCondition — não participa do barramento de eventos (ver events.ts, DAMAGE_TAKEN nunca dispara)', () => {
    expect(card.type).toBe('TRAP');
    expect(card.triggerCondition).toBeUndefined();
  });

  it('effect() nunca é chamado pelo fluxo normal — devolve null por segurança', () => {
    const state = createTestState();
    expect(card.effect({ state, caster: 'PLAYER', uid: 'x', rng })).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/*                                FIO DE ARAME                                 */
/* -------------------------------------------------------------------------- */

describe('FIO DE ARAME (TRIPWIRE) — carta nova: drena energia na próxima peça colocada pelo oponente', () => {
  const card = getCard('TRIPWIRE');
  const state = createTestState();

  it('dispara em qualquer colocação de peça, sem restringir à casa central (diferente de MINA)', () => {
    expect(card.triggerCondition?.({ type: 'PIECE_PLACED', player: 'MACHINE', index: 0 }, state)).toBe(true);
    expect(card.triggerCondition?.({ type: 'PIECE_PLACED', player: 'MACHINE', index: 4 }, state)).toBe(true);
  });

  it('NÃO dispara para outros tipos de evento', () => {
    expect(card.triggerCondition?.({ type: 'CARD_PLAYED', player: 'MACHINE', cardId: 'STUDY' }, state)).toBe(false);
  });

  it('drena até 2⚡ de quem colocou a peça', () => {
    const rich = createTestState({ machineEnergy: 3 });
    const result = card.effect({
      state: rich,
      caster: 'PLAYER',
      uid: 'x',
      rng,
      event: { type: 'PIECE_PLACED', player: 'MACHINE', index: 0 },
    });
    expect(result?.energyDrain).toEqual({ target: 'MACHINE', amount: 2 });
    expect(result?.log).toMatchObject({ code: 'CARD_TRIPWIRE', subject: 'PLAYER', target: 'MACHINE', value: 2 });
  });

  it('clampa em quanto o alvo realmente tem, se for menos que 2', () => {
    const poor = createTestState({ machineEnergy: 1 });
    const result = card.effect({
      state: poor,
      caster: 'PLAYER',
      uid: 'x',
      rng,
      event: { type: 'PIECE_PLACED', player: 'MACHINE', index: 0 },
    });
    expect(result?.energyDrain).toEqual({ target: 'MACHINE', amount: 1 });
  });

  it('sem evento (ou evento errado) devolve null', () => {
    const result = card.effect({ state, caster: 'PLAYER', uid: 'x', rng });
    expect(result).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/*                                   APAGÃO                                    */
/* -------------------------------------------------------------------------- */

describe('APAGÃO (BLACKOUT) — carta nova: drena toda a energia do oponente', () => {
  const card = getCard('BLACKOUT');

  it('canPlay: indisponível com o oponente já em 0⚡', () => {
    const state = createTestState({ machineEnergy: 0 });
    expect(card.canPlay?.({ state, caster: 'PLAYER', uid: 'x' })).toBe(false);
  });

  it('canPlay: disponível com o oponente tendo energia', () => {
    const state = createTestState({ machineEnergy: 1 });
    expect(card.canPlay?.({ state, caster: 'PLAYER', uid: 'x' })).toBe(true);
  });

  it('drena exatamente a energia atual do oponente', () => {
    const state = createTestState({ machineEnergy: 2 });
    const result = card.effect({ state, caster: 'PLAYER', uid: 'x', rng });
    expect(result?.energyDrain).toEqual({ target: 'MACHINE', amount: 2 });
    expect(result?.log).toMatchObject({ code: 'CARD_BLACKOUT', subject: 'PLAYER', target: 'MACHINE' });
  });
});

/* -------------------------------------------------------------------------- */
/*                                  PARADOXO                                   */
/* -------------------------------------------------------------------------- */

describe('PARADOXO (PARADOX) — carta nova, a mais complexa do baralho: copia de graça a próxima carta de custo 3⚡', () => {
  const card = getCard('PARADOX');

  it('dispara só para CARD_PLAYED de uma carta de custo 3⚡', () => {
    const state = createTestState();
    expect(card.triggerCondition?.({ type: 'CARD_PLAYED', player: 'MACHINE', cardId: 'HEAL_SELF' }, state)).toBe(true); // custo 3
    expect(card.triggerCondition?.({ type: 'CARD_PLAYED', player: 'MACHINE', cardId: 'STUDY' }, state)).toBe(false); // custo 2
    expect(card.triggerCondition?.({ type: 'PIECE_PLACED', player: 'MACHINE', index: 0 }, state)).toBe(false);
  });

  it('copia CURA (ACTION): o dono do PARADOXO também é curado', () => {
    const state = createTestState({ playerHp: 3, machineHp: 5 });
    const result = card.effect({
      state,
      caster: 'PLAYER',
      uid: 'x',
      rng,
      event: { type: 'CARD_PLAYED', player: 'MACHINE', cardId: 'HEAL_SELF' },
    });
    expect(result?.heal).toEqual({ target: 'PLAYER', amount: 1 });
    expect(result?.log).toMatchObject({ code: 'CARD_PARADOX', subject: 'PLAYER', target: 'MACHINE', value: 'HEAL_SELF' });
  });

  it('copia ATAQUE (ACTION): o dano espelhado atinge quem jogou, não o dono do PARADOXO', () => {
    const state = createTestState();
    const result = card.effect({
      state,
      caster: 'PLAYER',
      uid: 'x',
      rng,
      event: { type: 'CARD_PLAYED', player: 'MACHINE', cardId: 'DIRECT_DAMAGE' },
    });
    expect(result?.damage).toEqual({ target: 'MACHINE', amount: 1 });
  });

  it('copia PERMUTA CAÓTICA (ACTION): reexecuta a troca com o caster invertido (operação simétrica entre as duas mãos)', () => {
    const state = createTestState({
      playerHand: [{ uid: 'p1', cardId: 'HEAL_SELF' }],
      machineHand: [{ uid: 'm1', cardId: 'DIRECT_DAMAGE' }],
    });
    const result = card.effect({
      state,
      caster: 'PLAYER',
      uid: 'x',
      rng,
      event: { type: 'CARD_PLAYED', player: 'MACHINE', cardId: 'HAND_SWAP' },
    });
    // Encadeado com a jogada original (já refletida em `state` no fluxo real,
    // via CARD_PLAYED disparado DEPOIS de aplicar o efeito), esta 2ª troca
    // devolve cada mão ao dono de antes.
    expect(result?.patch?.playerHand).toEqual(state.machineHand);
    expect(result?.patch?.machineHand).toEqual(state.playerHand);
  });

  it('copia SABOTAGEM (interativa): resolve a escolha sozinho via RNG, sem devolver .interaction', () => {
    const state = createTestState({
      machineHand: [{ uid: 'm1', cardId: 'HEAL_SELF' }],
    });
    const result = card.effect({
      state,
      caster: 'PLAYER',
      uid: 'x',
      rng,
      event: { type: 'CARD_PLAYED', player: 'MACHINE', cardId: 'SABOTAGE' },
    });
    expect(result?.interaction).toBeUndefined();
    // A única carta da mão de MACHINE some — mesmo efeito que SABOTAGEM
    // produziria se o dono do PARADOXO a tivesse jogado de verdade.
    expect(result?.patch?.machineHand).toEqual([]);
  });

  it('copia MINA (TRAP): arma uma armadilha idêntica pro dono do PARADOXO — armar nunca chama effect()', () => {
    const state = createTestState({ playerTraps: [] });
    const result = card.effect({
      state,
      caster: 'PLAYER',
      uid: 'x',
      rng,
      event: { type: 'CARD_PLAYED', player: 'MACHINE', cardId: 'BOMB_TRAP' },
    });
    expect(result?.patch?.playerTraps).toHaveLength(1);
    expect(result?.patch?.playerTraps?.[0].cardId).toBe('BOMB_TRAP');
  });

  it('copia MINA com TRAP_LIMIT cheio: PARADOXO ainda dispara (é consumido), só a cópia não cabe', () => {
    const state = createTestState({
      playerTraps: [
        { uid: 't1', cardId: 'SHIELD_TRAP' },
        { uid: 't2', cardId: 'ANTI_SPELL_TRAP' },
        { uid: 't3', cardId: 'REFLECT_TRAP' },
      ],
    });
    const result = card.effect({
      state,
      caster: 'PLAYER',
      uid: 'x',
      rng,
      event: { type: 'CARD_PLAYED', player: 'MACHINE', cardId: 'BOMB_TRAP' },
    });
    expect(result).not.toBeNull();
    expect(result?.patch).toBeUndefined();
    expect(result?.log).toMatchObject({ code: 'CARD_PARADOX', value: 'BOMB_TRAP' });
  });
});
