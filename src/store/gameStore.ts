import { create } from 'zustand';
import { MatchStatus, ChaosRule } from '@/engine/rules';
import { drawCardId, getCard } from '@/engine/cards/registry';
import { eventActor } from '@/engine/events';
import { getChannel, getMatchSeed, seedMatch } from '@/engine/rng';
import {
  HAND_LIMIT,
  INITIAL_HP,
  LOG_LIMIT,
  MARK_BY_COMBATANT,
  MAX_PIECES_PER_PLAYER,
  ROUND_DAMAGE,
  TRAP_LIMIT,
  canPlaceAt,
  createEmptyBoard,
  findWinner,
  getOldestPieceIndex,
  getPieceIndexes,
  getVanishingIndex,
  isValidTargetForCard,
  pickFreeCell,
  type Combatant,
  type GameState,
  type PendingAction,
} from '@/engine/rules';
import type { CardId } from '@/engine/cards/definitions';
import type { GameEvent } from '@/engine/events';

/* -------------------------------------------------------------------------- */
/*                              DOMÍNIO (reexport)                             */
/* -------------------------------------------------------------------------- */
/* O modelo de domínio vive em `@/engine/rules`. Reexportamos daqui porque
   praticamente todo componente já importa do store — um import só é mais
   simples de consumir do que dois, e os arquivos existentes seguem valendo.
   A direção da dependência continua sendo `store → engine`, nunca o inverso. */

export {
  HAND_LIMIT,
  INITIAL_HP,
  LOG_LIMIT,
  MARK_BY_COMBATANT,
  MAX_PIECES_PER_PLAYER,
  ROUND_DAMAGE,
  TRAP_LIMIT,
  canPlaceAt,
  createEmptyBoard,
  findWinner,
  getOldestPieceIndex,
  getPieceIndexes,
  getVanishingIndex,
  isValidTargetForCard,
  pickFreeCell,
};

export { WIN_LINES, occupiedIndexes, opponentOf } from '@/engine/rules';

export type {
  Board,
  BoardCell,
  ChaosRule,
  HandCard,
  LogLine,
  Mark,
  MatchStatus,
  Piece,
} from '@/engine/rules';

export type { CardId, Combatant, GameState, PendingAction };

export interface GameActions {
  /**
   * Registra uma jogada na célula `index` para o combatente da vez.
   *
   * Fluxo:
   * 1. valida (partida em andamento, célula livre, célula não bloqueada);
   * 2. se o jogador já tem 3 peças, remove a mais antiga (ou uma aleatória
   *    sob RANDOM_FADE) — a remoção acontece ANTES de posicionar a nova;
   * 3. posiciona a peça carimbando o `turnCount` atual;
   * 4. checa vitória: se houver, aplica dano e encerra a rodada;
   * 5. caso contrário, incrementa o turno e passa a vez.
   *
   * Jogadas inválidas são ignoradas silenciosamente (no-op).
   */
  placeMark: (index: number) => void;

  /** Reduz o HP do alvo. Faz clamp em 0 e encerra a partida se zerar. */
  takeDamage: (target: Combatant, amount: number) => void;

  /** Troca a regra caótica ativa. `payload.cell` só é usado por BLOCKED_CELL. */
  applyChaosRule: (rule: ChaosRule, payload?: { cell?: number }) => void;

  /**
   * Inicia uma partida nova (zera HP, tabuleiro, regra e mão) e (re)semeia o
   * RNG. Passe uma `seed` para reproduzir uma partida específica; omita para
   * sortear uma nova.
   */
  startMatch: (seed?: number) => void;

  /** Limpa o tabuleiro mantendo o HP — usado entre rodadas. */
  startNextRound: () => void;

  /** Passa a vez sem jogar (útil para cartas de "pular turno"). */
  endTurn: () => void;

