import { describe, expect, it } from 'vitest';

import { fuseRarity, type CardRarity } from './definitions';

/**
 * Escada de fusão do Altar de Sacrifício (`CLAUDE.md` #5, Fase 6b).
 *
 * As 15 combinações não ordenadas de raridade (5 iguais + 10 cruzadas) — os
 * dois casos de borda documentados (Lendária+Lendária, Boom+Boom) aparecem
 * NOMEADOS abaixo, não só dentro da lista, porque são exatamente o tipo de
 * caso que um `if` especial mal-colocado quebraria silenciosamente.
 */
describe('fuseRarity — escada COMUM -> RARA -> ÉPICA -> LENDÁRIA -> BOOM', () => {
  const LADDER: readonly CardRarity[] = ['COMMON', 'RARE', 'EPIC', 'LEGENDARY', 'BOOM'];

  it.each([
    ['COMMON', 'COMMON', 'RARE'],
    ['RARE', 'RARE', 'EPIC'],
    ['EPIC', 'EPIC', 'LEGENDARY'],
    ['LEGENDARY', 'LEGENDARY', 'BOOM'],
    ['BOOM', 'BOOM', 'BOOM'],
  ] as const)('%s + %s = %s (mesma raridade sobe 1 grau)', (a, b, expected) => {
    expect(fuseRarity(a, b)).toBe(expected);
  });

  it.each([
    ['COMMON', 'RARE', 'RARE'],
    ['COMMON', 'EPIC', 'RARE'],
    ['COMMON', 'LEGENDARY', 'RARE'],
    ['COMMON', 'BOOM', 'RARE'],
    ['RARE', 'EPIC', 'EPIC'],
    ['RARE', 'LEGENDARY', 'EPIC'],
    ['RARE', 'BOOM', 'EPIC'],
    ['EPIC', 'LEGENDARY', 'LEGENDARY'],
    ['EPIC', 'BOOM', 'LEGENDARY'],
    ['LEGENDARY', 'BOOM', 'BOOM'],
  ] as const)('%s + %s = %s (min(a,b) + 1)', (a, b, expected) => {
    expect(fuseRarity(a, b)).toBe(expected);
    expect(fuseRarity(b, a)).toBe(expected); // comutativa
  });

  it('Lendária + Lendária -> Boom: não é um caso especial, é min(3,3)+1=4 dentro da MESMA fórmula genérica', () => {
    expect(fuseRarity('LEGENDARY', 'LEGENDARY')).toBe('BOOM');
  });

  it('Boom + Boom -> Boom: é aqui que Math.min(..., length-1) satura de propósito, sem sair do array', () => {
    expect(fuseRarity('BOOM', 'BOOM')).toBe('BOOM');
  });

  it('o resultado sobe 1 grau acima do MENOR insumo, saturando no topo da escada (Boom)', () => {
    for (const a of LADDER) {
      for (const b of LADDER) {
        const minRank = Math.min(LADDER.indexOf(a), LADDER.indexOf(b));
        const expectedRank = Math.min(minRank + 1, LADDER.length - 1);
        expect(LADDER.indexOf(fuseRarity(a, b))).toBe(expectedRank);
      }
    }
  });
});
