import { describe, expect, it } from 'vitest';

import { chooseCpuCardPlay, playCPUTurn, type CpuActions } from '@/engine/ai/cpu';
import { createTestState } from '@/engine/testHelpers';

/** Contador de chamadas — nenhum dos dois testes de `playCPUTurn` precisa da store real. */
function trackedActions(): { actions: CpuActions; calls: { placeMark: number; endTurn: number } } {
  const calls = { placeMark: 0, endTurn: 0 };
  const actions: CpuActions = {
    placeMark: () => {
      calls.placeMark += 1;
    },
    playCard: () => false,
    endTurn: () => {
      calls.endTurn += 1;
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