  /**
   * Recebe o sinal de instabilidade emitido pelo Chaos Terminal (WebView) e
   * sorteia uma nova `ChaosRule` pelo canal `RULES` do RNG.
   *
   * Fecha o ciclo da ponte: terminal surta ➜ regra muda ➜ regra volta para o
   * terminal exibir com glitch.
   */
  triggerTerminalGlitch: () => void;

  /**
   * Sorteia (canal `TERMINAL`) o intervalo até o próximo surto do terminal.
   *
   * Fica no store, e não dentro do HTML, porque `Math.random()` na WebView
   * seria a última fonte de não-determinismo do projeto — inauditável e fora
   * do alcance da seed.
   */
  rollTerminalDelay: () => number;

  /**
   * Compra `count` cartas pelo canal `CARDS` do RNG (sorteio ponderado pelo
   * `weight` de cada definição). Respeita `HAND_LIMIT` — compras além do
   * limite são descartadas silenciosamente, como em jogos de mesa.
   */
  drawCard: (count?: number) => void;

  /**
   * Executa o efeito da carta identificada por `uid` e a remove da mão.
   *
   * Endereçar por `uid` (e não por `cardId`) é o que permite jogar *aquela*
   * carta específica quando a mão tem duplicatas.
   *
   * @returns `true` se a carta foi jogada. `false` em jogada inválida (fora
   * do turno, `uid` ausente da mão, alvo faltando ou ilegal, `canPlay`
   * reprovou, ou o efeito devolveu `null`) — nesse caso nada muda.
   */
  playCard: (uid: string, targetIndex?: number) => boolean;

  /**
   * Entra em modo mira. Valida antes de armar: turno, fase, presença na mão e
   * se a carta realmente exige alvo.
   *
   * @returns `true` se o modo mira foi armado.
   */
  setPendingAction: (action: PendingAction | null) => boolean;

  /** Sai do modo mira sem jogar a carta. */
  clearPendingAction: () => void;

  /**
   * Publica um fato no barramento e resolve as armadilhas que ele acionar.
   *
   * Só as armadilhas do **oponente** de quem causou o evento são consultadas.
   * A que disparar tem o efeito aplicado e é removida da mesa.
   *
   * Reentrante por fila: se um efeito de armadilha publicar outro evento (via
   * `takeDamage`, por exemplo), ele entra no fim da fila em vez de recursar.
   */
  dispatchEvent: (event: GameEvent) => void;

  /**
   * Acrescenta uma linha ao log de combate.
   *
   * O store não conhece a WebView: ele só publica texto. O `<ChaosTerminal />`
   * assina `terminalLog` e imprime o que ainda não viu. Trocar o terminal por
   * outro widget não exige tocar em nenhuma regra de jogo.
   */
  pushLog: (text: string) => void;
}

export type GameStore = GameState & GameActions;

const createInitialState = (): GameState => ({
  board: createEmptyBoard(),
  turn: 'PLAYER',
  turnCount: 0,
  playerHp: INITIAL_HP,
  machineHp: INITIAL_HP,
  activeRule: 'NORMAL',
  blockedCell: null,
  playerHand: [],
  nextCardUid: 0,
  pendingAction: null,
  playerTraps: [],
  machineTraps: [],
  lastRevealedTrap: null,
  terminalLog: [],
  nextLogId: 0,
  extraTurnPending: null,
  status: 'IDLE',
  roundWinner: null,
  winningLine: null,
  matchWinner: null,
  lastVanishedIndex: null,
  matchSeed: getMatchSeed(),
});

/* -------------------------------------------------------------------------- */
/*                              FILA DO BARRAMENTO                             */
/* -------------------------------------------------------------------------- */
/* Estado de módulo, fora do Zustand de propósito: é maquinário de despacho,
   não estado de jogo. Colocá-lo no store faria cada evento em trânsito
   disparar re-render de quem assina a store.                                 */

let eventQueue: GameEvent[] = [];
let isDraining = false;

/** Zera o barramento. Chamado por `startMatch`. */
function resetEventBus(): void {
  eventQueue = [];
  isDraining = false;
}

