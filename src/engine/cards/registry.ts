import { CENTER_INDEX } from '@/engine/events';
import {
  CARD_RULE_MIN_DURATION_TURNS,
  HAND_LIMIT,
  INITIAL_HP,
  handKeyFor,
  hpOf,
  occupiedIndexes,
  opponentOf,
} from '@/engine/rules';
import { RARITY_DRAW_WEIGHT } from './definitions';
import type { Rng } from '@/engine/rng';
import type { Combatant, GameState } from '@/engine/rules';
import type { CardDefinition, CardId, CardRarity } from './definitions';

/* -------------------------------------------------------------------------- */
/*                              QUEM É A MÁQUINA?                              */
/* -------------------------------------------------------------------------- */

/**
 * Este combatente é controlado pela IA?
 *
 * `MACHINE` significava "a inteligência artificial" em todo o motor, e cartas
 * de informação usavam isso para pular o modal de leitura — a IA não precisa
 * ler nada na tela. No modo online a equivalência quebra: `MACHINE` passa a
 * ser um humano em outro aparelho, que precisa do modal exatamente como o
 * `PLAYER`.
 *
 * Concentrar a pergunta numa função só (em vez de repetir a condição em cada
 * carta) é o que garante que uma carta futura não volte a assumir o atalho
 * antigo por descuido.
 */
function isAIController(state: GameState, caster: Combatant): boolean {
  return caster === 'MACHINE' && !state.isOnline;
}

/* -------------------------------------------------------------------------- */
/*                          CUSTO 1 — AÇÕES TÁTICAS                            */
/* -------------------------------------------------------------------------- */

const CLEAR_BLOCK: CardDefinition = {
  id: 'CLEAR_BLOCK',
  name: 'LIMPAR',
  type: 'ACTION',
  description: 'Libera a célula interditada pelo caos.',
  targeting: 'CELL',
  rarity: 'COMMON',
  weight: 3,
  cost: 1,

  requiresTarget: true,
  isValidTarget: ({ state, index }) =>
    state.activeRule === 'BLOCKED_CELL' && state.blockedCell === index,

  canPlay: ({ state }) => state.activeRule === 'BLOCKED_CELL' && state.blockedCell !== null,

  effect: ({ state, caster, targetIndex }) => {
    if (targetIndex === undefined) return null;
    if (state.activeRule !== 'BLOCKED_CELL' || state.blockedCell !== targetIndex) return null;

    return {
      patch: { activeRule: 'NORMAL', blockedCell: null, ruleExpiresAtTurn: null },
      log: { code: 'CARD_CLEANSE', subject: caster, value: targetIndex },
      notice: { code: 'CARD_CLEANSE', subject: caster, value: targetIndex, tone: 'NEUTRAL' },
    };
  },
};

/**
 * Sucessora da antiga CLEANSE (mesmo id, mesmo nome): antes limpava as DUAS
 * interdições de uma vez, sem escolher onde — agora exige um alvo específico,
 * igual LIMPAR, mas cobre os dois subsistemas (bloqueio do caos OU trava da
 * TRAVAR), nunca só um.
 */
const CLEANSE: CardDefinition = {
  id: 'CLEANSE',
  name: 'PURIFICAR',
  type: 'ACTION',
  description: 'Libera uma célula de qualquer efeito persistente — o bloqueio do caos ou o lacre da TRAVAR.',
  targeting: 'CELL',
  rarity: 'COMMON',
  weight: 2,
  cost: 1,

  requiresTarget: true,
  isValidTarget: ({ state, index }) =>
    (state.activeRule === 'BLOCKED_CELL' && state.blockedCell === index) || state.lockedCell === index,

  canPlay: ({ state }) =>
    (state.activeRule === 'BLOCKED_CELL' && state.blockedCell !== null) || state.lockedCell !== null,

  effect: ({ state, caster, targetIndex }) => {
    if (targetIndex === undefined) return null;

    const clearsChaos = state.activeRule === 'BLOCKED_CELL' && state.blockedCell === targetIndex;
    const clearsLock = state.lockedCell === targetIndex;
    if (!clearsChaos && !clearsLock) return null;

    return {
      patch: {
        ...(clearsChaos ? { activeRule: 'NORMAL' as const, blockedCell: null, ruleExpiresAtTurn: null } : null),
        ...(clearsLock ? { lockedCell: null, lockedCellExpiresAtTurn: null } : null),
      },
      log: { code: 'CARD_CLEANSE', subject: caster, value: targetIndex },
      notice: { code: 'CARD_CLEANSE', subject: caster, value: targetIndex, tone: 'NEUTRAL' },
    };
  },
};

