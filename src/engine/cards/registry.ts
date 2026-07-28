import { CENTER_INDEX } from '@/engine/events';
import {
  CARD_RULE_MIN_DURATION_TURNS,
  HAND_LIMIT,
  INITIAL_HP,
  getOldestPieceIndex,
  handKeyFor,
  hpOf,
  occupiedIndexes,
  opponentOf,
} from '@/engine/rules';
import type { Rng } from '@/engine/rng';
import type { GameState } from '@/engine/rules';
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

/* -------------------------------------------------------------------------- */
/*                              AÇÃO DIRETA                                    */
/* -------------------------------------------------------------------------- */

const HEAL_SELF: CardDefinition = {
  id: 'HEAL_SELF',
  name: 'CURAR',
  type: 'ACTION',
  description: 'Recupera 1 HP.',
  targeting: 'NONE',
  weight: 3,

  canPlay: ({ state, caster }) => hpOf(state, caster) < INITIAL_HP,

  effect: ({ caster }) => ({
    heal: { target: caster, amount: 1 },
    message: 'curar :: +1 hp',
  }),
};

const DIRECT_DAMAGE: CardDefinition = {
  id: 'DIRECT_DAMAGE',
  name: 'ATAQUE',
  type: 'ACTION',
  description: 'Causa 1 de dano direto ao oponente.',
  targeting: 'NONE',
  weight: 3,

  effect: ({ caster }) => ({
    damage: { target: opponentOf(caster), amount: 1 },
    message: 'ataque :: 1 de dano direto',
  }),
};

const DRAW_CARD: CardDefinition = {
  id: 'DRAW_CARD',
  name: 'ESTUDAR',
  type: 'ACTION',
  description: 'Compra 1 carta adicional.',
  targeting: 'NONE',
  weight: 3,

  canPlay: ({ state, caster }) => state[handKeyFor(caster)].length < HAND_LIMIT,

  effect: ({ caster }) => ({
    draw: { target: caster, count: 1 },
    message: 'estudar :: comprou 1 carta',
  }),
};

const HAND_RAID: CardDefinition = {
  id: 'HAND_RAID',
  name: 'SAQUE',
  type: 'ACTION',
  description: '50% de chance de roubar uma carta aleatória do oponente; senão, destrói.',
  targeting: 'NONE',
  weight: 1,

  canPlay: ({ state, caster }) => state[handKeyFor(opponentOf(caster))].length > 0,

  // A carta jogada (`uid`) é excluída da mão do caster ANTES de qualquer
  // outra operação — sem isso ela sobreviveria "fantasma" dentro do patch,
  // já que o efeito é a única camada que sabe qual entrada é a jogada.
  effect: ({ state, caster, uid, rng }) => {
    const casterHand = state[handKeyFor(caster)].filter((c) => c.uid !== uid);
    const victimHand = state[handKeyFor(opponentOf(caster))];
    if (victimHand.length === 0) return null;

    const stolen = rng.pick(victimHand);
    const remainingVictimHand = victimHand.filter((c) => c.uid !== stolen.uid);
    const steals = rng.chance(0.5);

    return {
      patch: {
        [handKeyFor(caster)]: steals ? [...casterHand, stolen] : casterHand,
        [handKeyFor(opponentOf(caster))]: remainingVictimHand,
      },
      message: `saque :: ${steals ? 'roubou' : 'destruiu'} uma carta do oponente`,
    };
  },
};

const CLEANSE: CardDefinition = {
  id: 'CLEANSE',
  name: 'PURIFICAR',
  type: 'ACTION',
  description: 'Remove a interdição de célula bloqueada, restaurando a regra normal.',
  targeting: 'NONE',
  weight: 2,

  canPlay: ({ state }) => state.activeRule === 'BLOCKED_CELL',

  effect: ({ state }) => {
    if (state.activeRule !== 'BLOCKED_CELL') return null;
    return {
      patch: { activeRule: 'NORMAL', blockedCell: null, ruleExpiresAtTurn: null },
      message: 'purificar :: bloqueio removido',
    };
  },
};

const HAND_SWAP: CardDefinition = {
  id: 'HAND_SWAP',
  name: 'TROCA',
  type: 'ACTION',
  description: 'Troca sua mão inteira pela mão do oponente.',
  targeting: 'NONE',
  weight: 1,

  effect: ({ state, caster, uid }) => {
    // Exclui a própria TROCA da mão do caster antes de copiá-la para o
    // oponente — senão a carta "sobreviveria" na mão de quem a recebeu.
    const casterHand = state[handKeyFor(caster)].filter((c) => c.uid !== uid);
    const opponentHand = state[handKeyFor(opponentOf(caster))];

    return {
      patch: {
        [handKeyFor(caster)]: opponentHand,
        [handKeyFor(opponentOf(caster))]: casterHand,
      },
      message: 'troca :: mãos trocadas',
    };
  },
};

