import { describe, expect, it } from 'vitest';

import { chooseCpuCardPlay, playCPUTurn, type CpuActions } from '@/engine/ai/cpu';
import { createTestState } from '@/engine/testHelpers';

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
    // já jogou SAQUE (machineCardTurn já setado), o anúncio já foi confirmado
    // e a interação (PICK_ONE_FROM_HAND) já está aberta — exatamente o estado
    // em que o hook re-dispara `playCPUTurn` depois do "Entendi" do humano.
    let state = createTestState({
      turn: 'MACHINE',
      turnCount: 5,
      machineCardTurn: 5,
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