const LOCK_CELL: CardDefinition = {
  id: 'LOCK_CELL',
  name: 'TRAVAR',
  type: 'ACTION',
  description: 'Lacra uma célula vazia — o oponente não pode jogar nela no turno dele.',
  targeting: 'CELL',
  rarity: 'COMMON',
  weight: 3,
  cost: 1,

  requiresTarget: true,
  isValidTarget: ({ state, index }) => state.board[index] === null && state.lockedCell !== index,

  canPlay: ({ state }) => state.board.some((cell, i) => cell === null && state.lockedCell !== i),

  effect: ({ state, caster, targetIndex }) => {
    if (targetIndex === undefined) return null;
    if (state.board[targetIndex] !== null) return null;

    return {
      /* Duração = CARD_RULE_MIN_DURATION_TURNS (2), NUNCA 1: quem lança a
         carta ainda vai completar a PRÓPRIA jogada (+1 em `turnCount`) antes
         do oponente sequer decidir. Com +1 a trava venceria na jogada de quem
         a lançou — o "paradoxo do turno". Com +2 ela cobre a fase de ação
         inteira do adversário e só vence quando ELE termina de jogar. */
      patch: {
        lockedCell: targetIndex,
        lockedCellExpiresAtTurn: state.turnCount + CARD_RULE_MIN_DURATION_TURNS,
      },
      log: { code: 'CARD_LOCK_CELL', subject: caster, value: targetIndex },
      notice: { code: 'CARD_LOCK_CELL', subject: caster, value: targetIndex, tone: 'NEUTRAL' },
    };
  },
};

const BREAK_PIECE: CardDefinition = {
  id: 'BREAK_PIECE',
  name: 'DEMOLIR',
  type: 'ACTION',
  description: 'Escolha uma peça no tabuleiro e destrua.',
  targeting: 'OCCUPIED_CELL',
  rarity: 'COMMON',
  weight: 3,
  cost: 1,

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

  effect: ({ state, caster, targetIndex }) => {
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
      log: { code: 'CARD_BREAK_PIECE', subject: caster, value: targetIndex },
    };
  },
};

const PEEK_RANDOM: CardDefinition = {
  id: 'PEEK_RANDOM',
  name: 'ESPIADA',
  type: 'ACTION',
  description: 'Revela uma carta aleatória da mão do oponente.',
  targeting: 'NONE',
  rarity: 'RARE',
  weight: 3,
  cost: 1,

  canPlay: ({ state, caster }) => state[handKeyFor(opponentOf(caster))].length > 0,

  // Sem ramo de IA: ao contrário da antiga ESPIONAGEM, esta carta nunca abriu
  // modal — é sempre um peek automático, então funciona igual para os dois
  // lados desde o início. Não existe "atalho da IA" para simplificar aqui.
  effect: ({ state, caster, rng }) => {
    const opponentHand = state[handKeyFor(opponentOf(caster))];
    if (opponentHand.length === 0) return null;

    const spied = rng.pick(opponentHand).cardId;
    const event = {
      code: 'CARD_SPY_PEEK',
      subject: caster,
      target: opponentOf(caster),
      value: spied,
    } as const;

    return { log: event, notice: event };
  },
};

/* -------------------------------------------------------------------------- */
/*                          CUSTO 2 — VANTAGEM                                  */
/* -------------------------------------------------------------------------- */

const DRAW_CARD: CardDefinition = {
  id: 'DRAW_CARD',
  name: 'PROCRASTINAR',
  type: 'ACTION',
  description: 'Compra 2 cartas novas.',
  targeting: 'NONE',
  rarity: 'RARE',
  weight: 3,
  cost: 2,

  // Comprar 1 gastando 1 era um no-op disfarçado de carta: o jogador terminava
  // a jogada com a mesma quantidade de cartas e um turno a menos de informação.
  // Comprando 2 a carta passa a ter um motivo para existir (+1 líquido) sem
  // virar motor infinito — `HAND_LIMIT` continua sendo o teto.
  canPlay: ({ state, caster }) => state[handKeyFor(caster)].length < HAND_LIMIT,

  effect: ({ caster }) => ({
    draw: { target: caster, count: 2 },
    log: { code: 'CARD_DRAW', subject: caster, value: 2 },
  }),
};

