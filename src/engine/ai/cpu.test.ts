import { describe, expect, it } from 'vitest';

import { chooseCpuCardPlay } from '@/engine/ai/cpu';
import { createTestState } from '@/engine/testHelpers';

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
