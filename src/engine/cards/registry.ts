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
import { RARITY_DRAW_WEIGHT } from './definitions';
import type { Rng } from '@/engine/rng';
import type { GameState } from '@/engine/rules';
import type { CardDefinition, CardId, CardRarity } from './definitions';

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
  rarity: 'RARE',
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
  rarity: 'RARE',
  weight: 3,

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
  rarity: 'COMMON',
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
  rarity: 'COMMON',
  weight: 3,

  effect: ({ caster }) => ({
    damage: { target: opponentOf(caster), amount: 1 },
    message: 'ataque :: 1 de dano direto no oponente',
  }),
};

const DRAW_CARD: CardDefinition = {
  id: 'DRAW_CARD',
  name: 'ESTUDAR',
  type: 'ACTION',
  description: 'Compra 2 cartas novas.',
  targeting: 'NONE',
  rarity: 'COMMON',
  weight: 3,

  // Comprar 1 gastando 1 era um no-op disfarçado de carta: o jogador terminava
  // a jogada com a mesma quantidade de cartas e um turno a menos de informação.
  // Comprando 2 a carta passa a ter um motivo para existir (+1 líquido) sem
  // virar motor infinito — `HAND_LIMIT` continua sendo o teto.
  canPlay: ({ state, caster }) => state[handKeyFor(caster)].length < HAND_LIMIT,

  effect: ({ caster }) => ({
    draw: { target: caster, count: 2 },
    message: 'estudar :: comprou 2 cartas',
  }),
};

const HAND_RAID: CardDefinition = {
  id: 'HAND_RAID',
  name: 'SAQUE',
  type: 'ACTION',
  description: '50% de chance de roubar uma carta aleatória do oponente; senão, destrói.',
  targeting: 'NONE',
  rarity: 'EPIC',
  weight: 2,

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

    // O NOME da carta atingida entra no aviso e no log. Sem isso o jogador via
    // a mão encolher e não tinha como saber o que perdeu — o pior tipo de
    // "aconteceu do nada", porque o prejuízo é real mas invisível.
    const victim = getCard(stolen.cardId).name;
    const verb = steals ? 'ROUBOU' : 'DESTRUIU';

    return {
      patch: {
        [handKeyFor(caster)]: steals ? [...casterHand, stolen] : casterHand,
        [handKeyFor(opponentOf(caster))]: remainingVictimHand,
      },
      message:
        caster === 'PLAYER'
          ? `saque :: você ${steals ? 'roubou' : 'destruiu'} ${victim} da cpu`
          : `saque :: a cpu ${steals ? 'roubou' : 'destruiu'} sua carta ${victim}`,
      notice: {
        text: caster === 'PLAYER' ? `VOCÊ ${verb}: ${victim}` : `A CPU ${verb} SUA CARTA: ${victim}`,
        tone: caster === 'PLAYER' ? 'GOOD' : 'BAD',
      },
    };
  },
};

const CLEANSE: CardDefinition = {
  id: 'CLEANSE',
  name: 'PURIFICAR',
  type: 'ACTION',
  description: 'Libera qualquer célula interditada — pelo caos ou por uma carta TRAVAR.',
  targeting: 'NONE',
  rarity: 'COMMON',
  weight: 2,

  // Cobre os DOIS subsistemas de interdição. Quando eram um campo só, esta
  // carta parecia funcionar sempre; agora que TRAVAR tem estado próprio ela
  // precisa checar e limpar os dois, senão viraria uma carta morta metade das
  // vezes em que o jogador a joga achando que vai destravar a casa.
  canPlay: ({ state }) => state.activeRule === 'BLOCKED_CELL' || state.lockedCell !== null,

  effect: ({ state }) => {
    const clearsChaos = state.activeRule === 'BLOCKED_CELL';
    const clearsLock = state.lockedCell !== null;
    if (!clearsChaos && !clearsLock) return null;

    return {
      patch: {
        ...(clearsChaos ? { activeRule: 'NORMAL' as const, blockedCell: null, ruleExpiresAtTurn: null } : null),
        ...(clearsLock ? { lockedCell: null, lockedCellExpiresAtTurn: null } : null),
      },
      message: 'purificar :: interdição removida, a casa voltou a aceitar jogadas',
      notice: { text: 'CASA LIBERADA', tone: 'NEUTRAL' },
    };
  },
};