/**
 * Sucessora do antigo SAQUE: mesma carta, mas sem o ramo de "destrói se
 * falhar" — agora uma falha é só isso, uma falha. O golpe garantido virava a
 * carta boa demais para o custo dela.
 */
const HAND_RAID: CardDefinition = {
  id: 'HAND_RAID',
  name: 'SAQUE',
  type: 'ACTION',
  description: '50% de chance de roubar uma carta aleatória do oponente. Se falhar, nada acontece.',
  targeting: 'NONE',
  rarity: 'RARE',
  weight: 2,
  cost: 2,

  canPlay: ({ state, caster }) => state[handKeyFor(opponentOf(caster))].length > 0,

  // A carta jogada (`uid`) é excluída da mão do caster ANTES de qualquer
  // outra operação — sem isso ela sobreviveria "fantasma" dentro do patch,
  // já que o efeito é a única camada que sabe qual entrada é a jogada.
  effect: ({ state, caster, uid, rng }) => {
    const target = opponentOf(caster);
    const victimHand = state[handKeyFor(target)];
    if (victimHand.length === 0) return null;

    if (!rng.chance(0.5)) {
      // Sem `patch`: a remoção padrão da própria carta (feita pelo store,
      // fora daqui) é a ÚNICA mudança de estado de uma tentativa que falhou.
      return { log: { code: 'CARD_RAID_FAILED', subject: caster, target } };
    }

    const casterHand = state[handKeyFor(caster)].filter((c) => c.uid !== uid);
    const stolen = rng.pick(victimHand);
    const remainingVictimHand = victimHand.filter((c) => c.uid !== stolen.uid);

    // O `cardId` roubado viaja no evento. Sem ele o jogador via a mão
    // encolher e não tinha como saber o que perdeu — o pior tipo de
    // "aconteceu do nada", porque o prejuízo é real mas invisível. Quem
    // resolve o id em nome legível é a apresentação.
    const event = {
      code: 'CARD_RAID_STOLE',
      subject: caster,
      target,
      value: stolen.cardId,
    } as const;

    return {
      patch: {
        [handKeyFor(caster)]: [...casterHand, stolen],
        [handKeyFor(target)]: remainingVictimHand,
      },
      // Sem `tone`: quem rouba ganha e quem é roubado perde, e só a
      // perspectiva sabe quem é quem. O tradutor decide a cor.
      log: event,
      notice: event,
    };
  },
};

/**
 * Nova carta: troca UMA carta (não a mão inteira, como a antiga TROCA) por
 * uma carta do oponente.
 *
 * Quem sai e quem entra são sorteados pelo RNG dos dois lados — o pedido
 * original descrevia "o jogador escolhe 1 carta própria", mas dar essa
 * escolha de verdade exigiria um modo de seleção dentro da PRÓPRIA mão (o
 * sistema de mira atual só sabe apontar para o TABULEIRO). Implementar isso
 * é trabalho de UI novo, fora do escopo desta etapa — fica anotado para uma
 * futura, se vocês quiserem a escolha manual.
 */
const CARD_TRADE: CardDefinition = {
  id: 'CARD_TRADE',
  name: 'TROCAR',
  type: 'ACTION',
  description: 'Troca uma carta aleatória da sua mão por uma carta aleatória da mão do oponente.',
  targeting: 'NONE',
  rarity: 'RARE',
  weight: 2,
  cost: 2,

  // Precisa de mais alguma carta além da própria TROCAR na mão — senão não
  // haveria o que oferecer em troca.
  canPlay: ({ state, caster, uid }) =>
    state[handKeyFor(caster)].some((c) => c.uid !== uid) &&
    state[handKeyFor(opponentOf(caster))].length > 0,

  effect: ({ state, caster, uid, rng }) => {
    const target = opponentOf(caster);
    const casterHandWithoutSelf = state[handKeyFor(caster)].filter((c) => c.uid !== uid);
    const opponentHand = state[handKeyFor(target)];
    if (casterHandWithoutSelf.length === 0 || opponentHand.length === 0) return null;

    const given = rng.pick(casterHandWithoutSelf);
    const received = rng.pick(opponentHand);

    return {
      patch: {
        [handKeyFor(caster)]: [...casterHandWithoutSelf.filter((c) => c.uid !== given.uid), received],
        [handKeyFor(target)]: [...opponentHand.filter((c) => c.uid !== received.uid), given],
      },
      log: { code: 'CARD_TRADE', subject: caster, target, value: given.cardId },
      notice: { code: 'CARD_TRADE', subject: caster, target, value: given.cardId },
    };
  },
};

