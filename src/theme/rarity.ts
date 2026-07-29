import type { CardRarity } from '@/engine/cards/definitions';

/**
 * Cor de cada faixa de raridade.
 *
 * Vive no tema (e não junto das definições de carta) porque é decisão de
 * aparência: a engine sorteia por raridade sem nunca precisar saber que
 * lendária é dourada. Mantém `definitions.ts` livre de UI.
 *
 * A escala é convenção de card game — cinza, azul, roxo, dourado — de
 * propósito: o jogador já chega sabendo ler essa hierarquia, e uma paleta
 * "original" aqui só custaria aprendizado sem ganhar nada.
 */
export const RARITY_COLOR: Record<CardRarity, string> = {
  COMMON: '#8fa3b8',
  RARE: '#38bdf8',
  EPIC: '#a855f7',
  LEGENDARY: '#facc15',
};
