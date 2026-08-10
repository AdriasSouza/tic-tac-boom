import { describe, expect, it } from 'vitest';

import { chooseCpuCardPlay, playCPUTurn, type CpuActions } from '@/engine/ai/cpu';
import { createTestState } from '@/engine/testHelpers';
import type { Board, InteractionSelection } from '@/engine/rules';

function boardWith(entries: Partial<Record<number, NonNullable<Board[number]>>>): Board {
  const board: Board = Array(9).fill(null);
  for (const [index, p] of Object.entries(entries)) board[Number(index)] = p ?? null;
  return board;
}

/** Contador de chamadas — nenhum dos dois testes de `playCPUTurn` precisa da store real. */
function trackedActions(): {
  actions: CpuActions;
  calls: { placeMark: number; endTurn: number; resolveInteraction: number };
} {
  const calls = { placeMark: 0, endTurn: 0, resolveInteraction: 0 };
  const actions: CpuActions = {
    placeMark: () => {
      calls.placeMark += 1;
    },
    playCard: () => false,
    endTurn: () => {
      calls.endTurn += 1;
    },
    resolveInteraction: () => {
      calls.resolveInteraction += 1;
      return false;
    },
  };
  return { actions, calls };
}

describe('chooseCpuCardPlay — regressão de energia baixa', () => {
  it('nunca escolhe uma carta cara demais, mesmo quando a prioridade a favoreceria', () => {
    // machineHp<=2 e playerHp<=2 disparariam as duas primeiras prioridades
    // (cura crítica, abate) se a energia permitisse — as duas cartas custam 3.
    const state = createTestState({
      turn: 'MACHINE',
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
    const state = createTestState({
      turn: 'MACHINE',
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

describe('playCPUTurn — REBOBINAR (machinePlacementBlocked), primeiro teste desta função', () => {
  it('bloqueada: chama endTurn e NUNCA placeMark (o soft-lock que esta fase existe para eliminar)', async () => {
    const state = createTestState({ turn: 'MACHINE', machinePlacementBlocked: true });
    const { actions, calls } = trackedActions();

    const decision = await playCPUTurn(state, actions, {
      getState: () => state,
      minDelay: 0,
      maxDelay: 0,
    });

    expect(decision).toBeNull();
    expect(calls.placeMark).toBe(0);
    expect(calls.endTurn).toBe(1);
  });

  it('sem a flag: comportamento de sempre — coloca peça, nunca endTurn (regressão)', async () => {
    const state = createTestState({ turn: 'MACHINE' });
    const { actions, calls } = trackedActions();

    const decision = await playCPUTurn(state, actions, {
      getState: () => state,
      minDelay: 0,
      maxDelay: 0,
    });

    expect(decision).not.toBeNull();
    expect(calls.placeMark).toBe(1);
    expect(calls.endTurn).toBe(0);
  });

  it('guarda defensiva: bloqueada E com pendingAcknowledgement pendente não chama nem endTurn nem placeMark', async () => {
    // Estado montado à mão — hoje INALCANÇÁVEL pelo caminho real (o hook
    // `useCpuOpponent` já tem `hasPendingAcknowledgement` nas próprias
    // dependências e recusa agendar esta função nesse caso). O teste trava o
    // CONTRATO da função, não o caminho de chamada de hoje: se uma fonte nova
    // de `pendingAcknowledgement` aparecer no futuro sem passar pelas duas
    // checagens já existentes, `playCPUTurn` continua não fazendo nada em vez
    // de chamar `endTurn` (que a store recusaria de qualquer forma) e travar
    // em silêncio.
    const state = createTestState({
      turn: 'MACHINE',
      machinePlacementBlocked: true,
      pendingAcknowledgement: {
        id: 1,
        code: 'CARD_PLAYED',
        kind: 'INFO',
        subject: 'MACHINE',
        revealedCards: [],
      },
    });
    const { actions, calls } = trackedActions();

    const decision = await playCPUTurn(state, actions, {
      getState: () => state,
      minDelay: 0,
      maxDelay: 0,
    });

    expect(decision).toBeNull();
    expect(calls.placeMark).toBe(0);
    expect(calls.endTurn).toBe(0);
  });
});

describe('playCPUTurn — resolve a própria pendingInteraction (Fase 4, Achado 3: SAQUE/SABOTAGEM não travam mais)', () => {
  it('resolve a interação pendente da própria CPU e continua até colocar peça, sem travar', async () => {
    // Simula a 2ª chamada da sequência real (ver comentário em cpu.ts): a CPU
    // já jogou SAQUE, o anúncio já foi confirmado e a interação
    // (PICK_ONE_FROM_HAND) já está aberta — exatamente o estado em que o
    // hook re-dispara `playCPUTurn` depois do "Entendi" do humano.
    let state = createTestState({
      turn: 'MACHINE',
      turnCount: 5,
      pendingInteraction: {
        kind: 'PICK_ONE_FROM_HAND',
        caster: 'MACHINE',
        cardId: 'HAND_RAID',
        cardUid: 'saque',
        handIndex: 0,
        priorSelections: [],
        source: 'PLAYER',
        optionUids: ['a', 'b'],
      },
    });

    const calls = { placeMark: 0, endTurn: 0, resolveInteraction: 0 };
    const actions: CpuActions = {
      placeMark: () => {
        calls.placeMark += 1;
      },
      playCard: () => false,
      endTurn: () => {
        calls.endTurn += 1;
      },
      resolveInteraction: (selection) => {
        calls.resolveInteraction += 1;
        expect(selection.kind).toBe('PICK_ONE_FROM_HAND');
        // Simula o efeito real de `resolveInteraction` na store: fecha a interação.
        state = { ...state, pendingInteraction: null };
        return true;
      },
    };

    const decision = await playCPUTurn(state, actions, {
      getState: () => state,
      minDelay: 0,
      maxDelay: 0,
    });

    expect(calls.resolveInteraction).toBe(1);
    // Sem a correção da Fase 4, a guarda antiga (`pendingInteraction !== null
    // → return null`) travaria aqui pra sempre — `chooseCpuCardPlay` nem
    // chegaria a rodar de novo (já bloqueado no topo da função).
    expect(calls.placeMark).toBe(1);
    expect(calls.endTurn).toBe(0);
    expect(decision).not.toBeNull();
  });

  it('guarda defensiva: nunca resolve uma interação cujo caster não é a CPU', async () => {
    const state = createTestState({
      turn: 'MACHINE',
      pendingInteraction: {
        kind: 'BOARD_TARGET',
        caster: 'PLAYER',
        cardId: 'BREAK_PIECE',
        cardUid: 'x',
        handIndex: 0,
        priorSelections: [],
      },
    });
    const { actions, calls } = trackedActions();

    const decision = await playCPUTurn(state, actions, {
      getState: () => state,
      minDelay: 0,
      maxDelay: 0,
    });

    expect(decision).toBeNull();
    expect(calls.resolveInteraction).toBe(0);
    expect(calls.placeMark).toBe(0);
    expect(calls.endTurn).toBe(0);
  });
});

/* -------------------------------------------------------------------------- */
/*     PATCH PÓS-FASE 7A: multi-carta por turno + cobertura das 9 cartas      */
/* -------------------------------------------------------------------------- */

describe('chooseCpuCardPlay — múltiplas cartas por turno (sem rastreamento de "já joguei uma carta")', () => {
  it('a 2ª chamada decide de novo com o estado JÁ atualizado pela 1ª — nenhum campo de turno bloqueia', () => {
    const state1 = createTestState({
      turn: 'MACHINE',
      turnCount: 5,
      machineEnergy: 2,
      machineHp: 3,
      machineHand: [
        { uid: 'shield', cardId: 'BACKUP_BATTERY' },
        { uid: 'lock', cardId: 'LOCK_CELL' },
      ],
    });

    const first = chooseCpuCardPlay(state1);
    expect(first?.cardId).toBe('BACKUP_BATTERY');

    // Simula o efeito de jogar a 1ª carta: sai da mão, debita energia, ativa
    // o escudo — exatamente o que `resolveCardPlay` teria feito de verdade.
    const state2 = createTestState({
      ...state1,
      machineEnergy: 1,
      machineShield: true,
      machineHand: [{ uid: 'lock', cardId: 'LOCK_CELL' }],
    });

    const second = chooseCpuCardPlay(state2);
    expect(second?.cardId).toBe('LOCK_CELL');
  });
});

describe('chooseCpuCardPlay — BATERIA RESERVA (carta nova)', () => {
  it('ativa o escudo quando machucada (hp<=3) e ainda sem escudo', () => {
    const state = createTestState({
      turn: 'MACHINE',
      machineEnergy: 1,
      machineHp: 3,
      machineHand: [{ uid: 'shield', cardId: 'BACKUP_BATTERY' }],
    });
    expect(chooseCpuCardPlay(state)?.cardId).toBe('BACKUP_BATTERY');
  });

  it('não usa com HP cheio', () => {
    const state = createTestState({
      turn: 'MACHINE',
      machineEnergy: 1,
      machineHp: 5,
      machineHand: [{ uid: 'shield', cardId: 'BACKUP_BATTERY' }],
    });
    expect(chooseCpuCardPlay(state)).toBeNull();
  });

  it('não usa com o escudo já ativo', () => {
    const state = createTestState({
      turn: 'MACHINE',
      machineEnergy: 1,
      machineHp: 2,
      machineShield: true,
      machineHand: [{ uid: 'shield', cardId: 'BACKUP_BATTERY' }],
    });
    expect(chooseCpuCardPlay(state)).toBeNull();
  });
});

describe('chooseCpuCardPlay — CÁPSULA DO TEMPO (carta nova): prioridade própria quando o HP está crítico', () => {
  it('arma quando HP crítico (<=2) e ainda não tem uma armada', () => {
    const state = createTestState({
      turn: 'MACHINE',
      machineEnergy: 1,
      machineHp: 2,
      machineHand: [{ uid: 'cap', cardId: 'TIME_CAPSULE' }],
    });
    expect(chooseCpuCardPlay(state)?.cardId).toBe('TIME_CAPSULE');
  });

  it('com HP não crítico, ainda é escolhida pela regra genérica de armadilha (prioridade mais baixa)', () => {
    const state = createTestState({
      turn: 'MACHINE',
      machineEnergy: 1,
      machineHp: 5,
      machineTraps: [{ uid: 't1', cardId: 'TIME_CAPSULE' }],
      machineHand: [{ uid: 'cap2', cardId: 'TIME_CAPSULE' }],
    });
    expect(chooseCpuCardPlay(state)?.cardId).toBe('TIME_CAPSULE');
  });

  it('não arma nada (nem pela regra crítica, nem pela genérica) com a mesa de armadilhas cheia', () => {
    const state = createTestState({
      turn: 'MACHINE',
      machineEnergy: 1,
      machineHp: 2,
      machineTraps: [
        { uid: 't1', cardId: 'TIME_CAPSULE' },
        { uid: 't2', cardId: 'SHIELD_TRAP' },
        { uid: 't3', cardId: 'ANTI_SPELL_TRAP' },
      ],
      machineHand: [{ uid: 'cap2', cardId: 'TIME_CAPSULE' }],
    });
    expect(chooseCpuCardPlay(state)).toBeNull();
  });
});

describe('chooseCpuCardPlay — RENOVAR (carta nova)', () => {
  it('renova a peça mais antiga com 2+ peças próprias no tabuleiro', () => {
    const board = boardWith({
      0: { owner: 'MACHINE', mark: 'O', turnPlaced: 1 },
      1: { owner: 'MACHINE', mark: 'O', turnPlaced: 2 },
    });
    const state = createTestState({
      turn: 'MACHINE',
      machineEnergy: 1,
      board,
      machineHand: [{ uid: 'renew', cardId: 'RENEW_PIECE' }],
    });
    const decision = chooseCpuCardPlay(state);
    expect(decision?.cardId).toBe('RENEW_PIECE');
    expect(decision?.targetIndex).toBe(0); // a mais antiga (turnPlaced 1)
  });

  it('não usa com só 1 peça própria no tabuleiro', () => {
    const board = boardWith({ 0: { owner: 'MACHINE', mark: 'O', turnPlaced: 1 } });
    const state = createTestState({
      turn: 'MACHINE',
      machineEnergy: 1,
      board,
      machineHand: [{ uid: 'renew', cardId: 'RENEW_PIECE' }],
    });
    expect(chooseCpuCardPlay(state)).toBeNull();
  });
});

describe('chooseCpuCardPlay — DESLIZAR (carta nova): fecha linha na hora quando possível', () => {
  it('prioriza o abate por deslizamento — mesma urgência de uma vitória por colocação', () => {
    // 0 e 1 já são MACHINE; a peça em 5 desliza pra 2 (vizinho ortogonal) e
    // fecha [0,1,2].
    const board = boardWith({
      0: { owner: 'MACHINE', mark: 'O', turnPlaced: 1 },
      1: { owner: 'MACHINE', mark: 'O', turnPlaced: 2 },
      5: { owner: 'MACHINE', mark: 'O', turnPlaced: 3 },
    });
    const state = createTestState({
      turn: 'MACHINE',
      machineEnergy: 1,
      board,
      machineHand: [{ uid: 'slide', cardId: 'SLIDE_PIECE' }],
    });
    const decision = chooseCpuCardPlay(state);
    expect(decision?.cardId).toBe('SLIDE_PIECE');
    expect(decision?.targetIndex).toBe(5);
  });

  it('sem vitória por deslizamento nem vizinho vazio disponível, não usa a carta', () => {
    // Peça própria isolada num canto, os dois vizinhos ortogonais ocupados
    // pelo oponente — nem vence deslizando, nem sobra pra onde deslizar de
    // qualquer jeito (evita depender do RNG do ramo oportunista).
    const board = boardWith({
      0: { owner: 'MACHINE', mark: 'O', turnPlaced: 1 },
      1: { owner: 'PLAYER', mark: 'X', turnPlaced: 2 },
      3: { owner: 'PLAYER', mark: 'X', turnPlaced: 3 },
    });
    const state = createTestState({
      turn: 'MACHINE',
      machineEnergy: 1,
      board,
      machineHand: [{ uid: 'slide', cardId: 'SLIDE_PIECE' }],
    });
    expect(chooseCpuCardPlay(state)).toBeNull();
  });
});

describe('chooseCpuCardPlay — APAGÃO (carta nova)', () => {
  it('drena quando o oponente tem energia relevante (>=2)', () => {
    const state = createTestState({
      turn: 'MACHINE',
      machineEnergy: 2,
      playerEnergy: 2,
      machineHand: [{ uid: 'blackout', cardId: 'BLACKOUT' }],
    });
    expect(chooseCpuCardPlay(state)?.cardId).toBe('BLACKOUT');
  });

  it('não usa se o oponente tiver pouca energia (<2) — denial que não denega nada', () => {
    const state = createTestState({
      turn: 'MACHINE',
      machineEnergy: 2,
      playerEnergy: 1,
      machineHand: [{ uid: 'blackout', cardId: 'BLACKOUT' }],
    });
    expect(chooseCpuCardPlay(state)).toBeNull();
  });
});

describe('chooseCpuCardPlay — RECICLAR (carta nova)', () => {
  it('nunca é escolhida com ela sendo a única carta na mão (nada pra descartar)', () => {
    const state = createTestState({
      turn: 'MACHINE',
      machineEnergy: 1,
      machineHand: [{ uid: 'mull', cardId: 'MULLIGAN' }],
    });
    expect(chooseCpuCardPlay(state)).toBeNull();
  });
});

describe('playCPUTurn — resolve PICK_BOARD_CELL (2º passo de DESLIZAR, carta nova)', () => {
  it('entre os destinos elegíveis, escolhe o que fecha linha — não sorteia (achado: case que faltava, soft-lock latente)', async () => {
    const board = boardWith({
      0: { owner: 'MACHINE', mark: 'O', turnPlaced: 1 },
      1: { owner: 'MACHINE', mark: 'O', turnPlaced: 2 },
      5: { owner: 'MACHINE', mark: 'O', turnPlaced: 3 },
    });
    let state = createTestState({
      turn: 'MACHINE',
      board,
      pendingInteraction: {
        kind: 'PICK_BOARD_CELL',
        caster: 'MACHINE',
        cardId: 'SLIDE_PIECE',
        cardUid: 'slide',
        handIndex: 0,
        priorSelections: [{ kind: 'BOARD_TARGET', index: 5 }],
        eligibleIndexes: [2, 8, 4], // vizinhos ortogonais vazios de 5
      },
    });

    let resolvedSelection: InteractionSelection | null = null;
    const actions: CpuActions = {
      placeMark: () => {},
      playCard: () => false,
      endTurn: () => {},
      resolveInteraction: (selection) => {
        resolvedSelection = selection;
        state = { ...state, pendingInteraction: null };
        return true;
      },
    };

    await playCPUTurn(state, actions, { getState: () => state, minDelay: 0, maxDelay: 0 });

    expect(resolvedSelection).toEqual({ kind: 'PICK_BOARD_CELL', index: 2 });
  });

  it('sem destino vencedor entre os elegíveis, sorteia um deles — mesma heurística ingênua dos outros kinds', async () => {
    const board = boardWith({ 4: { owner: 'MACHINE', mark: 'O', turnPlaced: 1 } });
    let state = createTestState({
      turn: 'MACHINE',
      board,
      pendingInteraction: {
        kind: 'PICK_BOARD_CELL',
        caster: 'MACHINE',
        cardId: 'SLIDE_PIECE',
        cardUid: 'slide',
        handIndex: 0,
        priorSelections: [{ kind: 'BOARD_TARGET', index: 4 }],
        eligibleIndexes: [1, 3, 5, 7],
      },
    });

    const captured: { selection: InteractionSelection | null } = { selection: null };
    const actions: CpuActions = {
      placeMark: () => {},
      playCard: () => false,
      endTurn: () => {},
      resolveInteraction: (selection) => {
        captured.selection = selection;
        state = { ...state, pendingInteraction: null };
        return true;
      },
    };

    await playCPUTurn(state, actions, { getState: () => state, minDelay: 0, maxDelay: 0 });

    expect(captured.selection?.kind).toBe('PICK_BOARD_CELL');
    if (captured.selection?.kind === 'PICK_BOARD_CELL') {
      expect([1, 3, 5, 7]).toContain(captured.selection.index);
    }
  });
});
