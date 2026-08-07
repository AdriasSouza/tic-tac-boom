import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CardDefinition, CardId } from '@/engine/cards/definitions';
import * as registry from '@/engine/cards/registry';
import { createEmptyBoard } from '@/engine/rules';
import { getChannel } from '@/engine/rng';
import { useGameStore } from '@/store/gameStore';

/**
 * Fase 3 — contrato de `pendingInteraction`.
 *
 * `BOARD_TARGET` é testado de ponta a ponta com cartas REAIS (`BREAK_PIECE`/
 * `LOCK_CELL`) — a migração não muda o corpo delas, então cobertura real já
 * existe. Os outros 4 `kind`s (`PICK_ONE_FROM_HAND`, `PICK_MANY_FROM_HAND`,
 * `PICK_ONE_REVEALED`, `SACRIFICE_DRAG`) ainda não têm carta nenhuma que os
 * produza — cobertos aqui só por FIXTURE SINTÉTICA, via `vi.spyOn(getCard)`,
 * escopado por teste (`vi.restoreAllMocks()` no `afterEach`). Primeira vez que
 * esta suíte usa mock; decisão explícita da Fase 3 — a alternativa (testar
 * "o campo muda quando eu mudo o campo") não provaria fiação nenhuma.
 */

const realGetCard = registry.getCard;

function installFixtures(defs: Partial<Record<CardId, CardDefinition>>): void {
  vi.spyOn(registry, 'getCard').mockImplementation((id: CardId) => defs[id] ?? realGetCard(id));
}

/* -------------------------------------------------------------------------- */
/*                              FIXTURES DE CARTA                              */
/* -------------------------------------------------------------------------- */

const FIXTURE_PICK_ONE = 'FIXTURE_PICK_ONE' as CardId;
const fixturePickOneDef: CardDefinition = {
  id: FIXTURE_PICK_ONE,
  name: 'Fixture Pick One',
  type: 'ACTION',
  description: 'fixture de mecanismo — não é uma carta real',
  targeting: 'NONE',
  rarity: 'COMMON',
  weight: 1,
  cost: 2,
  effect: (ctx) => {
    if (!ctx.interaction) {
      return { interaction: { kind: 'PICK_ONE_FROM_HAND', source: 'MACHINE', optionUids: ['m1', 'm2'] } };
    }
    const sel = ctx.interaction.selection;
    if (sel.kind !== 'PICK_ONE_FROM_HAND') return null;
    return { log: { code: 'CARD_RAID_STOLE', subject: ctx.caster, value: sel.uid } };
  },
};

const FIXTURE_PICK_MANY = 'FIXTURE_PICK_MANY' as CardId;
const fixturePickManyDef: CardDefinition = {
  id: FIXTURE_PICK_MANY,
  name: 'Fixture Pick Many',
  type: 'ACTION',
  description: 'fixture de mecanismo',
  targeting: 'NONE',
  rarity: 'COMMON',
  weight: 1,
  cost: 1,
  effect: (ctx) => {
    if (!ctx.interaction) {
      return {
        interaction: { kind: 'PICK_MANY_FROM_HAND', source: 'MACHINE', optionUids: ['m1', 'm2', 'm3'], count: 2 },
      };
    }
    const sel = ctx.interaction.selection;
    if (sel.kind !== 'PICK_MANY_FROM_HAND') return null;
    return { log: { code: 'CARD_INTEL_HAND', subject: ctx.caster, value: sel.uids.length } };
  },
};

const FIXTURE_PICK_MANY_CLAMP = 'FIXTURE_PICK_MANY_CLAMP' as CardId;
const fixturePickManyClampDef: CardDefinition = {
  id: FIXTURE_PICK_MANY_CLAMP,
  name: 'Fixture Pick Many Clamp',
  type: 'ACTION',
  description: 'fixture de mecanismo — pede mais do que a fonte tem',
  targeting: 'NONE',
  rarity: 'COMMON',
  weight: 1,
  cost: 1,
  effect: (ctx) => {
    if (!ctx.interaction) {
      // Pede 5, a fonte só tem 2 — o STORE precisa clampar ao abrir.
      return { interaction: { kind: 'PICK_MANY_FROM_HAND', source: 'MACHINE', optionUids: ['m1', 'm2'], count: 5 } };
    }
    return { log: { code: 'CARD_INTEL_HAND', subject: ctx.caster } };
  },
};