/* -------------------------------------------------------------------------- */
/*                                    STORE                                    */
/* -------------------------------------------------------------------------- */

export const useGameStore = create<GameStore>()((set, get) => ({
  ...createInitialState(),

  placeMark: (index) => {
    const state = get();

    // --- Guardas (compartilhadas com a UI via canPlaceAt) ------------------
    if (!canPlaceAt(state, index)) return;

    const owner = state.turn;
    const board = [...state.board];

    // --- 1. Abre espaço removendo a peça condenada -------------------------
    const vanishingIndex = getVanishingIndex(board, owner, state.activeRule);
    if (vanishingIndex !== null) {
      board[vanishingIndex] = null;
    }

    // --- 2. Posiciona a nova peça ------------------------------------------
    board[index] = {
      owner,
      mark: MARK_BY_COMBATANT[owner],
      turnPlaced: state.turnCount,
    };

    // --- 3. Resolve a rodada -----------------------------------------------
    const result = findWinner(board);

    if (result) {
      set({
        board,
        turnCount: state.turnCount + 1,
        lastVanishedIndex: vanishingIndex,
        status: 'ROUND_OVER',
        roundWinner: result.winner,
        winningLine: result.line,
      });

      // Quem perdeu a rodada leva dano. takeDamage cuida do fim de partida.
      const loser: Combatant = result.winner === 'PLAYER' ? 'MACHINE' : 'PLAYER';
      get().pushLog(`rodada :: ${result.winner === 'PLAYER' ? 'você venceu' : 'cpu venceu'}`);
      get().takeDamage(loser, ROUND_DAMAGE);
      return;
    }

    // --- 4. Turno extra (carta EXTRA_TURN) ---------------------------------
    // A flag é consumida aqui: vale por uma jogada só.
    const keepsTurn = state.extraTurnPending === owner;

    // Empate por tabuleiro cheio é impossível aqui: no máximo 3 + 3 = 6 peças
    // ocupam o grid de 9 células. A rodada só termina por vitória.
    set({
      board,
      turnCount: state.turnCount + 1,
      lastVanishedIndex: vanishingIndex,
      turn: keepsTurn ? owner : owner === 'PLAYER' ? 'MACHINE' : 'PLAYER',
      extraTurnPending: keepsTurn ? null : state.extraTurnPending,
    });

    /* --- 5. Barramento ------------------------------------------------------
       Publicado DEPOIS do set: quando a armadilha avalia `triggerCondition`,
       o estado já reflete a peça no tabuleiro.

       Não publicamos no caminho de vitória (return acima): com a rodada
       encerrada, uma mina detonando aplicaria dano em cima do dano da derrota
       e armaria turno extra num tabuleiro prestes a ser limpo.               */
    if (vanishingIndex !== null) {
      get().dispatchEvent({ type: 'PIECE_VANISHED', player: owner, index: vanishingIndex });
    }
    get().dispatchEvent({ type: 'PIECE_PLACED', player: owner, index });
  },

  takeDamage: (target, amount) => {
    if (amount <= 0) return;

    const state = get();
    const key = target === 'PLAYER' ? 'playerHp' : 'machineHp';
    const nextHp = Math.max(0, state[key] - amount);

    if (nextHp === state[key]) return;

    set({
      [key]: nextHp,
      ...(nextHp === 0
        ? {
            status: 'MATCH_OVER' as MatchStatus,
            matchWinner: (target === 'PLAYER' ? 'MACHINE' : 'PLAYER') as Combatant,
          }
        : null),
    });
  },

  applyChaosRule: (rule, payload) => {
    if (get().activeRule !== rule) get().pushLog(`regra :: ${rule.toLowerCase()}`);

    set({
      activeRule: rule,
      blockedCell:
        rule === 'BLOCKED_CELL'
          ? // sorteia uma célula livre se nenhuma for informada
            (payload?.cell ?? pickFreeCell(get().board))
          : null,
    });
  },

  startMatch: (seed) => {
    // Semear ANTES de montar o estado: createInitialState lê a seed efetiva.
    const usedSeed = seedMatch(seed);
    resetEventBus(); // eventos da partida anterior não vazam para a nova
    set({ ...createInitialState(), matchSeed: usedSeed, status: 'PLAYING' });
  },

  startNextRound: () =>
    set((state) => ({
      board: createEmptyBoard(),
      turnCount: 0,
      // quem perdeu a rodada começa a próxima
      turn: state.roundWinner === 'PLAYER' ? 'MACHINE' : 'PLAYER',
      status: 'PLAYING',
      roundWinner: null,
      winningLine: null,
      lastVanishedIndex: null,
      extraTurnPending: null, // turno extra não atravessa rodadas
      pendingAction: null, // mira pendente morre com a rodada
      lastRevealedTrap: null,
      // Armadilhas NÃO são limpas: continuam armadas até dispararem. É o que
      // justifica gastar uma carta numa aposta de longo prazo.
      blockedCell: state.activeRule === 'BLOCKED_CELL' ? pickFreeCell(createEmptyBoard()) : null,
    })),

  endTurn: () =>
    set((state) =>
      state.status === 'PLAYING'
        ? { turn: state.turn === 'PLAYER' ? 'MACHINE' : 'PLAYER', turnCount: state.turnCount + 1 }
        : {},
    ),

  triggerTerminalGlitch: () => {
    const { activeRule, applyChaosRule } = get();

    // Sorteio com peso: NORMAL é o "estado de repouso" e deve dominar, senão
    // o tabuleiro vira caos permanente e o jogador perde a leitura do jogo.
    const nextRule = getChannel('RULES').weighted<ChaosRule>([
      ['NORMAL', 5],
      ['RANDOM_FADE', 3],
      ['BLOCKED_CELL', 3],
    ]);

    // Repetir a regra atual desperdiçaria o surto — reroda uma única vez.
    const resolved =
      nextRule === activeRule
        ? getChannel('RULES').pick<ChaosRule>(
            (['NORMAL', 'RANDOM_FADE', 'BLOCKED_CELL'] as const).filter((r) => r !== activeRule),
          )
        : nextRule;

    applyChaosRule(resolved);
  },

  rollTerminalDelay: () => getChannel('TERMINAL').int(5000, 9000),

  drawCard: (count = 1) => {
    const rng = getChannel('CARDS');
    const before = get().playerHand.length;

    set((state) => {
      const hand = [...state.playerHand];
      let uid = state.nextCardUid;

      for (let i = 0; i < count && hand.length < HAND_LIMIT; i++) {
        const cardId = drawCardId(rng);
        // Contador em vez de RNG: o uid é identidade de UI, não conteúdo de
        // jogo. Gastar números do canal CARDS aqui deslocaria a sequência de
        // sorteio das cartas e quebraria o replay por um detalhe de render.
        hand.push({ uid: `${cardId}#${uid++}`, cardId });
      }

      // Identidade nova só se algo entrou — evita re-render à toa da mão.
      return hand.length === state.playerHand.length ? {} : { playerHand: hand, nextCardUid: uid };
    });

    if (get().playerHand.length > before) {
      get().dispatchEvent({ type: 'CARD_DRAWN', player: 'PLAYER' });
    }
  },

  setPendingAction: (action) => {
    if (action === null) {
      set({ pendingAction: null });
      return false;
    }

    const state = get();
    if (state.status !== 'PLAYING') return false;
    if (state.turn !== 'PLAYER') return false;

    const entry = state.playerHand.find((c) => c.uid === action.uid);
    if (!entry || entry.cardId !== action.cardId) return false;

    const card = getCard(entry.cardId);
    if (!card.requiresTarget) return false; // carta sem mira não arma nada
    if (card.canPlay && !card.canPlay({ state, caster: 'PLAYER', targetIndex: undefined })) {
      return false;
    }

    // Sem alvo legal no tabuleiro, armar a mira travaria o jogador num modo
    // do qual só o botão de cancelar sairia.
    const hasAnyTarget = state.board.some((_, index) =>
      isValidTargetFor(state, entry.cardId, index),
    );
    if (!hasAnyTarget) return false;

    set({ pendingAction: action });
    return true;
  },

  clearPendingAction: () => {
    if (get().pendingAction !== null) set({ pendingAction: null });
  },

  pushLog: (text) =>
    set((state) => {
      const log = [...state.terminalLog, { id: state.nextLogId, text }];
      // Buffer circular: descarta as mais antigas em vez de crescer sem fim.
      if (log.length > LOG_LIMIT) log.splice(0, log.length - LOG_LIMIT);
      return { terminalLog: log, nextLogId: state.nextLogId + 1 };
    }),

  dispatchEvent: (event) => {
    eventQueue.push(event);

    // Já há uma drenagem em curso: o evento entra na fila e será processado
    // pelo laço que já está rodando. É isto que impede recursão infinita
    // quando o efeito de uma armadilha publica outro evento.
    if (isDraining) return;

    isDraining = true;
    try {
      while (eventQueue.length > 0) {
        const current = eventQueue.shift()!;

        // Armadilhas reagem ao adversário. Evento sem autor (dano, mudança de
        // regra) não aciona nada — senão a mina reagiria ao próprio estrago.
        const actor = eventActor(current);
        if (!actor) continue;

        const defender: Combatant = actor === 'PLAYER' ? 'MACHINE' : 'PLAYER';

        // Snapshot: armadilhas armadas DURANTE a drenagem não disparam com o
        // evento que já estava em processamento.
        const armed = defender === 'PLAYER' ? get().playerTraps : get().machineTraps;
        if (armed.length === 0) continue;

        for (const trap of armed) {
          // Releitura por iteração: uma armadilha anterior pode ter alterado o
          // tabuleiro, e a condição da próxima deve ver o estado já atualizado.
          const state = get();
          const live = defender === 'PLAYER' ? state.playerTraps : state.machineTraps;

          // Pode ter sido consumida por outra armadilha desta mesma rodada.
          if (!live.some((t) => t.uid === trap.uid)) continue;

          const card = getCard(trap.cardId);
          if (!card.triggerCondition) continue; // TRAP sem gatilho nunca dispara
          if (!card.triggerCondition(current, state)) continue;

          const result = card.effect({
            state,
            caster: defender,
            event: current,
            rng: getChannel('CARDS'),
          });

          // Efeito que devolve null não dispara e não é consumido — a
          // armadilha continua armada esperando uma condição melhor.
          if (!result) continue;

          const remaining = live.filter((t) => t.uid !== trap.uid);

          set({
            ...state,
            ...result.patch,
            ...(defender === 'PLAYER'
              ? { playerTraps: remaining }
              : { machineTraps: remaining }),
            lastRevealedTrap: { uid: trap.uid, cardId: trap.cardId, owner: defender },
          });

          if (result.message) get().pushLog(result.message);

          // Dano passa por takeDamage: clamp em 0, fim de partida e a
          // animação do HUD vivem lá, num lugar só.
          if (result.damage) get().takeDamage(result.damage.target, result.damage.amount);
        }
      }
    } finally {
      isDraining = false;
      eventQueue = [];
    }
  },

  playCard: (uid, targetIndex) => {
    const state = get();

    // --- Guardas -----------------------------------------------------------
    if (state.status !== 'PLAYING') return false;
    if (state.turn !== 'PLAYER') return false;

    const handIndex = state.playerHand.findIndex((c) => c.uid === uid);
    if (handIndex === -1) return false;

    const { cardId } = state.playerHand[handIndex];
    const card = getCard(cardId);
    const caster: Combatant = 'PLAYER';

    /* --- Desvio das armadilhas ---------------------------------------------
       Uma TRAP não resolve nada ao ser jogada: sai da mão e vai virada para a
       mesa. O efeito só roda quando `dispatchEvent` acionar o gatilho.        */
    if (card.type === 'TRAP') {
      if (state.playerTraps.length >= TRAP_LIMIT) return false;

      const hand = [...state.playerHand];
      hand.splice(handIndex, 1);

      set({
        playerHand: hand,
        playerTraps: [...state.playerTraps, { uid, cardId }],
        pendingAction: null,
      });

      get().pushLog(`armadilha :: ${card.name.toLowerCase()} armada`);
      get().dispatchEvent({ type: 'TRAP_ARMED', player: caster, cardId });
      return true;
    }

    // Carta de mira sem alvo legal nunca resolve.
    if (card.requiresTarget) {
      if (targetIndex === undefined) return false;
      if (!isValidTargetFor(state, cardId, targetIndex)) return false;
    }

    if (card.canPlay && !card.canPlay({ state, caster, targetIndex })) return false;

    // --- Efeito ------------------------------------------------------------
    // O efeito é puro: devolve um patch, não mexe no store. Se devolver null,
    // nada é consumido — nem a carta, nem números do RNG já sacados.
    const result = card.effect({ state, caster, targetIndex, rng: getChannel('CARDS') });
    if (!result) return false;

    // --- Aplicação ---------------------------------------------------------
    const hand = [...state.playerHand];
    hand.splice(handIndex, 1); // remove exatamente a carta do uid

    const patched: GameState = {
      ...state,
      ...result.patch,
      playerHand: hand,
      pendingAction: null, // a mira cumpriu seu papel
    };

    // Cartas podem mover/remover peças, então revalidamos a linha vencedora.
    const outcome = findWinner(patched.board);

    if (outcome) {
      set({
        ...patched,
        status: 'ROUND_OVER',
        roundWinner: outcome.winner,
        winningLine: outcome.line,
      });
      get().takeDamage(outcome.winner === 'PLAYER' ? 'MACHINE' : 'PLAYER', ROUND_DAMAGE);
      return true;
    }

    set({
      ...patched,
      ...(result.consumesTurn
        ? { turn: 'MACHINE' as Combatant, turnCount: patched.turnCount + 1 }
        : null),
    });

    if (result.message) get().pushLog(result.message);
    if (result.damage) get().takeDamage(result.damage.target, result.damage.amount);

    get().dispatchEvent({ type: 'CARD_PLAYED', player: caster, cardId });
    return true;
  },
}));