/**
 * Sucessora do antigo VIDENTE (mesmo id): antes só REVELAVA a peça mais
 * antiga que já ia sumir sozinha pela regra do "infinito" — informação pura,
 * nenhum efeito novo. Agora MARCA uma peça inimiga à escolha do jogador, e
 * ela é destruída de verdade no início do próximo turno do dono — um efeito
 * ativo, não mais um aviso do que já ia acontecer.
 */
const MARK_DOOMED: CardDefinition = {
  id: 'REVEAL_OLDEST',
  name: 'VIDENTE',
  type: 'ACTION',
  description: 'Marca uma peça do oponente. No início do próximo turno dele, ela é destruída.',
  targeting: 'OCCUPIED_CELL',
  rarity: 'RARE',
  weight: 3,
  cost: 2,

  requiresTarget: true,
  isValidTarget: ({ state, caster, index }) => state.board[index]?.owner === opponentOf(caster),

  canPlay: ({ state, caster }) => occupiedIndexes(state, opponentOf(caster)).length > 0,

  effect: ({ state, caster, targetIndex }) => {
    if (targetIndex === undefined) return null;
    const piece = state.board[targetIndex];
    if (!piece || piece.owner !== opponentOf(caster)) return null;

    return {
      // Guarda dono E `turnPlaced`, não só o índice: é o que permite ao motor
      // detectar se ESTA peça específica saiu dali por outro caminho (um
      // DEMOLIR, o sumiço natural) antes do gatilho — ver `classifyDoom` no
      // store. Sem isso a marca destruiria QUALQUER peça que acabasse
      // ocupando a mesma casa depois, mesmo sem relação com a marcada.
      patch: {
        doomedCell: { index: targetIndex, owner: piece.owner, turnPlaced: piece.turnPlaced },
      },
      log: { code: 'CARD_MARK_DOOMED', subject: caster, target: opponentOf(caster), value: targetIndex },
      notice: {
        code: 'CARD_MARK_DOOMED',
        subject: caster,
        target: opponentOf(caster),
        value: targetIndex,
        tone: 'NEUTRAL',
      },
    };
  },
};

/**
 * Sucessora da antiga ESPIONAGEM (mesmo id): antes só REVELAVA (o jogador
 * escolhia qual carta virar, nada saía da mão do oponente). Agora ela mesma
 * decide (RNG) qual carta descobre — e a REMOVE da mão dele. "O jogador
 * seleciona um índice" do pedido virou sorteio pelo mesmo motivo do TROCAR:
 * dar essa escolha de verdade exigiria uma seleção síncrona com consequência
 * real, o que pediria um novo tipo de ação replicada em rede (como
 * ACKNOWLEDGE/FORFEIT) só para isto — fora do escopo desta etapa de cartas.
 */
const SPY_CARD: CardDefinition = {
  id: 'SPY_CARD',
  name: 'ESPIONAGEM',
  type: 'ACTION',
  description: 'Revela e descarta uma carta aleatória da mão do oponente.',
  targeting: 'NONE',
  rarity: 'EPIC',
  weight: 3,
  cost: 2,

  canPlay: ({ state, caster }) => state[handKeyFor(opponentOf(caster))].length > 0,

  effect: ({ state, caster, rng }) => {
    const target = opponentOf(caster);
    const opponentHand = state[handKeyFor(target)];
    if (opponentHand.length === 0) return null;

    const found = rng.pick(opponentHand);
    const remainingOpponentHand = opponentHand.filter((c) => c.uid !== found.uid);

    const event = {
      code: 'CARD_SPY_DISCARD',
      subject: caster,
      target,
      value: found.cardId,
    } as const;

    return {
      patch: { [handKeyFor(target)]: remainingOpponentHand },
      log: event,
      notice: event,
      /* Só quem jogou vê QUAL carta era. O oponente já sabe a própria mão —
         não há nada para ele "descobrir" no próprio prejuízo — e a IA não
         precisa de modal nenhum (é uma ferramenta de leitura humana). */
      acknowledge: isAIController(state, caster)
        ? undefined
        : {
            code: 'HAND_REVEALED',
            kind: 'INFO',
            subject: caster,
            target,
            cardId: found.cardId,
          },
    };
  },
};