const HAND_SWAP: CardDefinition = {
  id: 'HAND_SWAP',
  name: 'TROCA',
  type: 'ACTION',
  description: 'Troca sua mão inteira pela mão do oponente.',
  targeting: 'NONE',
  rarity: 'LEGENDARY',
  weight: 2,

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
      message: 'troca :: as duas mãos trocaram de dono',
      notice: {
        text: caster === 'PLAYER' ? 'VOCÊ TROCOU AS MÃOS' : 'A CPU TROCOU AS MÃOS',
        tone: caster === 'PLAYER' ? 'GOOD' : 'BAD',
      },
    };
  },
};

const REVEAL_OLDEST: CardDefinition = {
  id: 'REVEAL_OLDEST',
  name: 'VIDENTE',
  type: 'ACTION',
  description: 'Marca no tabuleiro a peça do oponente que vai sumir na próxima jogada dele.',
  targeting: 'NONE',
  rarity: 'RARE',
  weight: 3,

  canPlay: ({ state, caster }) => getOldestPieceIndex(state.board, opponentOf(caster)) !== null,

  effect: ({ state, caster }) => {
    const index = getOldestPieceIndex(state.board, opponentOf(caster));
    if (index === null) return null;

    const row = Math.floor(index / 3) + 1;
    const col = (index % 3) + 1;

    return {
      // Guarda o DONO, não o índice: o destaque é recalculado a cada render a
      // partir do tabuleiro vivo, então continua correto mesmo se um DEMOLIR
      // destruir a peça marcada antes da hora. Ler uma coordenada no log era
      // informação verdadeira que ninguém usava — traduzir "2x3" de volta para
      // uma casa no meio da partida custa mais atenção do que a carta vale.
      patch: { revealDoomedFor: opponentOf(caster) },
      message: `vidente :: a peça do oponente em ${row}x${col} está condenada`,
      notice: { text: 'PEÇA CONDENADA REVELADA', tone: 'GOOD' },
    };
  },
};

