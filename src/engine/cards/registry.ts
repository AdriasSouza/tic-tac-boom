import { CENTER_INDEX } from '@/engine/events';
import { occupiedIndexes, opponentOf } from '@/engine/rules';
import type { Rng } from '@/engine/rng';
import type { CardDefinition, CardId } from './definitions';

/* -------------------------------------------------------------------------- */
/*                                    CARTAS                                   */
/* -------------------------------------------------------------------------- */
/* PoC: duas cartas de ação. Adicionar uma nova = criar o objeto aqui e somar
   o id em `CardId`. O TypeScript acusa se você esquecer um dos dois lados.   */

const BREAK_PIECE: CardDefinition = {
  id: 'BREAK_PIECE',
  name: 'DEMOLIR',
  type: 'ACTION',
  description: 'Escolha uma peça no tabuleiro e destrua.',
  targeting: 'OCCUPIED_CELL',
  weight: 3,

  requiresTarget: true,

  /**
   * Qualquer célula ocupada, inclusive as próprias.
   *
   * Poderia ser restrito ao oponente, mas destruir a própria peça é jogada
   * legítima no modo infinito: remove a peça mais antiga e reordena a fila,
   * comprando tempo antes que a próxima jogada apague algo que você queria
   * manter. Para restringir, troque por `cell.owner !== caster`.
   */
  isValidTarget: ({ state, index }) => state.board[index] !== null,

  canPlay: ({ state }) => occupiedIndexes(state).length > 0,

  effect: ({ state, targetIndex }) => {
    // Com `requiresTarget`, o store garante que targetIndex chegou validado.
    // A checagem sobrevive como rede de segurança para chamadas programáticas
    // (IA, testes) que não passam pelo fluxo de mira da UI.
    if (targetIndex === undefined) return null;
    if (targetIndex < 0 || targetIndex > 8) return null;
    if (state.board[targetIndex] === null) return null;

    const board = [...state.board];
    board[targetIndex] = null;

    return {
      patch: { board, lastVanishedIndex: targetIndex },
      message: 'demolir :: célula ' + targetIndex,
    };
  },
};

const EXTRA_TURN: CardDefinition = {
  id: 'EXTRA_TURN',
  name: 'REBOBINAR',
  type: 'ACTION',
  description: 'Sua próxima jogada não passa a vez.',
  targeting: 'NONE',
  weight: 2,

  // Não empilha: jogar duas seguidas desperdiçaria a segunda.
  canPlay: ({ state, caster }) => state.extraTurnPending !== caster,

  effect: ({ caster }) => ({
    patch: { extraTurnPending: caster },
    message: 'rebobinar :: turno extra armado',
  }),
};

const BOMB_TRAP: CardDefinition = {
  id: 'BOMB_TRAP',
  name: 'MINA',
  type: 'TRAP',
  description: 'Virada na mesa. Detona se o oponente ocupar o centro: 2 de dano e ele perde a vez.',
  targeting: 'NONE',
  weight: 2,

  /**
   * O barramento já filtrou por autoria — só eventos causados pelo oponente
   * chegam aqui. Basta checar o fato em si.
   */
  triggerCondition: (event) => event.type === 'PIECE_PLACED' && event.index === CENTER_INDEX,

  effect: ({ caster }) => ({
    damage: { target: opponentOf(caster), amount: 2 },

    /**
     * "Cancela a vez dele" traduzido para a máquina que já existe.
     *
     * Quando a mina detona, o atacante já gastou o turno e a vez já passou
     * para o defensor. Marcar `extraTurnPending` no defensor faz a próxima
     * jogada dele não passar a vez — efeito líquido idêntico a o atacante ter
     * perdido um turno, sem inventar um segundo mecanismo de alternância.
     */
    patch: { extraTurnPending: caster },

    message: 'mina :: centro detonado',
  }),
};

/* -------------------------------------------------------------------------- */
/*                                   REGISTRY                                  */
/* -------------------------------------------------------------------------- */

/**
 * Fonte única de verdade das cartas.
 *
 * `Record<CardId, …>` obriga exaustividade: se você adicionar um id em
 * `CardId` e esquecer de registrar aqui, o build quebra.
 */
export const CARD_REGISTRY: Record<CardId, CardDefinition> = {
  BREAK_PIECE,
  EXTRA_TURN,
  BOMB_TRAP,
};

export const CARD_IDS = Object.keys(CARD_REGISTRY) as CardId[];

/** Acesso tipado ao registry. Lança em id desconhecido (bug de programação). */
export function getCard(id: CardId): CardDefinition {
  const card = CARD_REGISTRY[id];
  if (!card) throw new Error(`[cards] carta desconhecida: ${id}`);
  return card;
}

/** Tabela de pesos pronta para `rng.weighted`, montada uma vez só. */
const WEIGHTED_POOL = CARD_IDS.map((id) => [id, CARD_REGISTRY[id].weight] as const);

/** Sorteia um id de carta pelo peso, usando o canal `CARDS` do RNG. */
export function drawCardId(rng: Rng): CardId {
  return rng.weighted(WEIGHTED_POOL);
}