const DRAW_CARD_BIG: CardDefinition = {
  id: 'DRAW_CARD_BIG',
  name: 'PROCRASTINAR II',
  type: 'ACTION',
  description: 'Compra 3 cartas novas.',
  targeting: 'NONE',
  rarity: 'EPIC',
  weight: 2,
  cost: 2,

  canPlay: ({ state, caster }) => state[handKeyFor(caster)].length < HAND_LIMIT,

  effect: ({ caster }) => ({
    draw: { target: caster, count: 3 },
    log: { code: 'CARD_DRAW', subject: caster, value: 3 },
  }),
};

/* -------------------------------------------------------------------------- */
/*                          CUSTO 3 — IMPACTO TOTAL                            */
/* -------------------------------------------------------------------------- */

const DIRECT_DAMAGE: CardDefinition = {
  id: 'DIRECT_DAMAGE',
  name: 'ATAQUE',
  type: 'ACTION',
  description: 'Causa 1 de dano direto ao oponente.',
  targeting: 'NONE',
  rarity: 'EPIC',
  weight: 3,
  cost: 3,

  effect: ({ caster }) => ({
    damage: { target: opponentOf(caster), amount: 1 },
    log: { code: 'CARD_DAMAGE', subject: caster, target: opponentOf(caster) },
  }),
};

const HEAL_SELF: CardDefinition = {
  id: 'HEAL_SELF',
  name: 'CURA',
  type: 'ACTION',
  description: 'Recupera 1 HP.',
  targeting: 'NONE',
  rarity: 'EPIC',
  weight: 3,
  cost: 3,

  canPlay: ({ state, caster }) => hpOf(state, caster) < INITIAL_HP,

  effect: ({ caster }) => ({
    heal: { target: caster, amount: 1 },
    log: { code: 'CARD_HEAL', subject: caster },
  }),
};

/**
 * Sucessora do antigo REBOBINAR (mesmo id, mesmo mecanismo): a moldura virou
 * "o oponente perde a próxima jogada dele" em vez de "sua próxima jogada não
 * passa a vez" — mas as duas descrevem o MESMO fato (`extraTurnPending:
 * caster`, lido por `placeMark`), só narrado de lados opostos.
 */
const EXTRA_TURN: CardDefinition = {
  id: 'EXTRA_TURN',
  name: 'PULAR',
  type: 'ACTION',
  description: 'O oponente perde a fase de colocar peça no próximo turno dele.',
  targeting: 'NONE',
  rarity: 'EPIC',
  weight: 3,
  cost: 3,

  // Não empilha: jogar duas seguidas desperdiçaria a segunda.
  canPlay: ({ state, caster }) => state.extraTurnPending !== caster,

  effect: ({ caster }) => ({
    patch: { extraTurnPending: caster },
    log: { code: 'CARD_EXTRA_TURN', subject: caster },
  }),
};