const LOCK_CELL: CardDefinition = {
  id: 'LOCK_CELL',
  name: 'TRAVAR',
  type: 'ACTION',
  description: 'Lacra uma célula vazia — o oponente não pode jogar nela no turno dele.',
  targeting: 'CELL',
  rarity: 'RARE',
  weight: 3,

  requiresTarget: true,
  isValidTarget: ({ state, index }) => state.board[index] === null && state.lockedCell !== index,

  canPlay: ({ state }) => state.board.some((cell, i) => cell === null && state.lockedCell !== i),

  effect: ({ state, targetIndex }) => {
    if (targetIndex === undefined) return null;
    if (state.board[targetIndex] !== null) return null;

    const row = Math.floor(targetIndex / 3) + 1;
    const col = (targetIndex % 3) + 1;

    return {
      /* Campo PRÓPRIO (`lockedCell`), não mais o `blockedCell` da regra
         caótica. Dividir o mesmo campo com o caos era o bug: um surto
         sorteando RANDOM_FADE trocava `activeRule` e a trava sumia no meio do
         turno do oponente — exatamente a "expiração errada" relatada.

         Duração = CARD_RULE_MIN_DURATION_TURNS (2), NUNCA 1: quem lança a
         carta ainda vai completar a PRÓPRIA jogada (+1 em `turnCount`) antes
         do oponente sequer decidir. Com +1 a trava venceria na jogada de quem
         a lançou — o "paradoxo do turno". Com +2 ela cobre a fase de ação
         inteira do adversário e só vence quando ELE termina de jogar. */
      patch: {
        lockedCell: targetIndex,
        lockedCellExpiresAtTurn: state.turnCount + CARD_RULE_MIN_DURATION_TURNS,
      },
      message: `travar :: a casa ${row}x${col} está lacrada durante o turno do oponente`,
      notice: { text: `CASA ${row}x${col} LACRADA`, tone: 'NEUTRAL' },
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
  description: 'Mostra a mão do oponente virada para baixo. Escolha 1 carta e vire.',
  targeting: 'NONE',
  rarity: 'RARE',
  weight: 3,

  canPlay: ({ state, caster }) => state[handKeyFor(opponentOf(caster))].length > 0,

  effect: ({ state, caster, rng }) => {
    const opponentHand = state[handKeyFor(opponentOf(caster))];
    if (opponentHand.length === 0) return null;

    /* --- CPU: não abre modal ------------------------------------------------
       A máquina já "sabe" a mão do jogador; o modal é uma ferramenta humana.
       Mas o jogador precisa ver que foi espionado, senão a carta some da mão
       da CPU sem nenhum efeito aparente. */
    if (caster === 'MACHINE') {
      const spied = getCard(rng.pick(opponentHand).cardId);
      return {
        message: `espionagem :: a cpu olhou sua carta ${spied.name.toLowerCase()}`,
        notice: { text: `A CPU ESPIONOU: ${spied.name}`, tone: 'BAD' },
      };
    }

    /* --- Jogador: ele escolhe qual virar -------------------------------------
       Embaralhar antes é o que impede o vazamento de posição: sem isto a
       ordem do array seria a ordem real da mão da CPU, e virar a 1ª carta
       ensinaria algo sobre as outras. Com o embaralhamento (determinístico,
       canal CARDS), escolher é uma aposta honesta — e a escolha ser DO JOGADOR
       é o que torna a carta uma decisão em vez de um sorteio. */
    return {
      message: `espionagem :: você espiou a mão da cpu (${opponentHand.length} carta(s))`,
      acknowledge: {
        kind: 'SPY_PICK',
        tone: 'INTEL',
        subtitle: 'ESPIONAGEM',
        title: 'MÃO DA CPU',
        description: 'Escolha UMA carta e toque para virar.',
        revealedCards: rng.shuffle(opponentHand).map((c) => c.cardId),
      },
    };
  },
};

const FULL_INTEL: CardDefinition = {
  id: 'FULL_INTEL',
  name: 'VISÃO ABSOLUTA',
  type: 'ACTION',
  description: 'Vire quantas cartas quiser da mão do oponente. Armadilhas já na mesa continuam secretas.',
  targeting: 'NONE',
  rarity: 'LEGENDARY',
  weight: 3,

  canPlay: ({ state, caster }) => state[handKeyFor(opponentOf(caster))].length > 0,

  effect: ({ state, caster }) => {
    // Lê só a MÃO (`playerHand`/`machineHand`) — armadilhas já armadas vivem
    // em `playerTraps`/`machineTraps`, um array completamente separado, então
    // "continuam secretas" é automático aqui, não precisa de filtro extra.
    const opponentHand = state[handKeyFor(opponentOf(caster))];
    if (opponentHand.length === 0) return null;

    if (caster === 'MACHINE') {
      return {
        message: `visão absoluta :: a cpu leu sua mão inteira (${opponentHand.length} carta(s))`,
        notice: { text: 'A CPU LEU SUA MÃO INTEIRA', tone: 'BAD' },
      };
    }

    return {
      message: `visão absoluta :: você leu a mão da cpu (${opponentHand.length} carta(s))`,
      // Sem embaralhar, ao contrário da ESPIONAGEM: aqui TODAS podem ser
      // viradas, então não há posição privilegiada a proteger.
      acknowledge: {
        kind: 'INTEL_FLIP',
        tone: 'INTEL',
        subtitle: 'VISÃO ABSOLUTA',
        title: 'MÃO DA CPU',
        description: `${opponentHand.length} carta(s). Toque para virar e desvirar.`,
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
  rarity: 'EPIC',
  weight: 2,

  triggerCondition: (event) =>
    event.type === 'CARD_ABOUT_TO_RESOLVE' && event.cardId === 'HAND_RAID',

  effect: () => ({ cancelsAction: true, message: 'proteção :: o saque do oponente foi anulado' }),
};

const COUNTER_TRAP: CardDefinition = {
  id: 'COUNTER_TRAP',
  name: 'ANTI-MAGIA',
  type: 'TRAP',
  description: 'Virada na mesa. Anula a próxima carta de ação jogada pelo oponente.',
  targeting: 'NONE',
  rarity: 'EPIC',
  weight: 2,

  // Precisa do tipo da carta do EVENTO, não da própria — por isso consulta o
  // registry pelo id em vez de assumir algo sobre `event`.
  triggerCondition: (event) =>
    event.type === 'CARD_ABOUT_TO_RESOLVE' && CARD_REGISTRY[event.cardId].type === 'ACTION',

  effect: () => ({ cancelsAction: true, message: 'anti-magia :: a ação do oponente foi anulada' }),
};

const MIND_SHIELD_TRAP: CardDefinition = {
  id: 'MIND_SHIELD_TRAP',
  name: 'MENTE BLINDADA',
  type: 'TRAP',
  description: 'Virada na mesa. Anula qualquer carta do oponente que tente espiar sua mão.',
  targeting: 'NONE',
  rarity: 'LEGENDARY',
  weight: 2,

  // Específica (ao contrário de ANTI-MAGIA, que é genérica p/ qualquer AÇÃO):
  // só veta ESPIONAGEM e VISÃO ABSOLUTA, nomeadas explicitamente. Continua
  // vencendo a corrida se ANTI-MAGIA também estiver armada e casar primeiro
  // — "primeira armadilha que casa" já é a regra de `resolveCounterTraps`.
  triggerCondition: (event) =>
    event.type === 'CARD_ABOUT_TO_RESOLVE' &&
    (event.cardId === 'SPY_CARD' || event.cardId === 'FULL_INTEL'),

  effect: () => ({ cancelsAction: true, message: 'mente blindada :: a espionagem foi anulada' }),
};

const BOMB_TRAP: CardDefinition = {
  id: 'BOMB_TRAP',
  name: 'MINA',
  type: 'TRAP',
  description: 'Virada na mesa. Detona se o oponente ocupar o centro: 2 de dano e ele perde a vez.',
  targeting: 'NONE',
  rarity: 'EPIC',
  weight: 3,

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

    message: 'mina :: o centro detonou — 2 de dano e um turno extra',
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

/* -------------------------------------------------------------------------- */
/*                              SORTEIO PONDERADO                              */
/* -------------------------------------------------------------------------- */

/** Ids agrupados por faixa de raridade. Montado uma vez, na carga do módulo. */
const IDS_BY_RARITY = CARD_IDS.reduce(
  (acc, id) => {
    acc[CARD_REGISTRY[id].rarity].push(id);
    return acc;
  },
  { COMMON: [], RARE: [], EPIC: [], LEGENDARY: [] } as Record<CardRarity, CardId[]>,
);

/**
 * Pool de faixas, já filtrado para descartar faixas vazias.
 *
 * O filtro não é decorativo: `rng.weighted` sortearia uma faixa sem cartas e o
 * `pick` seguinte estouraria. Enquanto o deck tiver ao menos uma carta de cada
 * raridade isso nunca acontece, mas nada no tipo garante isso — e um deck
 * futuro sem lendárias não deveria derrubar o jogo.
 */
const RARITY_POOL = (Object.keys(RARITY_DRAW_WEIGHT) as CardRarity[])
  .filter((rarity) => IDS_BY_RARITY[rarity].length > 0)
  .map((rarity) => [rarity, RARITY_DRAW_WEIGHT[rarity]] as const);

/** Pesos internos de cada faixa, prontos para `rng.weighted`. */
const POOL_BY_RARITY = (Object.keys(IDS_BY_RARITY) as CardRarity[]).reduce(
  (acc, rarity) => {
    acc[rarity] = IDS_BY_RARITY[rarity].map((id) => [id, CARD_REGISTRY[id].weight] as const);
    return acc;
  },
  {} as Record<CardRarity, (readonly [CardId, number])[]>,
);

/**
 * Sorteia um id de carta pelo canal `CARDS` do RNG, em **dois estágios**:
 * primeiro a faixa de raridade (50/30/15/5), depois a carta dentro dela.
 *
 * O modelo anterior era um pool único ponderado carta a carta, e por isso a
 * chance de sair armadilha crescia junto com a quantidade de armadilhas no
 * deck — foi assim que a mão da CPU virou um paredão delas. Sorteando a faixa
 * antes, as proporções entre faixas ficam fixas por construção e acrescentar
 * cartas novas só redistribui a probabilidade DENTRO da própria faixa.
 *
 * Consome exatamente 2 números do canal por compra — quantidade fixa, então o
 * determinismo do replay não depende de qual faixa saiu.
 */
export function drawCardId(rng: Rng): CardId {
  const rarity = rng.weighted(RARITY_POOL);
  return rng.weighted(POOL_BY_RARITY[rarity]);
}