/* -------------------------------------------------------------------------- */
/*                            ADAPTADORES DE MIRA                              */
/* -------------------------------------------------------------------------- */
/* A engine de regras recebe a `CardDefinition` pronta, para não precisar
   importar o catálogo de cartas (o que criaria ciclo de módulo). O store é a
   camada que conhece o registry, então é aqui que o `cardId` vira definição. */

/** A célula é alvo legal para a carta de `cardId`? */
export function isValidTargetFor(state: GameState, cardId: CardId, index: number): boolean {
  return isValidTargetForCard(state, getCard(cardId), index);
}

/** A célula é alvo legal para a carta atualmente em mira? */
export function isPendingTarget(state: GameState, index: number): boolean {
  const pending = state.pendingAction;
  if (!pending) return false;
  return isValidTargetFor(state, pending.cardId, index);
}

/* -------------------------------------------------------------------------- */
/*                                  SELETORES                                  */
/* -------------------------------------------------------------------------- */
/* Use sempre seletores nos componentes para evitar re-render do tabuleiro
   inteiro quando só o HP muda. Ex: const turn = useGameStore(selectTurn);   */

export const selectBoard = (s: GameStore) => s.board;
export const selectTurn = (s: GameStore) => s.turn;
export const selectTurnCount = (s: GameStore) => s.turnCount;
export const selectStatus = (s: GameStore) => s.status;
export const selectActiveRule = (s: GameStore) => s.activeRule;
export const selectPlayerHand = (s: GameStore) => s.playerHand;
export const selectExtraTurnPending = (s: GameStore) => s.extraTurnPending;
export const selectPendingAction = (s: GameStore) => s.pendingAction;
export const selectPlayerTraps = (s: GameStore) => s.playerTraps;
export const selectMachineTraps = (s: GameStore) => s.machineTraps;
export const selectLastRevealedTrap = (s: GameStore) => s.lastRevealedTrap;
export const selectTerminalLog = (s: GameStore) => s.terminalLog;