const FULL_INTEL: CardDefinition = {
  id: 'FULL_INTEL',
  name: 'VISÃO ABSOLUTA',
  type: 'ACTION',
  description: 'Vire quantas cartas quiser da mão do oponente. Armadilhas já na mesa continuam secretas.',
  targeting: 'NONE',
  rarity: 'LEGENDARY',
  weight: 3,
  cost: 3,

  canPlay: ({ state, caster }) => state[handKeyFor(opponentOf(caster))].length > 0,

  effect: ({ state, caster }) => {
    // Lê só a MÃO (`playerHand`/`machineHand`) — armadilhas já armadas vivem
    // em `playerTraps`/`machineTraps`, um array completamente separado, então
    // "continuam secretas" é automático aqui, não precisa de filtro extra.
    const opponentHand = state[handKeyFor(opponentOf(caster))];
    if (opponentHand.length === 0) return null;

    const intel = {
      code: 'CARD_INTEL_HAND',
      subject: caster,
      target: opponentOf(caster),
      value: opponentHand.length,
    } as const;

    if (isAIController(state, caster)) {
      return { log: intel, notice: intel };
    }

    return {
      log: intel,
      // Sem embaralhar, ao contrário da ESPIONAGEM: aqui TODAS podem ser
      // viradas, então não há posição privilegiada a proteger.
      acknowledge: {
        code: 'HAND_REVEALED',
        kind: 'INTEL_FLIP',
        subject: caster,
        target: opponentOf(caster),
        revealedCards: opponentHand.map((c) => c.cardId),
      },
    };
  },
};

/**
 * Sucessora da antiga MINA (mesmo id, mesmo mecanismo): virou Lendária/custo 3
 * por ser a punição mais dura do baralho — nenhuma mudança na lógica.
 */
const BOMB_TRAP: CardDefinition = {
  id: 'BOMB_TRAP',
  name: 'MINA',
  type: 'TRAP',
  description: 'Virada na mesa. Detona se o oponente ocupar o centro: 2 de dano e ele perde a vez.',
  targeting: 'NONE',
  rarity: 'LEGENDARY',
  weight: 3,
  cost: 3,

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

    log: { code: 'TRAP_BOMB', subject: caster, target: opponentOf(caster) },
  }),
};

/* -------------------------------------------------------------------------- */
/*                          CUSTO 1 — ARMADILHA                                 */
/* -------------------------------------------------------------------------- */
/* Reage a `CARD_ABOUT_TO_RESOLVE` — resolvido de forma SÍNCRONA por
   `resolveCounterTraps` no gameStore, antes do efeito da carta do oponente
   rodar. `cancelsAction: true` é o sinal para o store abortar aquela carta. */

/**
 * Sucessora da antiga PROTEÇÃO (mesmo id): antes só anulava SAQUE; agora
 * também anula ESPIONAGEM, já que as duas mexem na mão do jogador. Rebaixada
 * de Épica/custo 2 para Rara/custo 1 — era cara demais para o que faz.
 */
const SHIELD_TRAP: CardDefinition = {
  id: 'SHIELD_TRAP',
  name: 'PROTEÇÃO',
  type: 'TRAP',
  description: 'Virada na mesa. Anula o SAQUE ou a ESPIONAGEM do oponente contra você, destruindo a armadilha.',
  targeting: 'NONE',
  rarity: 'RARE',
  weight: 2,
  cost: 1,

  triggerCondition: (event) =>
    event.type === 'CARD_ABOUT_TO_RESOLVE' && (event.cardId === 'HAND_RAID' || event.cardId === 'SPY_CARD'),

  effect: ({ caster }) => ({ cancelsAction: true, log: { code: 'TRAP_SHIELD', subject: caster } }),
};

/* -------------------------------------------------------------------------- */
/*                          CUSTO 0 — CAOS                                      */
/* -------------------------------------------------------------------------- */

const CHAOS_ROULETTE: CardDefinition = {
  id: 'CHAOS_ROULETTE',
  name: 'TIC TAC BOOM!',
  type: 'ACTION',
  description: 'Dispara um surto de caos imediato — a mesma roleta do relógio global.',
  targeting: 'NONE',
  rarity: 'BOOM',
  weight: 1,
  cost: 0,

  // Sem `canPlay`: `triggerTerminalGlitch` é sempre seguro de chamar, em
  // qualquer regra ativa (inclusive já dentro de um surto — ela troca para
  // outra regra caótica, nunca repete a atual).
  effect: ({ caster }) => ({
    triggersChaosGlitch: true,
    log: { code: 'CARD_CHAOS_ROULETTE', subject: caster },
  }),
};

/**
 * O efeito só ABRE o modal (`opensAltar: true`) — a escolha das 2 cartas, a
 * remoção delas e (numa iteração futura) a invocação em troca acontecem fora
 * daqui, no `<AltarModal />` e na action `sacrificeCards`. Não dá para o
 * `effect` fazer isso sozinho: ele é puro e roda num único instante, e a
 * escolha do jogador ainda nem existe nesse momento.
 */