const FIXTURE_REVEALED = 'FIXTURE_REVEALED' as CardId;
const fixtureRevealedDef: CardDefinition = {
  id: FIXTURE_REVEALED,
  name: 'Fixture Revealed',
  type: 'ACTION',
  description: 'fixture de mecanismo',
  targeting: 'NONE',
  rarity: 'COMMON',
  weight: 1,
  cost: 1,
  effect: (ctx) => {
    if (!ctx.interaction) {
      return { interaction: { kind: 'PICK_ONE_REVEALED', options: ['HEAL_SELF', 'DIRECT_DAMAGE'] } };
    }
    const sel = ctx.interaction.selection;
    if (sel.kind !== 'PICK_ONE_REVEALED') return null;
    return { log: { code: 'CARD_DRAW', subject: ctx.caster, value: sel.cardId } };
  },
};

const FIXTURE_SACRIFICE = 'FIXTURE_SACRIFICE' as CardId;
const fixtureSacrificeDef: CardDefinition = {
  id: FIXTURE_SACRIFICE,
  name: 'Fixture Sacrifice',
  type: 'ACTION',
  description: 'fixture de mecanismo — SACRIFICE_DRAG só existe no tipo até a Fase 6',
  targeting: 'NONE',
  rarity: 'COMMON',
  weight: 1,
  cost: 0,
  effect: (ctx) => {
    if (!ctx.interaction) {
      return { interaction: { kind: 'SACRIFICE_DRAG', eligibleUids: ['s1', 's2', 's3'], count: 2 } };
    }
    const sel = ctx.interaction.selection;
    if (sel.kind !== 'SACRIFICE_DRAG') return null;
    return { log: { code: 'CARD_ALTAR_OPENED', subject: ctx.caster } };
  },
};

/** TROCAR-shaped: 1 carta da PRÓPRIA mão (passo 1) + 1 da mão OCULTA do oponente (passo 2). */
const FIXTURE_CHAIN = 'FIXTURE_CHAIN' as CardId;
const fixtureChainDef: CardDefinition = {
  id: FIXTURE_CHAIN,
  name: 'Fixture Chain',
  type: 'ACTION',
  description: 'fixture — prova encadeamento de 2 passos sem 6º kind',
  targeting: 'NONE',
  rarity: 'COMMON',
  weight: 1,
  cost: 2,
  effect: (ctx) => {
    if (!ctx.interaction) {
      // Passo 1: source === caster → mão PRÓPRIA (face visível).
      return { interaction: { kind: 'PICK_ONE_FROM_HAND', source: ctx.caster, optionUids: ['own1', 'own2'] } };
    }
    if (ctx.interaction.priorSelections.length === 0) {
      // Passo 2: source !== caster → mão OCULTA do oponente.
      const opponent = ctx.caster === 'PLAYER' ? 'MACHINE' : 'PLAYER';
      return { interaction: { kind: 'PICK_ONE_FROM_HAND', source: opponent, optionUids: ['m1', 'm2'] } };
    }
    const offered = ctx.interaction.priorSelections[0];
    const received = ctx.interaction.selection;
    if (offered.kind !== 'PICK_ONE_FROM_HAND' || received.kind !== 'PICK_ONE_FROM_HAND') return null;
    return {
      log: { code: 'CARD_HAND_SWAP', subject: ctx.caster, value: `${offered.uid}->${received.uid}` },
    };
  },
};

/** Qualquer seleção no 2º passo é tratada como inválida, de propósito. */
const FIXTURE_NULL_STEP = 'FIXTURE_NULL_STEP' as CardId;
const fixtureNullStepDef: CardDefinition = {
  id: FIXTURE_NULL_STEP,
  name: 'Fixture Null Step',
  type: 'ACTION',
  description: 'fixture — prova que um passo inválido reembolsa como cancelamento',
  targeting: 'NONE',
  rarity: 'COMMON',
  weight: 1,
  cost: 1,
  effect: (ctx) => {
    if (!ctx.interaction) {
      return { interaction: { kind: 'PICK_ONE_FROM_HAND', source: 'MACHINE', optionUids: ['m1', 'm2'] } };
    }
    return null;
  },
};

const FIXTURE_COUNTER_TRAP = 'FIXTURE_COUNTER_TRAP' as CardId;
const fixtureCounterTrapDef: CardDefinition = {
  id: FIXTURE_COUNTER_TRAP,
  name: 'Fixture Counter Trap',
  type: 'TRAP',
  description: 'fixture — prova que resolveCounterTraps aplica consumesTurn/opensAltar via applyCardEffectResult',
  targeting: 'NONE',
  rarity: 'COMMON',
  weight: 1,
  cost: 0,
  triggerCondition: () => true,
  effect: () => ({ cancelsAction: true, consumesTurn: true, opensAltar: true }),
};