/** Armadilhas de um combatente. Referência estável enquanto nada muda. */
export const selectTraps = (owner: Combatant) => (s: GameStore) =>
  owner === 'PLAYER' ? s.playerTraps : s.machineTraps;

/** Tabuleiro em modo mira? Booleano — barato de assinar em qualquer lugar. */
export const selectIsTargeting = (s: GameStore) => s.pendingAction !== null;

/** `uid` da carta em mira, ou `null`. Primitivo, seguro para assinar. */
export const selectPendingUid = (s: GameStore) => s.pendingAction?.uid ?? null;

/**
 * A célula é alvo válido da carta em mira?
 *
 * Booleano por célula: cada `<Cell />` assina o seu e só a linha de células
 * elegíveis re-renderiza ao entrar/sair do modo mira.
 */
export const selectIsValidTarget = (index: number) => (s: GameStore) =>
  isPendingTarget(s, index);

/**
 * O jogador pode jogar cartas agora? Gate grosso (turno + fase), avaliado na
 * thread JS e passado como booleano para os worklets de gesto — que não podem
 * ler o store durante o drag.
 */
export const selectCanPlayCards = (s: GameStore) =>
  s.status === 'PLAYING' && s.turn === 'PLAYER';
export const selectPlayerHp = (s: GameStore) => s.playerHp;
export const selectMachineHp = (s: GameStore) => s.machineHp;
export const selectMatchSeed = (s: GameStore) => s.matchSeed;