const ALTAR_OF_SACRIFICE: CardDefinition = {
  id: 'ALTAR_OF_SACRIFICE',
  name: 'ALTAR DE SACRIFÍCIO',
  type: 'ACTION',
  description: 'Escolha 2 cartas da mão para sacrificar. O que nasce da oferenda ainda será revelado.',
  targeting: 'NONE',
  rarity: 'BOOM',
  weight: 1,
  cost: 0,

  // Precisa de 2 OUTRAS cartas na mão além do próprio Altar — senão o modal
  // abriria para um ritual impossível de completar.
  canPlay: ({ state, caster, uid }) =>
    state[handKeyFor(caster)].filter((c) => c.uid !== uid).length >= 2,

  effect: ({ caster }) => ({
    opensAltar: true,
    log: { code: 'CARD_ALTAR_OPENED', subject: caster },
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
  CLEAR_BLOCK,
  CLEANSE,
  LOCK_CELL,
  BREAK_PIECE,
  PEEK_RANDOM,
  SHIELD_TRAP,
  DRAW_CARD,
  HAND_RAID,
  CARD_TRADE,
  REVEAL_OLDEST: MARK_DOOMED,
  SPY_CARD,
  DRAW_CARD_BIG,
  DIRECT_DAMAGE,
  HEAL_SELF,
  EXTRA_TURN,
  BOMB_TRAP,
  FULL_INTEL,
  CHAOS_ROULETTE,
  ALTAR_OF_SACRIFICE,
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

/* -------------------------------------------------------------------------- */
/*                              SORTEIO PONDERADO                              */
/* -------------------------------------------------------------------------- */

/** Ids agrupados por faixa de raridade. Montado uma vez, na carga do módulo. */
const IDS_BY_RARITY = CARD_IDS.reduce(
  (acc, id) => {
    acc[CARD_REGISTRY[id].rarity].push(id);
    return acc;
  },
  { COMMON: [], RARE: [], EPIC: [], LEGENDARY: [], BOOM: [] } as Record<CardRarity, CardId[]>,
);

/**
 * Pool de faixas, já filtrado para descartar faixas vazias.
 *
 * O filtro não é decorativo: `rng.weighted` sortearia uma faixa sem cartas e o
 * `pick` seguinte estouraria. Hoje é o que absorve `BOOM` não ter carta
 * nenhuma ainda — os 4% dela ficam redistribuídos proporcionalmente entre as
 * demais faixas até a primeira carta `BOOM` ser registrada.
 */
const RARITY_POOL = (Object.keys(RARITY_DRAW_WEIGHT) as CardRarity[])
  .filter((rarity) => IDS_BY_RARITY[rarity].length > 0)
  .map((rarity) => [rarity, RARITY_DRAW_WEIGHT[rarity]] as const);

/**
 * Sorteia um id de carta pelo canal `CARDS` do RNG, em **dois estágios**:
 * primeiro a faixa de raridade — ponderada, 50/25/15/6/4 — depois uma carta
 * DENTRO dela, essa sim uniforme: todas as cartas da faixa têm a mesma chance,
 * independente do `weight` de cada uma.
 *
 * `weight` continua existindo em `CardDefinition` (não é mais consultado por
 * este sorteio) — não removido nesta etapa por não ter sido pedido, e porque
 * uma faixa futura pode voltar a precisar de desempate ponderado. Mas é bom
 * estar ciente: hoje ele é um campo morto para fins de compra.
 *
 * O modelo de duas faixas (e não um pool único ponderado carta a carta) segue
 * valendo pelo mesmo motivo de sempre: com um pool único, a chance de sair
 * armadilha cresceria junto com a quantidade de armadilhas no deck — foi assim
 * que a mão da CPU virou um paredão delas. Sorteando a faixa antes, as
 * proporções entre faixas ficam fixas por construção.
 *
 * Consome exatamente 2 números do canal por compra — quantidade fixa, então o
 * determinismo do replay não depende de qual faixa saiu.
 */
export function drawCardId(rng: Rng): CardId {
  const rarity = rng.weighted(RARITY_POOL);
  return rng.pick(IDS_BY_RARITY[rarity]);
}
