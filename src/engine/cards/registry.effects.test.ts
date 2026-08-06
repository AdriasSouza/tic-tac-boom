import { describe, expect, it } from 'vitest';

import { CENTER_INDEX } from '@/engine/events';
import { createRng } from '@/engine/rng';
import type { Board, Piece } from '@/engine/rules';
import { createTestState } from '@/engine/testHelpers';
import { getCard } from '@/engine/cards/registry';

const rng = createRng(1);

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

describe('ESTUDAR (STUDY) — regra confirmada: renomeada, mecânica idêntica', () => {
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
});

/* -------------------------------------------------------------------------- */
/*                                ESTUDAR II                                   */
/* -------------------------------------------------------------------------- */

describe('ESTUDAR II (STUDY_II) — regra confirmada: renomeada, mecânica idêntica', () => {
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

describe('MINA (BOMB_TRAP) — regra confirmada: mantida sem mudança', () => {
  const card = getCard('BOMB_TRAP');

  it('triggerCondition: dispara quando o oponente ocupa o centro', () => {
    const state = createTestState();
    expect(card.triggerCondition?.({ type: 'PIECE_PLACED', player: 'MACHINE', index: CENTER_INDEX }, state)).toBe(true);
    expect(card.triggerCondition?.({ type: 'PIECE_PLACED', player: 'MACHINE', index: 0 }, state)).toBe(false);
  });

  it('effect: 2 de dano no oponente e extraTurnPending pro defensor', () => {
    const state = createTestState();
    const result = card.effect({ state, caster: 'PLAYER', uid: 'x', rng });
    expect(result?.damage).toEqual({ target: 'MACHINE', amount: 2 });
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

  it('cancela a carta do oponente ao disparar', () => {
    const result = card.effect({ state, caster: 'PLAYER', uid: 'x', rng });
    expect(result?.cancelsAction).toBe(true);
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

  it('cancela a carta do oponente ao disparar', () => {
    const result = card.effect({ state, caster: 'PLAYER', uid: 'x', rng });
    expect(result?.cancelsAction).toBe(true);
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

  it('inverte DIRECT_DAMAGE — dano atinge o próprio atacante', () => {
    const result = card.effect({
      state,
      caster: 'PLAYER',
      uid: 'x',
      rng,
      event: { type: 'CARD_ABOUT_TO_RESOLVE', player: 'MACHINE', cardId: 'DIRECT_DAMAGE' },
    });
    expect(result?.cancelsAction).toBe(true);
    expect(result?.damage).toEqual({ target: 'MACHINE', amount: 1 });
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
});

/* -------------------------------------------------------------------------- */
/*                                   VIDENTE                                   */
/* -------------------------------------------------------------------------- */

describe('VIDENTE (HIGHLIGHT_OLDEST) — carta nova: leitura pura, mas o destaque em si é estado efêmero (Fase 2.6)', () => {
  const card = getCard('HIGHLIGHT_OLDEST');

  it('VIDENTE: destaca a peça mais antiga com só 1 peça no tabuleiro (confirmado — com menos de 3 peças a informação já é óbvia de graça olhando o tabuleiro; jogar a carta ali é decisão ruim do jogador, não estado inválido, e canPlay não existe para proteger de decisão ruim)', () => {
    const state = createTestState({ board: boardWith({ 2: piece('MACHINE', 0) }) });
    const result = card.effect({ state, caster: 'PLAYER', uid: 'x', rng });
    expect(result?.patch).toEqual({
      highlightedOldestFor: { caster: 'PLAYER', owner: 'MACHINE', index: 2, turnPlaced: 0 },
    });
    expect(result?.log).toMatchObject({ code: 'CARD_HIGHLIGHT_OLDEST', subject: 'PLAYER', target: 'MACHINE', value: 2 });
  });

  it('destaca a mais antiga entre várias, por turnPlaced', () => {
    const state = createTestState({ board: boardWith({ 0: piece('MACHINE', 5), 1: piece('MACHINE', 2) }) });
    const result = card.effect({ state, caster: 'PLAYER', uid: 'x', rng });
    expect(result?.log?.value).toBe(1); // turnPlaced 2 < 5
    expect(result?.patch?.highlightedOldestFor).toMatchObject({ index: 1, turnPlaced: 2 });
  });

  it('canPlay: indisponível com o oponente sem nenhuma peça', () => {
    const state = createTestState();
    expect(card.canPlay?.({ state, caster: 'PLAYER', uid: 'x' })).toBe(false);
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

describe('OBSOLESCÊNCIA (OBSOLESCENCE) — efeito alterado: mata direto → força posição na fila', () => {
  const card = getCard('OBSOLESCENCE');

  it('marca forcedVanish CHOSEN com o índice e turnPlaced da peça alvo', () => {
    const state = createTestState({ board: boardWith({ 4: piece('MACHINE', 7) }) });
    const result = card.effect({ state, caster: 'PLAYER', uid: 'x', targetIndex: 4, rng });
    expect(result?.patch).toEqual({
      forcedVanish: { owner: 'MACHINE', mode: 'CHOSEN', index: 4, turnPlaced: 7 },
    });
  });

  it('canPlay: indisponível com o oponente sem peça nenhuma', () => {
    const state = createTestState();
    expect(card.canPlay?.({ state, caster: 'PLAYER', uid: 'x' })).toBe(false);
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
