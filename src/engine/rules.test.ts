import { describe, expect, it } from 'vitest';

import { ENERGY_CAP, regenEnergy } from '@/engine/rules';

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
