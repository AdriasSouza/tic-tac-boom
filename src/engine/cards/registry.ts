import { CENTER_INDEX } from '@/engine/events';
import {
  CARD_RULE_MIN_DURATION_TURNS,
  HAND_LIMIT,
  INITIAL_HP,
  getPieceIndexes,
  handKeyFor,
  hpOf,
  isImmuneToTraps,
  occupiedIndexes,
  opponentOf,
  placementBlockedKeyFor,
  revealedKeyFor,
} from '@/engine/rules';
import { fuseRarity, RARITY_DRAW_WEIGHT } from './definitions';
import type { Rng } from '@/engine/rng';
import { createEmptyBoard } from '@/engine/rules';
import type { Board, Combatant, GameState, HandCard, Piece } from '@/engine/rules';
import type { CardDefinition, CardEffectResult, CardId, CardRarity } from './definitions';

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

/**
 * Sucessora da antiga CLEANSE de 1 célula (mesmo comportamento, id/nome
 * novos): LIMPAR agora cobre os dois subsistemas de interdição (bloqueio do
 * caos OU trava da TRAVAR) numa célula só — leitura LARGA confirmada em
 * `docs/CARTAS.md` (LIMPAR/TRAVAR são o par de controle da tier comum; um 1⚡
 * que só um épico de 2⚡ pudesse desfazer quebraria essa economia). PURIFICAR
 * (abaixo) herda o alvo antigo desta carta, agora tabuleiro inteiro.
 */
