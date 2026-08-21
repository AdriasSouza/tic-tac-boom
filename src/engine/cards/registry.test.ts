import { describe, expect, it } from 'vitest';

import { RARITY_DRAW_WEIGHT, type CardRarity } from '@/engine/cards/definitions';
import { CARD_REGISTRY, drawCardId } from '@/engine/cards/registry';
import { getChannel, seedMatch } from '@/engine/rng';

const SEED = 424242;

function drawMany(seed: number, count: number): string[] {
  seedMatch(seed);
  const rng = getChannel('CARDS');
  return Array.from({ length: count }, () => drawCardId(rng));
}

describe('drawCardId — determinismo', () => {
  it('a mesma seed produz a mesma sequência de 1000 sorteios', () => {
    const first = drawMany(SEED, 1000);
    const second = drawMany(SEED, 1000);
    expect(second).toEqual(first);
  });
});

describe('drawCardId — distribuição de raridade', () => {
  it('cai dentro de ±10% relativo ao peso esperado de cada faixa, em 50 000 sorteios', () => {
    const draws = drawMany(SEED, 50_000);

    const counts: Record<CardRarity, number> = {
      COMMON: 0,
      RARE: 0,
      EPIC: 0,
      LEGENDARY: 0,
      BOOM: 0,
    };
    for (const id of draws) {
      counts[CARD_REGISTRY[id as keyof typeof CARD_REGISTRY].rarity] += 1;
    }

    for (const rarity of Object.keys(RARITY_DRAW_WEIGHT) as CardRarity[]) {
      const expectedPct = RARITY_DRAW_WEIGHT[rarity];
      const actualPct = (counts[rarity] / draws.length) * 100;
      const tolerance = expectedPct * 0.1; // ±10% relativo, não pp absoluto

      expect(
        actualPct,
        `faixa ${rarity}: esperado ~${expectedPct}%, obtido ${actualPct.toFixed(2)}%`,
      ).toBeGreaterThanOrEqual(expectedPct - tolerance);
      expect(
        actualPct,
        `faixa ${rarity}: esperado ~${expectedPct}%, obtido ${actualPct.toFixed(2)}%`,
      ).toBeLessThanOrEqual(expectedPct + tolerance);
    }
  });
});

describe('drawCardId — TURNO_EXTRA fora do sorteio (Fase 8d, active:false)', () => {
  it('nunca sorteia TURNO_EXTRA em 50 000 amostras', () => {
    const draws = drawMany(SEED, 50_000);
    expect(draws).not.toContain('TURNO_EXTRA');
  });
});