const REVEAL_OLDEST: CardDefinition = {
  id: 'REVEAL_OLDEST',
  name: 'VIDENTE',
  type: 'ACTION',
  description: 'Revela qual peça do oponente vai sumir na próxima jogada dele.',
  targeting: 'NONE',
  weight: 2,

  canPlay: ({ state, caster }) => getOldestPieceIndex(state.board, opponentOf(caster)) !== null,

  effect: ({ state, caster }) => {
    const index = getOldestPieceIndex(state.board, opponentOf(caster));
    if (index === null) return null;

    const row = Math.floor(index / 3) + 1;
    const col = (index % 3) + 1;
    return { message: `vidente :: peça do oponente em ${row}x${col} vai sumir` };
  },
};

const LOCK_CELL: CardDefinition = {
  id: 'LOCK_CELL',
  name: 'TRAVAR',
  type: 'ACTION',
  description: 'Bloqueia uma célula vazia por 1 turno global.',
  targeting: 'CELL',
  weight: 2,

  requiresTarget: true,
  isValidTarget: ({ state, index }) => state.board[index] === null,

  canPlay: ({ state }) => state.board.some((cell) => cell === null),

  effect: ({ state, targetIndex }) => {
    if (targetIndex === undefined) return null;
    if (state.board[targetIndex] !== null) return null;

    return {
      // Reaproveita o MESMO subsistema da regra caótica BLOCKED_CELL — é
      // literalmente o mesmo mecanismo, só que acionado pelo jogador em vez
      // do terminal.
      //
      // Duração = CARD_RULE_MIN_DURATION_TURNS (2), NUNCA 1: quem lança a
      // carta ainda vai completar a PRÓPRIA jogada antes do oponente sequer
      // decidir. Com +1, o `tickGlobalClock` da jogada de quem lançou a
      // carta já reverteria o bloqueio — o "paradoxo do turno": o efeito
      // nunca chegaria a valer para o adversário.
      patch: {
        activeRule: 'BLOCKED_CELL',
        blockedCell: targetIndex,
        ruleExpiresAtTurn: state.turnCount + CARD_RULE_MIN_DURATION_TURNS,
      },
      message: `travar :: célula ${targetIndex} bloqueada por ${CARD_RULE_MIN_DURATION_TURNS} turnos`,
    };
  },
};

/* -------------------------------------------------------------------------- */
/*                                  INFORMAÇÃO                                  */
/* -------------------------------------------------------------------------- */
/* Diferente de VIDENTE (que só imprime uma linha de log), estas pausam o jogo
   com o modal de confirmação (`acknowledge`) — a informação é importante o
   suficiente para exigir que o jogador realmente a leia antes de seguir.     */

const SPY_CARD: CardDefinition = {
  id: 'SPY_CARD',
  name: 'ESPIONAGEM',
  type: 'ACTION',
  description: 'Revela 1 carta aleatória da mão do oponente.',
  targeting: 'NONE',
  weight: 2,

  canPlay: ({ state, caster }) => state[handKeyFor(opponentOf(caster))].length > 0,

  effect: ({ state, caster, rng }) => {
    const opponentHand = state[handKeyFor(opponentOf(caster))];
    if (opponentHand.length === 0) return null;

    const spied = rng.pick(opponentHand);
    const spiedCard = getCard(spied.cardId);

    return {
      message: `espionagem :: encontrou ${spiedCard.name.toLowerCase()} na mão do oponente`,
      // Sem `revealedCards`: o `title`/`description` já mostram a carta
      // sozinha em destaque — listá-la de novo em miniatura seria redundante.
      acknowledge: {
        subtitle: 'ESPIONAGEM',
        title: spiedCard.name,
        description: spiedCard.description,
      },
    };
  },
};