/** HP de um combatente específico. */
export const selectHp = (target: Combatant) => (s: GameStore) =>
  target === 'PLAYER' ? s.playerHp : s.machineHp;

/** Célula do tabuleiro isolada — ideal para o componente `<Cell />`. */
export const selectCell = (index: number) => (s: GameStore) => s.board[index];

/**
 * Índice da peça condenada do combatente da vez — **puro e determinístico**.
 *
 * Sob `RANDOM_FADE` retorna `null` de propósito: a vítima só é sorteada no
 * instante da jogada, então nenhuma peça isolada pode ser prevista. Para o
 * destaque visual nesse caso, use `selectIsVanishing`.
 */
export const selectVanishingIndex = (s: GameStore) =>
  s.status === 'PLAYING' ? getOldestPieceIndex(s.board, s.turn) : null;

/**
 * A peça em `index` vai sumir na próxima jogada?
 *
 * Retorna booleano (primitivo) — seguro para `useSyncExternalStore`, ao
 * contrário de um array, que mudaria de identidade a cada chamada.
 * Sob `RANDOM_FADE`, TODAS as peças do combatente da vez ficam instáveis,
 * porque qualquer uma pode ser sorteada.
 */
export const selectIsVanishing = (index: number) => (s: GameStore): boolean => {
  if (s.status !== 'PLAYING') return false;

  const piece = s.board[index];
  if (!piece || piece.owner !== s.turn) return false;

  const indexes = getPieceIndexes(s.board, s.turn);
  if (indexes.length < MAX_PIECES_PER_PLAYER) return false;

  return s.activeRule === 'RANDOM_FADE' ? true : indexes[0] === index;
};

/** A célula está interditada pela regra BLOCKED_CELL? */
export const selectIsBlocked = (index: number) => (s: GameStore): boolean =>
  s.activeRule === 'BLOCKED_CELL' && s.blockedCell === index;

/** A célula faz parte da linha vencedora da rodada? */
export const selectIsWinningCell = (index: number) => (s: GameStore): boolean =>
  s.winningLine?.includes(index) ?? false;

export const selectIsPlayerTurn = (s: GameStore) => s.turn === 'PLAYER' && s.status === 'PLAYING';