const CLEAR_BLOCK: CardDefinition = {
  id: 'CLEAR_BLOCK',
  name: 'LIMPAR',
  type: 'ACTION',
  description: 'Libera uma célula de qualquer efeito persistente — o bloqueio do caos ou o lacre da TRAVAR.',
  targeting: 'CELL',
  rarity: 'COMMON',
  weight: 3,
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

/**
 * Sucessora da antiga CLEANSE (mesmo id): antes limpava 1 célula escolhida
 * (esse comportamento virou LIMPAR, acima) — agora é tabuleiro INTEIRO, sem
 * alvo, `CLAUDE.md` (1) — decisão já fechada. `canPlay` presume indisponível
 * quando não há nada persistente em nenhuma célula; a spec não confirma isso
 * explicitamente (ver `docs/CARTAS.md`, entrada de PURIFICAR) — testado como
 * presunção, não regra confirmada.
 */
const CLEANSE: CardDefinition = {
  id: 'CLEANSE',
  name: 'PURIFICAR',
  type: 'ACTION',
  description: 'Limpa todos os efeitos persistentes do tabuleiro — o bloqueio do caos e o lacre da TRAVAR.',
  targeting: 'NONE',
  rarity: 'EPIC',
  weight: 2,
  cost: 2,

  canPlay: ({ state }) =>
    (state.activeRule === 'BLOCKED_CELL' && state.blockedCell !== null) || state.lockedCell !== null,

  effect: ({ state, caster }) => {
    const clearsChaos = state.activeRule === 'BLOCKED_CELL' && state.blockedCell !== null;
    const clearsLock = state.lockedCell !== null;
    if (!clearsChaos && !clearsLock) return null;

    return {
      patch: {
        ...(clearsChaos ? { activeRule: 'NORMAL' as const, blockedCell: null, ruleExpiresAtTurn: null } : null),
        ...(clearsLock ? { lockedCell: null, lockedCellExpiresAtTurn: null } : null),
      },
      log: { code: 'CARD_CLEANSE_ALL', subject: caster },
      notice: { code: 'CARD_CLEANSE_ALL', subject: caster, tone: 'NEUTRAL' },
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
  rarity: 'RARE',
  weight: 3,
  cost: 2,

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

/**
 * Sucessora da antiga ESPIADA (mesmo id): antes o peek era por RNG, sem
 * escolha nenhuma do jogador. Fase 4 (`pendingInteraction`, `PICK_ONE_FROM_HAND`)
 * — o jogador escolhe, às cegas, qual carta oculta da mão do oponente revelar.
 * O modelo de persistência da revelação (`revealedUids`, sem expiração,
 * `revealedKeyFor`) não muda — só QUEM decide qual `uid` marcar.
 */
const PEEK_RANDOM: CardDefinition = {
  id: 'PEEK_RANDOM',
  name: 'ESPIADA',
  type: 'ACTION',
  description: 'Abra a mão oculta do oponente e escolha 1 carta para revelar.',
  targeting: 'NONE',
  rarity: 'RARE',
  weight: 3,
  cost: 1,
  readsOrRemovesFromHand: true,

  canPlay: ({ state, caster }) => state[handKeyFor(opponentOf(caster))].length > 0,

  effect: (ctx) => {
    const { state, caster } = ctx;
    const target = opponentOf(caster);

    if (!ctx.interaction) {
      const opponentHand = state[handKeyFor(target)];
      if (opponentHand.length === 0) return null;
      return {
        interaction: {
          kind: 'PICK_ONE_FROM_HAND',
          source: target,
          optionUids: opponentHand.map((c) => c.uid),
        },
      };
    }

    const selection = ctx.interaction.selection;
    if (selection.kind !== 'PICK_ONE_FROM_HAND') return null;
    // A carta jogada já saiu da mão do caster (removida ao ABRIR a interação,
    // timing unificado da Fase 3) — `state` aqui é lido de novo no momento da
    // resolução, então já reflete isso; nenhum filtro extra é necessário.
    const spied = state[handKeyFor(target)].find((c) => c.uid === selection.uid);
    if (!spied) return null;

    const event = {
      code: 'CARD_SPY_PEEK',
      subject: caster,
      target,
      value: spied.cardId,
    } as const;

    const revealedKey = revealedKeyFor(target);
    const alreadyRevealed = state[revealedKey];

    return {
      // Sem novidade se o uid já estava marcado — evita recriar o array (e
      // um re-render à toa de quem assina `selectRevealedUids`) numa espiada
      // repetida na mesma carta.
      patch: alreadyRevealed.includes(spied.uid)
        ? {}
        : { [revealedKey]: [...alreadyRevealed, spied.uid] },
      log: event,
      notice: event,
    };
  },
};

/* -------------------------------------------------------------------------- */
/*                          CUSTO 2 — VANTAGEM                                  */
/* -------------------------------------------------------------------------- */

const DRAW_CARD: CardDefinition = {
  id: 'STUDY',
  name: 'ESTUDAR',
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
 * Sucessora do antigo SAQUE: a falha agora DESTRÓI 1 carta aleatória do
 * oponente (antes era no-op — golpe garantido de graça, pedido explícito de
 * `docs/CARTAS.md`), e o sucesso abre `pendingInteraction` (`PICK_ONE_FROM_HAND`)
 * para o jogador ESCOLHER qual carta roubar, em vez de sortear.
 *
 * A rolagem (`rng.chance`) acontece na 1ª chamada, ANTES de qualquer
 * interação — o canal `CARDS` só é consultado uma vez por jogada, e o ramo de
 * falha nunca abre modal nenhum (resolve na hora, como sempre).
 */
const HAND_RAID: CardDefinition = {
  id: 'HAND_RAID',
  name: 'SAQUE',
  type: 'ACTION',
  description: '50% de chance de escolher uma carta do oponente para roubar. Se falhar, destrói 1 aleatória dele.',
  targeting: 'NONE',
  rarity: 'RARE',
  weight: 2,
  cost: 2,
  // Categorias reativas: PROTEÇÃO (lê/retira da mão) e RICOCHETE (roubo —
  // inversão bem definida, ver RICOCHET_INVERSIONS). Cobrem o ramo de
  // sucesso E o de falha — RICOCHETE intercepta ANTES do `rng.chance` rodar,
  // então não importa qual ramo teria saído.
  readsOrRemovesFromHand: true,
  targetsOpponentResource: true,

  canPlay: ({ state, caster }) => state[handKeyFor(opponentOf(caster))].length > 0,

  effect: (ctx) => {
    const { state, caster, rng } = ctx;
    const target = opponentOf(caster);

    if (!ctx.interaction) {
      const victimHand = state[handKeyFor(target)];
      if (victimHand.length === 0) return null;

      if (!rng.chance(0.5)) {
        const destroyed = rng.pick(victimHand);
        const event = {
          code: 'CARD_RAID_DESTROYED',
          subject: caster,
          target,
          value: destroyed.cardId,
        } as const;
        return {
          patch: { [handKeyFor(target)]: victimHand.filter((c) => c.uid !== destroyed.uid) },
          log: event,
          notice: event,
        };
      }

      return {
        interaction: {
          kind: 'PICK_ONE_FROM_HAND',
          source: target,
          optionUids: victimHand.map((c) => c.uid),
        },
      };
    }

    const selection = ctx.interaction.selection;
    if (selection.kind !== 'PICK_ONE_FROM_HAND') return null;
    const victimHand = state[handKeyFor(target)];
    const stolen = victimHand.find((c) => c.uid === selection.uid);
    if (!stolen) return null;

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
      // A carta jogada já saiu da mão do caster ao abrir a interação (timing
      // unificado da Fase 3) — `state[handKeyFor(caster)]` aqui já reflete
      // isso, sem precisar filtrar de novo. Rouba com o MESMO `uid` — decisão
      // fechada na Fase 4 ("ressurreição de uid", `docs/NOTAS_TECNICAS.md`):
      // quem já viu a carta continua conhecendo-a depois do roubo.
      patch: {
        [handKeyFor(caster)]: [...state[handKeyFor(caster)], stolen],
        [handKeyFor(target)]: victimHand.filter((c) => c.uid !== stolen.uid),
      },
      // Sem `tone`: quem rouba ganha e quem é roubado perde, e só a
      // perspectiva sabe quem é quem. O tradutor decide a cor.
      log: event,
      notice: event,
    };
  },
};

/**
 * Sucessora da antiga TROCAR/`CARD_TRADE` (1 carta aleatória de cada lado):
 * PERMUTA CAÓTICA agora troca as mãos INTEIRAS, sem RNG e sem seleção — as
 * duas mãos trocam de dono por completo (`docs/CARTAS.md`). "TROCAR" (1
 * carta, com escolha manual) passa a ser uma carta NOVA e futura, de modal —
 * fora do escopo desta etapa.
 *
 * Sem `canPlay`: mão do oponente vazia não bloqueia a troca (decisão já
 * registrada em `docs/CARTAS.md` — unilateral, mas sem indício de que devesse
 * ser restrita).
 *
 * Legendária — imune a QUALQUER armadilha (PROTEÇÃO, RICOCHETE, ANTIMAGIA)
 * via `isImmuneToTraps` nos gatilhos delas; de propósito NÃO marcada com
 * `readsOrRemovesFromHand`/`targetsOpponentResource` aqui — a imunidade por
 * raridade já a protege, e marcar a tag além disso sugeriria que a categoria
 * é que decide, quando na verdade é a raridade. Contraste com `FULL_INTEL`
 * (abaixo): ela TEM `readsOrRemovesFromHand`, apesar de também ser Lendária —
 * ver o comentário lá para o porquê da assimetria (Fase 5, auditoria).
 */
const CARD_TRADE: CardDefinition = {
  id: 'HAND_SWAP',
  name: 'PERMUTA CAÓTICA',
  type: 'ACTION',
  description: 'Troca a mão inteira pela mão inteira do oponente.',
  targeting: 'NONE',
  rarity: 'LEGENDARY',
  weight: 2,
  cost: 3,

  effect: ({ state, caster, uid }) => {
    const target = opponentOf(caster);
    // A própria carta jogada já saiu da mão antes de trocar — senão ela
    // "voltaria" pro oponente junto com o resto.
    const casterHandWithoutSelf = state[handKeyFor(caster)].filter((c) => c.uid !== uid);
    const opponentHand = state[handKeyFor(target)];

    const event = { code: 'CARD_HAND_SWAP', subject: caster, target } as const;

    return {
      patch: {
        [handKeyFor(caster)]: opponentHand,
        [handKeyFor(target)]: casterHandWithoutSelf,
      },
      log: event,
      notice: event,
    };
  },
};

/**
 * Sucessora do antigo VIDENTE (mesmo id): aquela carta (aviso de leitura pura
 * do "infinito") virou HIGHLIGHT_OLDEST/VIDENTE, abaixo. Esta agora FORÇA uma
 * peça inimiga à escolha do jogador a ser a próxima a sumir da fila do
 * "infinito" dele — NÃO é mais destruição imediata: só some quando o dono
 * estourar o limite de 3 peças, pela regra normal (`docs/CARTAS.md`: mais
 * lenta e mais fraca que antes, DE PROPÓSITO — destruição imediata já existe
 * e custa só 1⚡, DEMOLIR). Mesmo mecanismo de ANOMALIA (`forcedVanish`,
 * `getVanishingIndex` em `rules.ts`), parametrizado com um índice ESCOLHIDO
 * em vez de aleatório.
 */
const MARK_DOOMED: CardDefinition = {
  id: 'OBSOLESCENCE',
  name: 'OBSOLESCÊNCIA',
  type: 'ACTION',
  description: 'Marca uma peça do oponente para ser a próxima a sumir da fila do "infinito" dele.',
  targeting: 'OCCUPIED_CELL',
  rarity: 'RARE',
  weight: 3,
  cost: 2,
  targetsOpponentResource: true,

  requiresTarget: true,
  isValidTarget: ({ state, caster, index }) => state.board[index]?.owner === opponentOf(caster),

  canPlay: ({ state, caster }) => occupiedIndexes(state, opponentOf(caster)).length > 0,

  effect: ({ state, caster, targetIndex }) => {
    if (targetIndex === undefined) return null;
    const piece = state.board[targetIndex];
    if (!piece || piece.owner !== opponentOf(caster)) return null;

    const event = {
      code: 'CARD_MARK_DOOMED',
      subject: caster,
      target: opponentOf(caster),
      value: targetIndex,
    } as const;

    return {
      patch: {
        forcedVanish: {
          owner: piece.owner,
          mode: 'CHOSEN',
          index: targetIndex,
          turnPlaced: piece.turnPlaced,
        },
      },
      log: event,
      notice: { ...event, tone: 'NEUTRAL' },
    };
  },
};

/**
 * Sucessora da antiga ESPIONAGEM (mesmo id): antes decidia sozinha (RNG) qual
 * carta descobria e removia. Fase 4 (`pendingInteraction`, `PICK_ONE_FROM_HAND`)
 * — o jogador ESCOLHE, às cegas, qual carta oculta do oponente descartar; a
 * identidade só é revelada a ele DEPOIS, via `acknowledge` (mesmo padrão de
 * hoje, pulado para a CPU via `isAIController`).
 */
const SPY_CARD: CardDefinition = {
  id: 'SABOTAGE',
  name: 'SABOTAGEM',
  type: 'ACTION',
  description: 'Abra a mão oculta do oponente e escolha 1 carta para descartar.',
  targeting: 'NONE',
  rarity: 'EPIC',
  weight: 3,
  cost: 3,
  readsOrRemovesFromHand: true,

  canPlay: ({ state, caster }) => state[handKeyFor(opponentOf(caster))].length > 0,

  effect: (ctx) => {
    const { state, caster } = ctx;
    const target = opponentOf(caster);

    if (!ctx.interaction) {
      const opponentHand = state[handKeyFor(target)];
      if (opponentHand.length === 0) return null;
      return {
        interaction: {
          kind: 'PICK_ONE_FROM_HAND',
          source: target,
          optionUids: opponentHand.map((c) => c.uid),
        },
      };
    }

    const selection = ctx.interaction.selection;
    if (selection.kind !== 'PICK_ONE_FROM_HAND') return null;
    const opponentHand = state[handKeyFor(target)];
    const found = opponentHand.find((c) => c.uid === selection.uid);
    if (!found) return null;

    const event = {
      code: 'CARD_SPY_DISCARD',
      subject: caster,
      target,
      value: found.cardId,
    } as const;

    return {
      patch: { [handKeyFor(target)]: opponentHand.filter((c) => c.uid !== found.uid) },
      log: event,
      notice: event,
      /* Só quem jogou vê QUAL carta era — ele escolheu às cegas, este
         acknowledge é o que confirma a identidade. O oponente já sabe a
         própria mão — não há nada para ele "descobrir" no próprio prejuízo —
         e a IA não precisa de modal nenhum (é uma ferramenta de leitura
         humana). */
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
  id: 'STUDY_II',
  name: 'ESTUDAR II',
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

/**
 * Carta nova. Leitura PURA: destaca a peça mais antiga do oponente no
 * tabuleiro (a próxima que sumiria sozinha ao ele colocar a 4ª peça) — não
 * altera a fila do "infinito" nem destrói nada (isso é OBSOLESCÊNCIA). O
 * destaque em si (`highlightedOldestFor`, `rules.ts`) É estado — efêmero, só
 * para a apresentação (`<Cell />`) acender um glow visível apenas para
 * `caster` — auto-invalida se a peça sair do índice por outro caminho antes
 * do turno de `caster` terminar (ver `isHighlightedOldestValid`).
 *
 * `canPlay` exige só >=1 peça do oponente, não as 3 do "infinito" — a spec
 * (`docs/CARTAS.md`) só define o caso de borda "sem NENHUMA peça", não
 * "menos de 3"; com 1-2 peças a carta destaca a mais antiga que existir,
 * mesmo antes da regra do infinito valer. Decisão registrada em
 * `docs/CARTAS.md`, não confirmada pela spec — testada como presunção.
 */
const HIGHLIGHT_OLDEST: CardDefinition = {
  id: 'HIGHLIGHT_OLDEST',
  name: 'VIDENTE',
  type: 'ACTION',
  description: 'Destaca a peça mais antiga do oponente no tabuleiro.',
  targeting: 'NONE',
  rarity: 'COMMON',
  weight: 2,
  cost: 1,

  canPlay: ({ state, caster }) => occupiedIndexes(state, opponentOf(caster)).length > 0,

  effect: ({ state, caster }) => {
    const target = opponentOf(caster);
    const oldest = getPieceIndexes(state.board, target)[0];
    if (oldest === undefined) return null;
    const piece = state.board[oldest]!; // sempre não-nulo — veio de getPieceIndexes

    const event = { code: 'CARD_HIGHLIGHT_OLDEST', subject: caster, target, value: oldest } as const;
    return {
      patch: {
        highlightedOldestFor: { caster, owner: target, index: oldest, turnPlaced: piece.turnPlaced },
      },
      log: event,
      notice: event,
    };
  },
};

/**
 * Carta nova. Família com OBSOLESCÊNCIA (épica, ver abaixo): a mesma ideia de
 * "forçar a próxima peça a sumir da fila do oponente", mas caos em vez de
 * precisão — sorteia entre TODAS as peças dele, em vez de uma escolhida.
 * Mesmo mecanismo (`forcedVanish`, `rules.ts`), parametrizado com `RANDOM`.
 *
 * Sem `canPlay`: mesmo sem peça nenhuma ainda, a carta pode ser jogada — o
 * efeito só passa a valer quando o oponente acumular peças o bastante para a
 * regra do infinito importar (consistência com o motor não travar efeitos
 * "adiados"; `docs/CARTAS.md` marca isso como não confirmado pela spec).
 */
const QUEUE_SHUFFLE: CardDefinition = {
  id: 'QUEUE_SHUFFLE',
  name: 'ANOMALIA',
  type: 'ACTION',
  description: 'A próxima peça do oponente a sumir da fila do "infinito" passa a ser aleatória.',
  targeting: 'NONE',
  rarity: 'RARE',
  weight: 2,
  cost: 2,
  targetsOpponentResource: true,

  effect: ({ caster }) => {
    const target = opponentOf(caster);
    const event = { code: 'CARD_QUEUE_SHUFFLE', subject: caster, target } as const;
    return {
      patch: { forcedVanish: { owner: target, mode: 'RANDOM' } },
      log: event,
      notice: event,
    };
  },
};

/**
 * Carta nova. Troca 1 carta por vez, com escolha manual dos dois lados —
 * distinta de PERMUTA CAÓTICA (`HAND_SWAP`, Lendária, mão inteira, sem
 * escolha). Encadeamento de 2 passos via `pendingInteraction`: passo 1
 * (`source: caster`) escolhe a carta PRÓPRIA a oferecer; passo 2
 * (`source: oponente`) escolhe, às cegas, a carta a receber. Mesmo formato
 * que a fixture "TROCAR-shaped" da Fase 3 já provou (`pendingInteraction.test.ts`),
 * agora com carta real.
 *
 * RICOCHETE (Fase 4, Achado 2): `targetsOpponentResource: true` mantém o
 * VETO (a carta lê a mão do oponente antes de completar), mas SEM entrada em
 * `RICOCHET_INVERSIONS` — no instante em que o contra-ataque dispara (antes
 * do passo 1 abrir), não existe ainda "a carta que o atacante escolheria"
 * para inverter. Cai no mesmo fallback de ANTIMAGIA (só anula) — ver
 * `docs/NOTAS_TECNICAS.md`.
 */
const SINGLE_CARD_TRADE: CardDefinition = {
  id: 'SINGLE_CARD_TRADE',
  name: 'TROCAR',
  type: 'ACTION',
  description: 'Escolha 1 carta sua e troque por 1 carta oculta do oponente.',
  targeting: 'NONE',
  rarity: 'RARE',
  weight: 2,
  cost: 2,
  readsOrRemovesFromHand: true,
  targetsOpponentResource: true,

  // Precisa de mais alguma carta na própria mão além da própria TROCAR
  // (senão não há o que oferecer) e de alguma carta do lado do oponente.
  canPlay: ({ state, caster }) =>
    state[handKeyFor(caster)].length > 1 && state[handKeyFor(opponentOf(caster))].length > 0,

  effect: (ctx) => {
    const { state, caster, uid } = ctx;
    const target = opponentOf(caster);

    if (!ctx.interaction) {
      // Passo 1: mão PRÓPRIA do caster, excluindo a própria TROCAR jogada
      // (ela só sai da mão no `resolveCardPlay` normal — aqui `uid` ainda
      // identifica a carta jogada nesta 1ª chamada).
      const ownOptions = state[handKeyFor(caster)].filter((c) => c.uid !== uid).map((c) => c.uid);
      if (ownOptions.length === 0) return null;
      return { interaction: { kind: 'PICK_ONE_FROM_HAND', source: caster, optionUids: ownOptions } };
    }

    if (ctx.interaction.priorSelections.length === 0) {
      // Passo 2: mão OCULTA do oponente.
      const opponentOptions = state[handKeyFor(target)].map((c) => c.uid);
      if (opponentOptions.length === 0) return null;
      return {
        interaction: { kind: 'PICK_ONE_FROM_HAND', source: target, optionUids: opponentOptions },
      };
    }

    // Passo 3: aplica a troca com as duas escolhas já no histórico.
    const offered = ctx.interaction.priorSelections[0];
    const received = ctx.interaction.selection;
    if (offered.kind !== 'PICK_ONE_FROM_HAND' || received.kind !== 'PICK_ONE_FROM_HAND') return null;

    // A carta jogada já saiu da mão do caster ao abrir a interação (Fase 3,
    // timing unificado) — `state` aqui já reflete isso.
    const casterHand = state[handKeyFor(caster)];
    const opponentHand = state[handKeyFor(target)];
    const offeredCard = casterHand.find((c) => c.uid === offered.uid);
    const receivedCard = opponentHand.find((c) => c.uid === received.uid);
    if (!offeredCard || !receivedCard) return null;

    const event = {
      code: 'CARD_SINGLE_TRADE',
      subject: caster,
      target,
      value: receivedCard.cardId,
    } as const;

    return {
      patch: {
        [handKeyFor(caster)]: [...casterHand.filter((c) => c.uid !== offeredCard.uid), receivedCard],
        [handKeyFor(target)]: [...opponentHand.filter((c) => c.uid !== receivedCard.uid), offeredCard],
      },
      log: event,
      notice: event,
    };
  },
};

/**
 * Carta nova. Sucessora espiritual da antiga ESPIONAGEM (que virou SABOTAGEM,
 * ver acima) — revela SEM descartar. Usa `PICK_MANY_FROM_HAND` (não
 * `PICK_ONE_FROM_HAND` ×2): a escolha é simultânea, não encadeada, e o clamp
 * de `count` já pronto do `openInteraction` (Fase 3) resolve sozinho o caso
 * de borda "mão do oponente com só 1 carta" — vira `count: 1`, sem travar.
 */
const INTEL_REVEAL: CardDefinition = {
  id: 'INTEL_REVEAL',
  name: 'ESPIONAGEM',
  type: 'ACTION',
  description: 'Abra a mão oculta do oponente e revele até 2 cartas, sem descartar.',
  targeting: 'NONE',
  rarity: 'RARE',
  weight: 2,
  cost: 2,
  readsOrRemovesFromHand: true,

  canPlay: ({ state, caster }) => state[handKeyFor(opponentOf(caster))].length > 0,

  effect: (ctx) => {
    const { state, caster } = ctx;
    const target = opponentOf(caster);

    if (!ctx.interaction) {
      const opponentHand = state[handKeyFor(target)];
      if (opponentHand.length === 0) return null;
      return {
        interaction: {
          kind: 'PICK_MANY_FROM_HAND',
          source: target,
          optionUids: opponentHand.map((c) => c.uid),
          count: 2,
        },
      };
    }

    const selection = ctx.interaction.selection;
    if (selection.kind !== 'PICK_MANY_FROM_HAND') return null;

    const revealedKey = revealedKeyFor(target);
    const alreadyRevealed = state[revealedKey];
    const newlyRevealed = selection.uids.filter((cardUid) => !alreadyRevealed.includes(cardUid));

    const event = {
      code: 'CARD_INTEL_REVEAL',
      subject: caster,
      target,
      value: selection.uids.length,
    } as const;

    return {
      patch: newlyRevealed.length === 0 ? {} : { [revealedKey]: [...alreadyRevealed, ...newlyRevealed] },
      log: event,
      notice: event,
    };
  },
};

/**
 * Monta um `HandCard` novo com um `uid` fresco — mesma convenção de
 * `drawCardsFor` (`${cardId}#${sequência}`). Compartilhado por PROCRASTINAR/
 * PROCRASTINAR II: as duas resolvem o passo final da mesma forma, só a
 * GERAÇÃO das opções difere entre elas.
 */
function draftHandCard(cardId: CardId, nextUid: number): HandCard {
  return { uid: `${cardId}#${nextUid}`, cardId };
}

/**
 * Carta nova. `PICK_ONE_REVEALED` com opções geradas NA HORA pelo deck — não
 * são cartas de nenhuma mão, por isso `source`/`optionUids` (que sempre
 * apontam pra uma mão) não se aplicam; `options: CardId[]` é o formato certo
 * (já previsto no contrato da Fase 3). Sem `canPlay`: a carta jogada já saiu
 * da mão antes do efeito resolver, e o draft entrega exatamente 1 de volta —
 * o tamanho da mão nunca ultrapassa o que já era antes de jogar.
 */
const CARD_DRAFT: CardDefinition = {
  id: 'CARD_DRAFT',
  name: 'PROCRASTINAR',
  type: 'ACTION',
  description: 'Revela 3 cartas novas do baralho e escolha 1 para a mão.',
  targeting: 'NONE',
  rarity: 'RARE',
  weight: 2,
  cost: 2,

  effect: (ctx) => {
    const { state, caster, rng } = ctx;

    if (!ctx.interaction) {
      const options = [drawCardId(rng), drawCardId(rng), drawCardId(rng)];
      return { interaction: { kind: 'PICK_ONE_REVEALED', options } };
    }

    const selection = ctx.interaction.selection;
    if (selection.kind !== 'PICK_ONE_REVEALED') return null;

    const handKey = handKeyFor(caster);
    const drafted = draftHandCard(selection.cardId, state.nextCardUid);
    const event = { code: 'CARD_DRAFT_PICK', subject: caster, value: selection.cardId } as const;

    return {
      patch: {
        [handKey]: [...state[handKey], drafted],
        nextCardUid: state.nextCardUid + 1,
      },
      log: event,
      notice: event,
    };
  },
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
  targetsOpponentResource: true,

  effect: ({ caster }) => ({
    damage: { target: opponentOf(caster), amount: 1 },
    log: { code: 'CARD_DAMAGE', subject: caster, target: opponentOf(caster) },
  }),
};

/**
 * Carta nova. Mesmo formato de SAQUE, com probabilidade de sucesso maior
 * (25/75 em vez de 50/50) pelo custo mais alto. Corpo do `effect` idêntico ao
 * de `HAND_RAID` — só a probabilidade e os textos mudam — não extraído num
 * helper compartilhado porque os dois `LogCode`/`description` já divergem o
 * bastante pra uma função genérica não ficar mais simples que duas cópias.
 */
const HAND_RAID_II: CardDefinition = {
  id: 'HAND_RAID_II',
  name: 'SAQUE II',
  type: 'ACTION',
  description: '75% de chance de escolher uma carta do oponente para roubar. Se falhar, destrói 1 aleatória dele.',
  targeting: 'NONE',
  rarity: 'EPIC',
  weight: 2,
  cost: 3,
  readsOrRemovesFromHand: true,
  targetsOpponentResource: true,

  canPlay: ({ state, caster }) => state[handKeyFor(opponentOf(caster))].length > 0,

  effect: (ctx) => {
    const { state, caster, rng } = ctx;
    const target = opponentOf(caster);

    if (!ctx.interaction) {
      const victimHand = state[handKeyFor(target)];
      if (victimHand.length === 0) return null;

      if (!rng.chance(0.25)) {
        const destroyed = rng.pick(victimHand);
        const event = {
          code: 'CARD_RAID_DESTROYED',
          subject: caster,
          target,
          value: destroyed.cardId,
        } as const;
        return {
          patch: { [handKeyFor(target)]: victimHand.filter((c) => c.uid !== destroyed.uid) },
          log: event,
          notice: event,
        };
      }

      return {
        interaction: {
          kind: 'PICK_ONE_FROM_HAND',
          source: target,
          optionUids: victimHand.map((c) => c.uid),
        },
      };
    }

    const selection = ctx.interaction.selection;
    if (selection.kind !== 'PICK_ONE_FROM_HAND') return null;
    const victimHand = state[handKeyFor(target)];
    const stolen = victimHand.find((c) => c.uid === selection.uid);
    if (!stolen) return null;

    const event = {
      code: 'CARD_RAID_STOLE',
      subject: caster,
      target,
      value: stolen.cardId,
    } as const;

    return {
      patch: {
        [handKeyFor(caster)]: [...state[handKeyFor(caster)], stolen],
        [handKeyFor(target)]: victimHand.filter((c) => c.uid !== stolen.uid),
      },
      log: event,
      notice: event,
    };
  },
};

/**
 * Carta nova. Mesma resolução final de PROCRASTINAR — só a GERAÇÃO das
 * opções muda: distribuição de raridade GARANTIDA (2 comuns + 2 épicas + 1
 * lendária), via `draftTieredCardIds` (sorteio PARALELO a `drawCardId`,
 * bypassando `RARITY_POOL`/`RARITY_DRAW_WEIGHT` de propósito).
 */
const CARD_DRAFT_TIERED: CardDefinition = {
  id: 'CARD_DRAFT_TIERED',
  name: 'PROCRASTINAR II',
  type: 'ACTION',
  description: 'Revela 5 cartas novas do baralho (2 comuns, 2 épicas, 1 lendária) e escolha 1 para a mão.',
  targeting: 'NONE',
  rarity: 'EPIC',
  weight: 2,
  cost: 3,

  effect: (ctx) => {
    const { state, caster, rng } = ctx;

    if (!ctx.interaction) {
      return { interaction: { kind: 'PICK_ONE_REVEALED', options: draftTieredCardIds(rng) } };
    }

    const selection = ctx.interaction.selection;
    if (selection.kind !== 'PICK_ONE_REVEALED') return null;

    const handKey = handKeyFor(caster);
    const drafted = draftHandCard(selection.cardId, state.nextCardUid);
    const event = { code: 'CARD_DRAFT_PICK', subject: caster, value: selection.cardId } as const;

    return {
      patch: {
        [handKey]: [...state[handKey], drafted],
        nextCardUid: state.nextCardUid + 1,
      },
      log: event,
      notice: event,
    };
  },
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
  id: 'TURNO_EXTRA',
  name: 'TURNO EXTRA',
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
    log: { code: 'CARD_TURNO_EXTRA', subject: caster },
  }),
};

/**
 * `readsOrRemovesFromHand: true` (Fase 5, auditoria) — diferente de
 * `HAND_SWAP` (acima), que omite a flag de propósito porque a imunidade de
 * raridade já a protege inteiramente. Aqui a flag É a categoria correta
 * (a carta LÊ a mão inteira do oponente) mesmo sendo Lendária — marcá-la não
 * MUDA nenhum comportamento observável hoje (o `triggerCondition` de
 * PROTEÇÃO checa a categoria E `!isImmuneToTraps`; a raridade barra o veto de
 * qualquer forma), mas é a categoria HONESTA: se um rebalanceamento futuro
 * baixar `FULL_INTEL` pra uma raridade não-imune, PROTEÇÃO já cobre sem
 * precisar lembrar de voltar aqui e adicionar a flag esquecida. Testado em
 * `gameStore.test.ts` ("categoria bate, raridade vence").
 */
const FULL_INTEL: CardDefinition = {
  id: 'FULL_INTEL',
  name: 'VISÃO ABSOLUTA',
  type: 'ACTION',
  description: 'Vire quantas cartas quiser da mão do oponente. Armadilhas já na mesa continuam secretas.',
  targeting: 'NONE',
  rarity: 'LEGENDARY',
  weight: 3,
  cost: 3,
  readsOrRemovesFromHand: true,

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

    // Revelação com prazo — expira no fim do turno de `caster` (`placeMark`/
    // `endTurn`/`startNextRound`, ver `fullIntelRevealFor` em `rules.ts`).
    // Vale para os dois ramos: a IA não vê modal, mas o `<HandTracker />` do
    // HUMANO do outro lado precisa saber que a própria mão está exposta.
    const patch = { fullIntelRevealFor: caster };

    if (isAIController(state, caster)) {
      return { patch, log: intel, notice: intel };
    }

    return {
      patch,
      log: intel,
      // Sem embaralhar, ao contrário da ESPIONAGEM: todas já vêm reveladas
      // (kind `INTEL_FLIP`, `AcknowledgementModal.tsx`) — não há seleção nem
      // posição privilegiada a proteger, é exibição, não interação.
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
 * Sucessora da antiga PROTEÇÃO (mesmo id): antes cobria uma lista fixa de 2
 * ids (`HAND_RAID`, `SPY_CARD`) — agora é definida por CATEGORIA
 * (`readsOrRemovesFromHand`), cobrindo automaticamente qualquer carta futura
 * que leia ou retire da mão sem precisar voltar a editar este trigger (ver
 * `docs/CARTAS.md`, entrada de PROTEÇÃO — uma lista enumerada "apodrece").
 * `isImmuneToTraps` é defesa extra: nenhuma carta da categoria é Lendária
 * hoje, mas uma futura poderia ser, e a imunidade tem que vencer sempre.
 * Rebaixada de Épica/custo 2 para Rara/custo 1 — era cara demais para o que
 * faz.
 */
const SHIELD_TRAP: CardDefinition = {
  id: 'SHIELD_TRAP',
  name: 'PROTEÇÃO',
  type: 'TRAP',
  description: 'Virada na mesa. Anula a próxima carta do oponente que leia ou retire cartas da sua mão.',
  targeting: 'NONE',
  rarity: 'RARE',
  weight: 2,
  cost: 1,

  triggerCondition: (event) =>
    event.type === 'CARD_ABOUT_TO_RESOLVE' &&
    getCard(event.cardId).readsOrRemovesFromHand === true &&
    !isImmuneToTraps(getCard(event.cardId).rarity),

  effect: ({ caster }) => ({ cancelsAction: true, log: { code: 'TRAP_SHIELD', subject: caster } }),
};

/**
 * Carta nova. Cobertura UNIVERSAL por exclusão de raridade — anula a PRÓXIMA
 * carta do oponente, ação ou ARMAR de outra armadilha não-lendária/Boom
 * (`docs/CARTAS.md`: a leitura "só Feitiço" foi descartada, cobriria cartas
 * demais para o custo). O oponente perde a energia gasta mesmo anulado —
 * `resolveCardPlay` já debita o custo ANTES de chamar `resolveCounterTraps`,
 * então isso é automático, não precisa de nada aqui.
 *
 * Cobrir o ARMAR de outra armadilha (não só ações) exige que
 * `resolveCardPlay` (gameStore.ts) também chame `resolveCounterTraps` no
 * ramo de `type === 'TRAP'` — hoje só o ramo de ação passa por ali (ver
 * mudança correspondente no store).
 */
const ANTI_SPELL_TRAP: CardDefinition = {
  id: 'ANTI_SPELL_TRAP',
  name: 'ANTIMAGIA',
  type: 'TRAP',
  description: 'Virada na mesa. Anula a próxima carta do oponente, exceto Lendárias e Boom.',
  targeting: 'NONE',
  rarity: 'RARE',
  weight: 2,
  cost: 2,

  triggerCondition: (event) =>
    event.type === 'CARD_ABOUT_TO_RESOLVE' && !isImmuneToTraps(getCard(event.cardId).rarity),

  effect: ({ caster }) => ({ cancelsAction: true, log: { code: 'TRAP_ANTI_SPELL', subject: caster } }),
};

/**
 * Inversões bem definidas para RICOCHETE, por `cardId` — a categoria
 * (`targetsOpponentResource`) decide SE a armadilha dispara; esta tabela
 * decide COMO inverter, e só existe para os efeitos onde isso tem sentido
 * claro (`docs/CARTAS.md`, regra de fallback). Cartas marcadas
 * `targetsOpponentResource` mas ausentes daqui (hoje: `OBSOLESCENCE`,
 * `QUEUE_SHUFFLE`) caem no fallback de RICOCHETE — só anula, não inverte.
 *
 * Cada inversor decide o resultado de forma DETERMINÍSTICA — não replica o
 * RNG da carta original (ex: o 50/50 de SAQUE nunca chega a rodar, porque
 * RICOCHETE intercepta ANTES do `effect` original ser chamado). "O efeito se
 * inverte e atinge o próprio autor" é lido como a versão CANÔNICA/garantida
 * do efeito, não uma repetição do sorteio dele.
 */
/**
 * Corpo compartilhado por `HAND_RAID`/`HAND_RAID_II` na tabela abaixo — as
 * duas invertem exatamente da mesma forma (rouba 1 carta aleatória do
 * atacante), só o `cost`/probabilidade de cada uma diferem, e nenhuma delas
 * importa aqui (RICOCHETE intercepta ANTES do `rng.chance` da carta original
 * rodar, então "qual carta era" nunca chega a se saber).
 */
function stealRandomFromAttacker({
  state,
  rng,
  defender,
  attacker,
}: {
  state: GameState;
  rng: Rng;
  defender: Combatant;
  attacker: Combatant;
}): Partial<CardEffectResult> {
  const attackerHand = state[handKeyFor(attacker)];
  if (attackerHand.length === 0) return {};

  const stolen = rng.pick(attackerHand);
  return {
    patch: {
      [handKeyFor(defender)]: [...state[handKeyFor(defender)], stolen],
      [handKeyFor(attacker)]: attackerHand.filter((c) => c.uid !== stolen.uid),
    },
  };
}

const RICOCHET_INVERSIONS: Partial<
  Record<
    CardId,
    (ctx: { state: GameState; rng: Rng; defender: Combatant; attacker: Combatant }) => Partial<CardEffectResult>
  >
> = {
  DIRECT_DAMAGE: ({ attacker }) => ({ damage: { target: attacker, amount: 1 } }),

  HAND_RAID: stealRandomFromAttacker,
  HAND_RAID_II: stealRandomFromAttacker,

  // SINGLE_CARD_TRADE (TROCAR) fica de propósito FORA desta tabela — Fase 4,
  // Achado 2: no instante em que o contra-ataque dispara (antes do passo 1
  // da interação abrir), não existe ainda "a carta que o atacante ofereceria"
  // pra inverter. Cai no fallback abaixo (`?? {}`) — RICOCHETE só anula,
  // mesmo comportamento de ANTIMAGIA. Ver `docs/NOTAS_TECNICAS.md`.
};

/**
 * Carta nova. Dispara contra QUALQUER efeito do oponente direcionado ao
 * caster ou aos recursos dele (`targetsOpponentResource`) — categoria, não a
 * lista de 3 exemplos do PDF. Quando bem definida, a inversão vem de
 * `RICOCHET_INVERSIONS`; senão, só anula (mesmo fallback de ANTIMAGIA).
 *
 * Inverter dano precisa que `resolveCounterTraps` (gameStore.ts) processe
 * `result.damage`/`result.heal` — antes disso nenhuma armadilha tinha
 * causado dano, só cancelado (ver mudança correspondente no store).
 */
const REFLECT_TRAP: CardDefinition = {
  id: 'REFLECT_TRAP',
  name: 'RICOCHETE',
  type: 'TRAP',
  description: 'Virada na mesa. Inverte ou anula o próximo efeito do oponente direcionado a você.',
  targeting: 'NONE',
  rarity: 'RARE',
  weight: 2,
  cost: 2,

  triggerCondition: (event) =>
    event.type === 'CARD_ABOUT_TO_RESOLVE' &&
    getCard(event.cardId).targetsOpponentResource === true &&
    !isImmuneToTraps(getCard(event.cardId).rarity),

  effect: ({ state, caster, event, rng }) => {
    if (!event || event.type !== 'CARD_ABOUT_TO_RESOLVE') return null;
    const attacker = event.player;
    const inverted = RICOCHET_INVERSIONS[event.cardId]?.({ state, rng, defender: caster, attacker }) ?? {};

    return {
      cancelsAction: true,
      log: { code: 'TRAP_RICOCHET', subject: caster, target: attacker },
      ...inverted,
    };
  },
};

/* -------------------------------------------------------------------------- */
/*                          CUSTO 0 — CAOS                                      */
/* -------------------------------------------------------------------------- */

/**
 * Reforma completa (Fase 6a) — sistema SEPARADO do surto automático do
 * relógio global: a carta não dispara mais `triggersChaosGlitch`
 * (`triggerTerminalGlitch` continua sendo só o mecanismo periódico,
 * `docs/CARTAS.md`). Em vez disso, embaralha as posições das peças JÁ
 * EXISTENTES no tabuleiro — sorteia uma ordem para as 9 células
 * (`rng.shuffle`) e distribui: as primeiras `countX` recebem as peças X, as
 * próximas `countO` recebem as peças O, o resto fica vazio. Reshuffle TOTAL,
 * não permutação só entre células já ocupadas — é o que faz a carta valer a
 * pena mesmo com 1-2 peças no tabuleiro (uma peça isolada pode ir para
 * qualquer uma das 9 células, inclusive uma que estava vazia).
 *
 * `turnPlaced` NÃO é recalculado — cada peça é o MESMO objeto `Piece`
 * (`owner`/`mark`/`turnPlaced` intactos), só muda de índice no array
 * `board`. A regra do "infinito" (`getOldestPieceIndex`/`getVanishingIndex`)
 * nunca olhou índice, só `turnPlaced`+`owner` — preservando o objeto, a peça
 * que era "a mais antiga" antes do sorteio continua sendo depois, onde quer
 * que caia.
 *
 * Efeito colateral já coberto de graça, sem código novo: se `forcedVanish`
 * (ANOMALIA/OBSOLESCÊNCIA) apontava uma peça por índice+`turnPlaced` e o
 * reshuffle move essa peça pra outro índice, a auto-invalidação por
 * identidade que `getVanishingIndex` já faz invalida a marca sozinha (o
 * índice antigo não bate mais) — 3ª ocorrência do mesmo padrão nesta Parte
 * B (1ª: DEMOLIR removendo uma peça marcada; 2ª: ANOMALIA/OBSOLESCÊNCIA
 * sobrescrevendo a marca uma da outra). Reconhecer o padrão aqui evita
 * reinventar a checagem numa 4ª carta futura.
 *
 * Limite de 3 por símbolo garantido por CONSTRUÇÃO, não por checagem
 * posterior: `countX`/`countO` vêm do tabuleiro ATUAL, que já nunca excede
 * 3 por símbolo (regra do "infinito" em vigor há muito) — o sorteio nunca
 * CRIA peça nova, só realoca as que já existem, então não há como o
 * resultado ultrapassar o limite.
 *
 * `findWinner` pode fechar linha para os DOIS símbolos ao mesmo tempo (ex:
 * X em `[0,1,2]`, O em `[3,4,5]` — geometricamente possível, 6 das 9
 * células, dentro do limite) — a primeira carta a tornar isso possível,
 * já que normalmente só 1 peça é colocada por vez. Decisão: `findWinner`
 * já escaneia `WIN_LINES` em ordem fixa e devolve a PRIMEIRA que casar —
 * aceito como desempate oficial, sem mudar `findWinner`/
 * `applyCardEffectResult` só por este caso raro. Ver `docs/NOTAS_TECNICAS.md`.
 *
 * Sem reroll se o sorteio produzir um board idêntico (ou equivalente) ao
 * anterior — raro, mas um resultado HONESTO da "roleta" (mesma textura de
 * SAQUE às vezes não fazer nada no 50/50); forçar reroll quebraria o
 * consumo fixo de RNG que o resto do motor favorece por um ganho marginal.
 */
const CHAOS_ROULETTE: CardDefinition = {
  id: 'CHAOS_ROULETTE',
  name: 'TIC TAC BOOM!',
  type: 'ACTION',
  description: 'Embaralha as peças do tabuleiro em novas posições, respeitando o limite de 3 por símbolo.',
  targeting: 'NONE',
  rarity: 'BOOM',
  weight: 1,
  cost: 0,

  // Sem `canPlay`: sempre jogável, em qualquer estado de tabuleiro — o
  // próprio sorteio respeita o limite de 3 peças por símbolo por construção.
  effect: ({ state, caster, rng }) => {
    const xPieces: Piece[] = [];
    const oPieces: Piece[] = [];
    for (const cell of state.board) {
      if (!cell) continue;
      (cell.mark === 'X' ? xPieces : oPieces).push(cell);
    }

    const cellOrder = rng.shuffle([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    const board: Board = createEmptyBoard();
    cellOrder.slice(0, xPieces.length).forEach((index, i) => {
      board[index] = xPieces[i];
    });
    cellOrder.slice(xPieces.length, xPieces.length + oPieces.length).forEach((index, i) => {
      board[index] = oPieces[i];
    });

    return {
      patch: { board },
      log: { code: 'CARD_CHAOS_ROULETTE', subject: caster },
    };
  },
};

/**
 * Fase 6b: migrado para `SACRIFICE_DRAG` (`pendingInteraction`) — era o
 * último dos 5 `kind`s nunca exercitado por uma carta real (só fixture
 * sintética da Fase 3). `resolveInteraction` já tratava o `kind`
 * genericamente desde então; faltava só esta carta o usar de verdade.
 *
 * Fecha de graça a 5ª ocorrência do padrão "regra de domínio só respeitada
 * porque a UI não oferece o caminho" (`AGENTS.md`): o mecanismo antigo
 * (`lastAltarPrompt`) não era checado por NENHUMA guarda do motor, só pelo
 * `<Modal>` nativo do `<AltarModal />` bloqueando toque. `pendingInteraction`
 * já é recusado por `canPlaceAt`/`resolveCardPlay` como qualquer outra
 * interação pendente. Bônus: `cancelInteraction` sempre devolve a carta —
 * corrige de graça um `handleCancel` que hoje nunca reembolsa o Altar.
 *
 * 1º passo (`!ctx.interaction`): abre a interação com as `uid`s elegíveis
 * (mão menos o próprio Altar). 2º passo: funde as 2 raridades sacrificadas
 * (`fuseRarity`, `CLAUDE.md` #5) e sorteia (canal `CARDS`, mesma primitiva de
 * `drawCardId`) uma carta dentro da raridade resultante para entregar na mão.
 */
const ALTAR_OF_SACRIFICE: CardDefinition = {
  id: 'ALTAR_OF_SACRIFICE',
  name: 'ALTAR DE SACRIFÍCIO',
  type: 'ACTION',
  description: 'Arraste 2 cartas da mão para o altar. A oferenda funde as raridades e invoca uma carta nova.',
  targeting: 'NONE',
  rarity: 'BOOM',
  weight: 1,
  cost: 0,

  // Precisa de 2 OUTRAS cartas na mão além do próprio Altar — senão a
  // interação abriria para um ritual impossível de completar.
  canPlay: ({ state, caster, uid }) =>
    state[handKeyFor(caster)].filter((c) => c.uid !== uid).length >= 2,

  effect: (ctx) => {
    const { state, caster, uid, rng } = ctx;

    if (!ctx.interaction) {
      const eligibleUids = state[handKeyFor(caster)].filter((c) => c.uid !== uid).map((c) => c.uid);
      return { interaction: { kind: 'SACRIFICE_DRAG', eligibleUids, count: 2 } };
    }

    const selection = ctx.interaction.selection;
    if (selection.kind !== 'SACRIFICE_DRAG') return null;

    const handKey = handKeyFor(caster);
    const hand = state[handKey];
    const [uidA, uidB] = selection.uids;
    const cardA = hand.find((c) => c.uid === uidA);
    const cardB = hand.find((c) => c.uid === uidB);
    if (!cardA || !cardB || cardA.uid === cardB.uid) return null;

    const resultRarity = fuseRarity(getCard(cardA.cardId).rarity, getCard(cardB.cardId).rarity);
    const invokedId = rng.pick(IDS_BY_RARITY[resultRarity]);
    const invoked = { uid: `${invokedId}#${state.nextCardUid}`, cardId: invokedId };

    return {
      patch: {
        [handKey]: [...hand.filter((c) => c.uid !== uidA && c.uid !== uidB), invoked],
        nextCardUid: state.nextCardUid + 1,
      },
      log: { code: 'CARD_ALTAR_INVOKED', subject: caster, value: invokedId },
      notice: { code: 'CARD_ALTAR_INVOKED', subject: caster, value: invokedId },
    };
  },
};

/**
 * Bloqueia a COLOCAÇÃO de peça do oponente por um turno — o resto do turno
 * dele segue normal (energia regenera, ele joga cartas, arma armadilhas).
 * Mecanismo novo (`playerPlacementBlocked`/`machinePlacementBlocked`,
 * `rules.ts`), consultado só por `canPlaceAt`. Distinto de TURNO_EXTRA
 * (`extraTurnPending`), que pula a alternância de turno INTEIRA — aqui o
 * oponente ainda tem a vez, só não pode jogar peça nela.
 *
 * Sem `canPlay`: sempre jogável, mesmo contra um alvo já bloqueado (dois
 * turnos seguidos seria o resultado — jogada tática legítima, já paga com
 * carta+energia, não desperdício a impedir) e mesmo enquanto o PRÓPRIO caster
 * está bloqueado (jogar aqui não desbloqueia quem joga — `canPlay` não existe
 * para proteger o jogador de decisão ruim, mesmo raciocínio do VIDENTE).
 */
const PLACEMENT_LOCK: CardDefinition = {
  id: 'REBOBINAR',
  name: 'REBOBINAR',
  type: 'ACTION',
  description:
    'O oponente joga o turno normalmente (energia, cartas, armadilhas), mas não pode colocar peça nele.',
  targeting: 'NONE',
  rarity: 'EPIC',
  weight: 3,
  cost: 3,

  effect: ({ caster }) => {
    const target = opponentOf(caster);
    const event = { code: 'CARD_REBOBINAR', subject: caster, target } as const;

    return {
      patch: { [placementBlockedKeyFor(target)]: true },
      log: event,
      notice: { ...event, tone: 'NEUTRAL' },
    };
  },
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
  STUDY: DRAW_CARD,
  HAND_RAID,
  HAND_SWAP: CARD_TRADE,
  OBSOLESCENCE: MARK_DOOMED,
  SABOTAGE: SPY_CARD,
  STUDY_II: DRAW_CARD_BIG,
  DIRECT_DAMAGE,
  HEAL_SELF,
  TURNO_EXTRA: EXTRA_TURN,
  BOMB_TRAP,
  FULL_INTEL,
  CHAOS_ROULETTE,
  ALTAR_OF_SACRIFICE,
  HIGHLIGHT_OLDEST,
  QUEUE_SHUFFLE,
  ANTI_SPELL_TRAP,
  REFLECT_TRAP,
  REBOBINAR: PLACEMENT_LOCK,
  HAND_RAID_II,
  SINGLE_CARD_TRADE,
  INTEL_REVEAL,
  CARD_DRAFT,
  CARD_DRAFT_TIERED,
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

/** Faixas e quantidades garantidas de `draftTieredCardIds` — 2 comuns, 2 épicas, 1 lendária. */
const TIERED_DRAFT_PLAN: readonly (readonly [CardRarity, number])[] = [
  ['COMMON', 2],
  ['EPIC', 2],
  ['LEGENDARY', 1],
];

/**
 * Sorteio PARALELO ao normal (`drawCardId`) — usado só por PROCRASTINAR II.
 * Garante EXATAMENTE 2 comuns + 2 épicas + 1 lendária, ignorando o peso por
 * faixa (`RARITY_DRAW_WEIGHT`/`RARITY_POOL`) de propósito: é uma distribuição
 * GARANTIDA pelo design da carta, não uma compra ponderada normal. Consome 5
 * números do canal (1 `pick` por carta) — quantidade fixa, mesmo raciocínio
 * de determinismo de `drawCardId`.
 *
 * **Invariant explícito, não deixado para `rng.pick` estourar sozinho:** hoje
 * (COMMON/EPIC/LEGENDARY todas com várias cartas) isto nunca dispara — mas é
 * contagem do PRESENTE, não garantia futura. Se uma fase futura reclassificar
 * a raridade de uma carta e uma faixa esvaziar, o erro aqui aponta
 * exatamente qual faixa faltou e por qual carta, em vez do genérico
 * `[rng] pick() recebeu uma lista vazia` sem contexto nenhum.
 */
export function draftTieredCardIds(rng: Rng): CardId[] {
  const picks: CardId[] = [];
  for (const [rarity, count] of TIERED_DRAFT_PLAN) {
    const pool = IDS_BY_RARITY[rarity];
    if (pool.length === 0) {
      throw new Error(
        `[cards] draftTieredCardIds: faixa ${rarity} não tem carta nenhuma registrada — ` +
          'PROCRASTINAR II (CARD_DRAFT_TIERED) não pode garantir a distribuição 2 comuns + 2 épicas + 1 lendária sem isso.',
      );
    }
    for (let i = 0; i < count; i++) picks.push(rng.pick(pool));
  }
  return picks;
}