const FIXTURE_WIN_TRAP = 'FIXTURE_WIN_TRAP' as CardId;
const fixtureWinTrapDef: CardDefinition = {
  id: FIXTURE_WIN_TRAP,
  name: 'Fixture Win Trap',
  type: 'TRAP',
  description: 'fixture — prova que resolveCounterTraps rechecka findWinner',
  targeting: 'NONE',
  rarity: 'COMMON',
  weight: 1,
  cost: 0,
  triggerCondition: () => true,
  effect: () => {
    const board = createEmptyBoard();
    board[0] = { owner: 'PLAYER', mark: 'X', turnPlaced: 1 };
    board[1] = { owner: 'PLAYER', mark: 'X', turnPlaced: 2 };
    board[2] = { owner: 'PLAYER', mark: 'X', turnPlaced: 3 };
    return { cancelsAction: true, patch: { board } };
  },
};

/* -------------------------------------------------------------------------- */
/*                                    SETUP                                    */
/* -------------------------------------------------------------------------- */

beforeEach(() => {
  useGameStore.getState().startMatch(1);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

/* -------------------------------------------------------------------------- */
/*                                   TESTES                                    */
/* -------------------------------------------------------------------------- */

describe('resolveCardPlay — guarda de double-play com interação pendente (AGENTS.md, 4ª ocorrência)', () => {
  it('BOARD_TARGET aberto por uma carta real bloqueia uma 2ª jogada: retorna false e zero efeito colateral', () => {
    const board = createEmptyBoard();
    board[4] = { owner: 'MACHINE', mark: 'O', turnPlaced: 1 }; // alvo válido para BREAK_PIECE
    useGameStore.setState({
      turn: 'PLAYER',
      playerEnergy: 3,
      board,
      playerHand: [
        { uid: 'break', cardId: 'BREAK_PIECE' },
        { uid: 'heal', cardId: 'HEAL_SELF' },
      ],
    });

    // Arma a mira de DEMOLIR — nenhum alvo ainda escolhido.
    expect(useGameStore.getState().playCard('break')).toBe(true);
    expect(useGameStore.getState().pendingInteraction?.kind).toBe('BOARD_TARGET');

    const before = useGameStore.getState();
    const played = useGameStore.getState().playCard('heal');
    const after = useGameStore.getState();

    expect(played).toBe(false);
    // Mesma prova de "zero efeito colateral" dos testes de turno errado: se a
    // guarda barrou ANTES de qualquer `set()`, a referência de estado nem trocou.
    expect(after).toBe(before);
    expect(after.playerHand).toEqual([{ uid: 'heal', cardId: 'HEAL_SELF' }]);
  });
});

describe('BOARD_TARGET — timing unificado (arma cobra energia+mão na hora; cancelar reembolsa no índice exato)', () => {
  it('armar debita o custo e remove a carta do MEIO da mão; cancelar restaura os dois no handIndex original', () => {
    const board = createEmptyBoard();
    board[4] = { owner: 'MACHINE', mark: 'O', turnPlaced: 1 };
    useGameStore.setState({
      turn: 'PLAYER',
      playerEnergy: 3,
      board,
      playerHand: [
        { uid: 'x1', cardId: 'HEAL_SELF' },
        { uid: 'break', cardId: 'BREAK_PIECE' }, // handIndex 1, no meio da mão
        { uid: 'x2', cardId: 'HEAL_SELF' },
      ],
    });

    expect(useGameStore.getState().playCard('break')).toBe(true);

    const armed = useGameStore.getState();
    expect(armed.playerEnergy).toBe(1); // 3 - custo 2 de BREAK_PIECE (rebalanceamento: COMMON/1 -> RARE/2)
    expect(armed.playerHand).toEqual([
      { uid: 'x1', cardId: 'HEAL_SELF' },
      { uid: 'x2', cardId: 'HEAL_SELF' },
    ]);
    expect(armed.pendingInteraction).toMatchObject({
      kind: 'BOARD_TARGET',
      caster: 'PLAYER',
      cardId: 'BREAK_PIECE',
      cardUid: 'break',
      handIndex: 1,
    });

    expect(useGameStore.getState().cancelInteraction('PLAYER')).toBe(true);

    const cancelled = useGameStore.getState();
    expect(cancelled.playerEnergy).toBe(3); // reembolsado
    // Restaurada no ÍNDICE EXATO — splice, não push (CLAUDE.md #7: não é "entrar
    // na mão", é desfazer).
    expect(cancelled.playerHand).toEqual([
      { uid: 'x1', cardId: 'HEAL_SELF' },
      { uid: 'break', cardId: 'BREAK_PIECE' },
      { uid: 'x2', cardId: 'HEAL_SELF' },
    ]);
    expect(cancelled.pendingInteraction).toBeNull();
  });
});

describe('pendingInteraction — fluxo completo por kind', () => {
  it('BOARD_TARGET (carta real TRAVAR): abre a mira, resolve na célula, fecha a interação', () => {
    useGameStore.setState({
      turn: 'PLAYER',
      playerEnergy: 3,
      playerHand: [{ uid: 'lock', cardId: 'LOCK_CELL' }],
    });

    expect(useGameStore.getState().playCard('lock')).toBe(true);
    expect(useGameStore.getState().pendingInteraction?.kind).toBe('BOARD_TARGET');

    expect(
      useGameStore.getState().resolveInteraction('PLAYER', { kind: 'BOARD_TARGET', index: 4 }),
    ).toBe(true);

    const state = useGameStore.getState();
    expect(state.pendingInteraction).toBeNull();
    expect(state.lockedCell).toBe(4);
  });

  it('PICK_ONE_FROM_HAND (fixture, mão oculta do oponente): abre, resolve por uid, aplica o resultado final', () => {
    installFixtures({ [FIXTURE_PICK_ONE]: fixturePickOneDef });
    useGameStore.setState({
      turn: 'PLAYER',
      playerEnergy: 3,
      playerHand: [{ uid: 'p', cardId: FIXTURE_PICK_ONE }],
      machineHand: [
        { uid: 'm1', cardId: 'HEAL_SELF' },
        { uid: 'm2', cardId: 'DIRECT_DAMAGE' },
      ],
    });

    expect(useGameStore.getState().playCard('p')).toBe(true);
    expect(useGameStore.getState().playerEnergy).toBe(1); // 3 - custo 2, cobrado ao ABRIR
    expect(useGameStore.getState().playerHand).toEqual([]);
    expect(useGameStore.getState().pendingInteraction).toMatchObject({
      kind: 'PICK_ONE_FROM_HAND',
      source: 'MACHINE',
      optionUids: ['m1', 'm2'],
    });

    expect(
      useGameStore.getState().resolveInteraction('PLAYER', { kind: 'PICK_ONE_FROM_HAND', uid: 'm2' }),
    ).toBe(true);

    const state = useGameStore.getState();
    expect(state.pendingInteraction).toBeNull();
    expect(state.terminalLog.at(-1)).toMatchObject({
      code: 'CARD_RAID_STOLE',
      subject: 'PLAYER',
      value: 'm2',
    });
  });

  it('PICK_MANY_FROM_HAND (fixture): abre com count, resolve com N uids, aplica o resultado final', () => {
    installFixtures({ [FIXTURE_PICK_MANY]: fixturePickManyDef });
    useGameStore.setState({
      turn: 'PLAYER',
      playerEnergy: 3,
      playerHand: [{ uid: 'p', cardId: FIXTURE_PICK_MANY }],
    });

    expect(useGameStore.getState().playCard('p')).toBe(true);
    expect(useGameStore.getState().pendingInteraction).toMatchObject({
      kind: 'PICK_MANY_FROM_HAND',
      optionUids: ['m1', 'm2', 'm3'],
      count: 2,
    });

    expect(
      useGameStore.getState().resolveInteraction('PLAYER', { kind: 'PICK_MANY_FROM_HAND', uids: ['m1', 'm3'] }),
    ).toBe(true);

    const state = useGameStore.getState();
    expect(state.pendingInteraction).toBeNull();
    expect(state.terminalLog.at(-1)).toMatchObject({ code: 'CARD_INTEL_HAND', value: 2 });
  });

  it('PICK_ONE_REVEALED (fixture): abre com opções geradas na hora, resolve por cardId', () => {
    installFixtures({ [FIXTURE_REVEALED]: fixtureRevealedDef });
    useGameStore.setState({
      turn: 'PLAYER',
      playerEnergy: 3,
      playerHand: [{ uid: 'p', cardId: FIXTURE_REVEALED }],
    });

    expect(useGameStore.getState().playCard('p')).toBe(true);
    expect(useGameStore.getState().pendingInteraction).toMatchObject({
      kind: 'PICK_ONE_REVEALED',
      options: ['HEAL_SELF', 'DIRECT_DAMAGE'],
    });

    // A seleção carrega o `cardId` diretamente (Fase 4, Achado 1) — o passo
    // final não recebe `pending.options` de volta, só a escolha já resolvida.
    expect(
      useGameStore
        .getState()
        .resolveInteraction('PLAYER', { kind: 'PICK_ONE_REVEALED', cardId: 'DIRECT_DAMAGE' }),
    ).toBe(true);

    const state = useGameStore.getState();
    expect(state.pendingInteraction).toBeNull();
    expect(state.terminalLog.at(-1)).toMatchObject({ code: 'CARD_DRAW', value: 'DIRECT_DAMAGE' });
  });

  it('SACRIFICE_DRAG (fixture — só mecanismo; Altar migra para isto na Fase 6): abre, resolve com 2 uids, aplica', () => {
    installFixtures({ [FIXTURE_SACRIFICE]: fixtureSacrificeDef });
    useGameStore.setState({
      turn: 'PLAYER',
      playerEnergy: 3,
      playerHand: [{ uid: 'p', cardId: FIXTURE_SACRIFICE }],
    });

    expect(useGameStore.getState().playCard('p')).toBe(true);
    expect(useGameStore.getState().pendingInteraction).toMatchObject({
      kind: 'SACRIFICE_DRAG',
      eligibleUids: ['s1', 's2', 's3'],
      count: 2,
    });

    expect(
      useGameStore.getState().resolveInteraction('PLAYER', { kind: 'SACRIFICE_DRAG', uids: ['s1', 's2'] }),
    ).toBe(true);

    const state = useGameStore.getState();
    expect(state.pendingInteraction).toBeNull();
    expect(state.terminalLog.at(-1)).toMatchObject({ code: 'CARD_ALTAR_OPENED' });
  });
});

describe('cancelamento devolve carta e energia (todo kind, inclusive no meio de uma cadeia)', () => {
  it('cancela PICK_ONE_FROM_HAND antes de resolver: carta e energia voltam', () => {
    installFixtures({ [FIXTURE_PICK_ONE]: fixturePickOneDef });
    useGameStore.setState({
      turn: 'PLAYER',
      playerEnergy: 3,
      playerHand: [{ uid: 'p', cardId: FIXTURE_PICK_ONE }],
    });

    expect(useGameStore.getState().playCard('p')).toBe(true);
    expect(useGameStore.getState().playerEnergy).toBe(1);

    expect(useGameStore.getState().cancelInteraction('PLAYER')).toBe(true);

    const state = useGameStore.getState();
    expect(state.playerEnergy).toBe(3);
    expect(state.playerHand).toEqual([{ uid: 'p', cardId: FIXTURE_PICK_ONE }]);
    expect(state.pendingInteraction).toBeNull();
  });

  it('cancela NO MEIO de uma cadeia de 2 passos — reembolso é o custo ORIGINAL da carta', () => {
    installFixtures({ [FIXTURE_CHAIN]: fixtureChainDef });
    useGameStore.setState({
      turn: 'PLAYER',
      playerEnergy: 3,
      playerHand: [{ uid: 'p', cardId: FIXTURE_CHAIN }],
    });

    expect(useGameStore.getState().playCard('p')).toBe(true); // custo 2 debitado ao abrir
    expect(useGameStore.getState().playerEnergy).toBe(1);

    // Passo 1 resolvido — a interação AVANÇA para o passo 2, ainda pendente.
    expect(
      useGameStore.getState().resolveInteraction('PLAYER', { kind: 'PICK_ONE_FROM_HAND', uid: 'own1' }),
    ).toBe(true);
    expect(useGameStore.getState().pendingInteraction).toMatchObject({
      kind: 'PICK_ONE_FROM_HAND',
      source: 'MACHINE',
    });

    // Cancela no MEIO — o reembolso é sempre o custo ORIGINAL (2), não importa
    // quantos passos já resolveram.
    expect(useGameStore.getState().cancelInteraction('PLAYER')).toBe(true);

    const state = useGameStore.getState();
    expect(state.playerEnergy).toBe(3);
    expect(state.playerHand).toEqual([{ uid: 'p', cardId: FIXTURE_CHAIN }]);
    expect(state.pendingInteraction).toBeNull();
  });
});

describe('count sempre Math.min(count, fonte.length)', () => {
  it('PICK_MANY_FROM_HAND pedindo 5 com só 2 opções é clampado a 2 ao abrir', () => {
    installFixtures({ [FIXTURE_PICK_MANY_CLAMP]: fixturePickManyClampDef });
    useGameStore.setState({
      turn: 'PLAYER',
      playerEnergy: 3,
      playerHand: [{ uid: 'p', cardId: FIXTURE_PICK_MANY_CLAMP }],
    });

    expect(useGameStore.getState().playCard('p')).toBe(true);

    const pending = useGameStore.getState().pendingInteraction;
    expect(pending?.kind).toBe('PICK_MANY_FROM_HAND');
    expect(pending).toMatchObject({ optionUids: ['m1', 'm2'], count: 2 }); // nunca 5
  });
});

describe('encadeamento — fixture TROCAR-shaped prova 2 passos sem 6º kind', () => {
  it('passo 1 (mão própria) → passo 2 (mão oculta do oponente) → aplica com as duas escolhas', () => {
    installFixtures({ [FIXTURE_CHAIN]: fixtureChainDef });
    useGameStore.setState({
      turn: 'PLAYER',
      playerEnergy: 3,
      playerHand: [{ uid: 'p', cardId: FIXTURE_CHAIN }],
    });

    expect(useGameStore.getState().playCard('p')).toBe(true);
    expect(useGameStore.getState().pendingInteraction).toMatchObject({
      kind: 'PICK_ONE_FROM_HAND',
      source: 'PLAYER',
      optionUids: ['own1', 'own2'],
    });

    expect(
      useGameStore.getState().resolveInteraction('PLAYER', { kind: 'PICK_ONE_FROM_HAND', uid: 'own2' }),
    ).toBe(true);

    // Passo 2: a MESMA interação avançou, agora pedindo a mão OCULTA do oponente.
    const step2 = useGameStore.getState().pendingInteraction;
    expect(step2).toMatchObject({ kind: 'PICK_ONE_FROM_HAND', source: 'MACHINE', optionUids: ['m1', 'm2'] });
    expect(step2?.priorSelections).toEqual([{ kind: 'PICK_ONE_FROM_HAND', uid: 'own2' }]);

    expect(
      useGameStore.getState().resolveInteraction('PLAYER', { kind: 'PICK_ONE_FROM_HAND', uid: 'm1' }),
    ).toBe(true);

    const state = useGameStore.getState();
    expect(state.pendingInteraction).toBeNull();
    expect(state.terminalLog.at(-1)).toMatchObject({ code: 'CARD_HAND_SWAP', value: 'own2->m1' });
  });
});

describe('resolveInteraction devolvendo null reembolsa como cancelamento explícito', () => {
  it('um passo inválido não trava nem perde recurso — carta e energia voltam', () => {
    installFixtures({ [FIXTURE_NULL_STEP]: fixtureNullStepDef });
    useGameStore.setState({
      turn: 'PLAYER',
      playerEnergy: 3,
      playerHand: [{ uid: 'p', cardId: FIXTURE_NULL_STEP }],
    });

    expect(useGameStore.getState().playCard('p')).toBe(true);
    expect(useGameStore.getState().playerEnergy).toBe(2); // custo 1

    // effect() devolve null para QUALQUER seleção no passo 2 — fixture propositalmente inválida.
    expect(
      useGameStore.getState().resolveInteraction('PLAYER', { kind: 'PICK_ONE_FROM_HAND', uid: 'm1' }),
    ).toBe(true); // a AÇÃO foi processada com sucesso — como um cancelamento

    const state = useGameStore.getState();
    expect(state.playerEnergy).toBe(3); // reembolsado
    expect(state.playerHand).toEqual([{ uid: 'p', cardId: FIXTURE_NULL_STEP }]);
    expect(state.pendingInteraction).toBeNull();
  });
});

describe('pendingInteraction não sobrevive a turno/rodada', () => {
  it('canPlaceAt recusa colocar peça enquanto há interação pendente', () => {
    installFixtures({ [FIXTURE_PICK_ONE]: fixturePickOneDef });
    useGameStore.setState({
      turn: 'PLAYER',
      playerEnergy: 3,
      playerHand: [{ uid: 'p', cardId: FIXTURE_PICK_ONE }],
    });
    expect(useGameStore.getState().playCard('p')).toBe(true);

    const before = useGameStore.getState();
    const placed = useGameStore.getState().placeMark('PLAYER', 0);
    const after = useGameStore.getState();

    expect(placed).toBe(false);
    expect(after).toBe(before);
  });

  it('endTurn recusa passar a vez enquanto há interação pendente', () => {
    installFixtures({ [FIXTURE_PICK_ONE]: fixturePickOneDef });
    useGameStore.setState({
      turn: 'PLAYER',
      playerEnergy: 3,
      playerHand: [{ uid: 'p', cardId: FIXTURE_PICK_ONE }],
    });
    expect(useGameStore.getState().playCard('p')).toBe(true);

    expect(useGameStore.getState().endTurn('PLAYER')).toBe(false);
    expect(useGameStore.getState().pendingInteraction).not.toBeNull();
  });

  it('startNextRound limpa pendingInteraction', () => {
    useGameStore.setState({
      pendingInteraction: {
        kind: 'BOARD_TARGET',
        caster: 'PLAYER',
        cardId: 'BREAK_PIECE',
        cardUid: 'x',
        handIndex: 0,
        priorSelections: [],
      },
      status: 'ROUND_OVER',
      roundWinner: 'PLAYER',
    });

    useGameStore.getState().startNextRound();

    expect(useGameStore.getState().pendingInteraction).toBeNull();
  });
});

describe('resolveCounterTraps — regressão via applyCardEffectResult (Fase 3)', () => {
  it('uma armadilha reativa aplica consumesTurn e opensAltar de graça, não só patch/log/damage', () => {
    installFixtures({ [FIXTURE_COUNTER_TRAP]: fixtureCounterTrapDef });
    useGameStore.setState({
      turn: 'MACHINE',
      machineEnergy: 3,
      machineHp: 3, // HEAL_SELF.canPlay exige HP abaixo do teto
      machineHand: [{ uid: 'h', cardId: 'HEAL_SELF' }],
      playerTraps: [{ uid: 't', cardId: FIXTURE_COUNTER_TRAP }],
    });

    const hpBefore = useGameStore.getState().machineHp;
    const turnCountBefore = useGameStore.getState().turnCount;

    expect(useGameStore.getState().playMachineCard('h')).toBe(true);

    const state = useGameStore.getState();
    // A armadilha vetou — HEAL_SELF nunca curou a MACHINE.
    expect(state.machineHp).toBe(hpBefore);
    expect(state.playerTraps).toEqual([]); // a armadilha se consumiu
    // opensAltar: applyCardEffectResult publicou o prompt para o DONO da
    // armadilha (defender = PLAYER) — antes da unificação, resolveCounterTraps
    // não processava este campo.
    expect(state.lastAltarPrompt).toEqual({ caster: 'PLAYER', id: 0 });
    // consumesTurn: turnCount avançou mesmo a carta do ATOR (MACHINE) nunca
    // tendo resolvido — antes da unificação, resolveCounterTraps não mexia em
    // turnCount/turn.
    expect(state.turnCount).toBe(turnCountBefore + 1);
  });

  it('rechecka findWinner: uma inversão de armadilha que fecha uma linha declara vitória de rodada mesmo dentro do veto', () => {
    installFixtures({ [FIXTURE_WIN_TRAP]: fixtureWinTrapDef });
    // ROUND_OVER agenda `scheduleRoundTransition` (setTimeout real) — sem fake
    // timers o timer vazaria para o teste seguinte (mesmo padrão já usado nos
    // testes de `forcedVanish`).
    vi.useFakeTimers();
    useGameStore.setState({
      turn: 'MACHINE',
      machineEnergy: 3,
      machineHp: 3, // HEAL_SELF.canPlay exige HP abaixo do teto
      machineHand: [{ uid: 'h', cardId: 'HEAL_SELF' }],
      playerTraps: [{ uid: 't', cardId: FIXTURE_WIN_TRAP }],
    });

    const hpBefore = useGameStore.getState().machineHp;

    expect(useGameStore.getState().playMachineCard('h')).toBe(true);

    const state = useGameStore.getState();
    expect(state.status).toBe('ROUND_OVER');
    expect(state.roundWinner).toBe('PLAYER');
    expect(state.machineHp).toBeLessThan(hpBefore); // ROUND_DAMAGE aplicado ao perdedor
  });
});

describe('Fase 4 — cobertura com carta real (fecha a lacuna dos kinds só-fixture da Fase 3)', () => {
  it('PICK_ONE_FROM_HAND: SAQUE (carta real) abre a escolha e resolve o roubo pelo store', () => {
    // Controla o coin flip de SAQUE direto no canal `CARDS` — mesma carta
    // real, sem fixture nenhuma; só força o ramo de sucesso.
    vi.spyOn(getChannel('CARDS'), 'chance').mockReturnValue(true);

    useGameStore.setState({
      turn: 'PLAYER',
      playerEnergy: 3,
      playerHand: [{ uid: 'saque', cardId: 'HAND_RAID' }],
      machineHand: [{ uid: 'm1', cardId: 'HEAL_SELF' }],
    });

    expect(useGameStore.getState().playCard('saque')).toBe(true);
    expect(useGameStore.getState().pendingInteraction).toMatchObject({
      kind: 'PICK_ONE_FROM_HAND',
      source: 'MACHINE',
      optionUids: ['m1'],
    });

    expect(
      useGameStore.getState().resolveInteraction('PLAYER', { kind: 'PICK_ONE_FROM_HAND', uid: 'm1' }),
    ).toBe(true);

    const state = useGameStore.getState();
    expect(state.pendingInteraction).toBeNull();
    expect(state.playerHand).toEqual([{ uid: 'm1', cardId: 'HEAL_SELF' }]);
    expect(state.machineHand).toEqual([]);
  });

  it('PICK_MANY_FROM_HAND: ESPIONAGEM (carta real) clampa count pro tamanho real da mão (1 carta)', () => {
    useGameStore.setState({
      turn: 'PLAYER',
      playerEnergy: 3,
      playerHand: [{ uid: 'esp', cardId: 'INTEL_REVEAL' }],
      machineHand: [{ uid: 'm1', cardId: 'HEAL_SELF' }], // só 1 carta — caso de borda da spec
    });

    expect(useGameStore.getState().playCard('esp')).toBe(true);
    expect(useGameStore.getState().pendingInteraction).toMatchObject({
      kind: 'PICK_MANY_FROM_HAND',
      optionUids: ['m1'],
      count: 1, // pedido era 2 — clampado pelo openInteraction (Fase 3)
    });

    expect(
      useGameStore.getState().resolveInteraction('PLAYER', { kind: 'PICK_MANY_FROM_HAND', uids: ['m1'] }),
    ).toBe(true);

    const state = useGameStore.getState();
    expect(state.pendingInteraction).toBeNull();
    expect(state.machineRevealedUids).toEqual(['m1']);
    expect(state.machineHand).toEqual([{ uid: 'm1', cardId: 'HEAL_SELF' }]); // nada foi descartado
  });

  it('PICK_ONE_REVEALED: PROCRASTINAR (carta real) abre 3 opções do deck e resolve por cardId', () => {
    useGameStore.setState({
      turn: 'PLAYER',
      playerEnergy: 3,
      playerHand: [{ uid: 'proc', cardId: 'CARD_DRAFT' }],
    });

    expect(useGameStore.getState().playCard('proc')).toBe(true);
    const pending = useGameStore.getState().pendingInteraction;
    expect(pending?.kind).toBe('PICK_ONE_REVEALED');
    const options = pending?.kind === 'PICK_ONE_REVEALED' ? pending.options : [];
    expect(options).toHaveLength(3);

    expect(
      useGameStore
        .getState()
        .resolveInteraction('PLAYER', { kind: 'PICK_ONE_REVEALED', cardId: options[0] }),
    ).toBe(true);

    const state = useGameStore.getState();
    expect(state.pendingInteraction).toBeNull();
    expect(state.playerHand).toHaveLength(1);
    expect(state.playerHand[0].cardId).toBe(options[0]);
  });

  it('TROCAR (carta real): encadeamento de 2 passos completo pelo store, de ponta a ponta', () => {
    useGameStore.setState({
      turn: 'PLAYER',
      playerEnergy: 3,
      playerHand: [
        { uid: 't', cardId: 'SINGLE_CARD_TRADE' },
        { uid: 'o', cardId: 'HEAL_SELF' },
      ],
      machineHand: [{ uid: 'm1', cardId: 'DIRECT_DAMAGE' }],
    });

    expect(useGameStore.getState().playCard('t')).toBe(true);
    expect(useGameStore.getState().pendingInteraction).toMatchObject({
      kind: 'PICK_ONE_FROM_HAND',
      source: 'PLAYER',
      optionUids: ['o'],
    });

    expect(
      useGameStore.getState().resolveInteraction('PLAYER', { kind: 'PICK_ONE_FROM_HAND', uid: 'o' }),
    ).toBe(true);
    expect(useGameStore.getState().pendingInteraction).toMatchObject({
      kind: 'PICK_ONE_FROM_HAND',
      source: 'MACHINE',
      optionUids: ['m1'],
    });

    expect(
      useGameStore.getState().resolveInteraction('PLAYER', { kind: 'PICK_ONE_FROM_HAND', uid: 'm1' }),
    ).toBe(true);

    const state = useGameStore.getState();
    expect(state.pendingInteraction).toBeNull();
    expect(state.playerHand).toEqual([{ uid: 'm1', cardId: 'DIRECT_DAMAGE' }]);
    expect(state.machineHand).toEqual([{ uid: 'o', cardId: 'HEAL_SELF' }]);
  });
});