const FULL_INTEL: CardDefinition = {
  id: 'FULL_INTEL',
  name: 'VISÃO ABSOLUTA',
  type: 'ACTION',
  description: 'Revela todas as cartas da mão do oponente. Armadilhas já na mesa continuam secretas.',
  targeting: 'NONE',
  weight: 1, // rara

  canPlay: ({ state, caster }) => state[handKeyFor(opponentOf(caster))].length > 0,

  effect: ({ state, caster }) => {
    // Lê só a MÃO (`playerHand`/`machineHand`) — armadilhas já armadas vivem
    // em `playerTraps`/`machineTraps`, um array completamente separado, então
    // "continuam secretas" é automático aqui, não precisa de filtro extra.
    const opponentHand = state[handKeyFor(opponentOf(caster))];
    if (opponentHand.length === 0) return null;

    return {
      message: `visão absoluta :: revelou ${opponentHand.length} carta(s) da mão do oponente`,
      acknowledge: {
        subtitle: 'VISÃO ABSOLUTA',
        title: 'MÃO DO OPONENTE',
        description: `O oponente tem ${opponentHand.length} carta(s) na mão:`,
        revealedCards: opponentHand.map((c) => c.cardId),
      },
    };
  },
};

/* -------------------------------------------------------------------------- */
/*                              TRAPS DE DEFESA                                 */
/* -------------------------------------------------------------------------- */
/* Diferente de BOMB_TRAP (que reage a um evento já consumado), estas reagem a
   `CARD_ABOUT_TO_RESOLVE` — resolvido de forma SÍNCRONA por
   `resolveCounterTraps` no gameStore, antes do efeito da carta do oponente
   rodar. `cancelsAction: true` é o sinal para o store abortar aquela carta. */

const SHIELD_TRAP: CardDefinition = {
  id: 'SHIELD_TRAP',
  name: 'PROTEÇÃO',
  type: 'TRAP',
  description: 'Virada na mesa. Impede que uma carta sua seja roubada pelo SAQUE do oponente.',
  targeting: 'NONE',
  weight: 1,

  triggerCondition: (event) =>
    event.type === 'CARD_ABOUT_TO_RESOLVE' && event.cardId === 'HAND_RAID',

  effect: () => ({ cancelsAction: true, message: 'proteção :: saque anulado' }),
};

const COUNTER_TRAP: CardDefinition = {
  id: 'COUNTER_TRAP',
  name: 'ANTI-MAGIA',
  type: 'TRAP',
  description: 'Virada na mesa. Anula a próxima carta de ação jogada pelo oponente.',
  targeting: 'NONE',
  weight: 1,

  // Precisa do tipo da carta do EVENTO, não da própria — por isso consulta o
  // registry pelo id em vez de assumir algo sobre `event`.
  triggerCondition: (event) =>
    event.type === 'CARD_ABOUT_TO_RESOLVE' && CARD_REGISTRY[event.cardId].type === 'ACTION',

  effect: () => ({ cancelsAction: true, message: 'anti-magia :: ação anulada' }),
};

const MIND_SHIELD_TRAP: CardDefinition = {
  id: 'MIND_SHIELD_TRAP',
  name: 'MENTE BLINDADA',
  type: 'TRAP',
  description: 'Virada na mesa. Anula qualquer carta do oponente que tente espiar sua mão.',
  targeting: 'NONE',
  weight: 1,

  // Específica (ao contrário de ANTI-MAGIA, que é genérica p/ qualquer AÇÃO):
  // só veta ESPIONAGEM e VISÃO ABSOLUTA, nomeadas explicitamente. Continua
  // vencendo a corrida se ANTI-MAGIA também estiver armada e casar primeiro
  // — "primeira armadilha que casa" já é a regra de `resolveCounterTraps`.
  triggerCondition: (event) =>
    event.type === 'CARD_ABOUT_TO_RESOLVE' &&
    (event.cardId === 'SPY_CARD' || event.cardId === 'FULL_INTEL'),

  effect: () => ({ cancelsAction: true, message: 'mente blindada :: espionagem anulada' }),
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
  HEAL_SELF,
  DIRECT_DAMAGE,
  DRAW_CARD,
  HAND_RAID,
  CLEANSE,
  HAND_SWAP,
  REVEAL_OLDEST,
  LOCK_CELL,
  SHIELD_TRAP,
  COUNTER_TRAP,
  SPY_CARD,
  FULL_INTEL,
  MIND_SHIELD_TRAP,
};

export const CARD_IDS = Object.keys(CARD_REGISTRY) as CardId[];

/** Ids de todas as cartas TRAP. Deriva do registry — nunca precisa ser mantida à mão. */
export const TRAP_CARD_IDS: readonly CardId[] = CARD_IDS.filter(
  (id) => CARD_REGISTRY[id].type === 'TRAP',
);

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
