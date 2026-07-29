import { create } from 'zustand';

import { drawCardId, getCard } from '@/engine/cards/registry';
import { eventActor } from '@/engine/events';
import { getChannel, getMatchSeed, seedMatch } from '@/engine/rng';
import {
  AUTO_DRAW_INTERVAL_TURNS,
  CHAOS_RULE_DURATION_TURNS,
  CHAOS_SURGE_INTERVAL_ROUNDS,
  CHAOS_SURGE_INTERVAL_TURNS,
  HAND_LIMIT,
  INITIAL_HP,
  LOG_LIMIT,
  MARK_BY_COMBATANT,
  MAX_PIECES_PER_PLAYER,
  OPENING_HAND_SIZE,
  ROUND_DAMAGE,
  TRAP_LIMIT,
  TURNS_PER_GLOBAL_ROUND,
  canPlaceAt,
  createEmptyBoard,
  findWinner,
  getOldestPieceIndex,
  getPieceIndexes,
  getVanishingIndex,
  handKeyFor,
  isAutoDrawTurn,
  isCellLocked,
  isCellUnavailable,
  isChaosRuleExpired,
  isChaosSurgeTurn,
  isLockedCellExpired,
  isValidTargetForCard,
  opponentOf,
  pickFreeCell,
  trapsKeyFor,
  type AcknowledgementKind,
  type AcknowledgementTone,
  type ChaosRule,
  type Combatant,
  type GameState,
  type MatchStatus,
  type Notice,
  type NoticeTone,
  type PendingAcknowledgement,
  type PendingAction,
} from '@/engine/rules';
import type { CardId } from '@/engine/cards/definitions';
import type { GameEvent } from '@/engine/events';

/** Intervalo entre o fim da rodada e a limpeza automática do tabuleiro. */
const ROUND_TRANSITION_DELAY_MS = 1300;

/**
 * Linha de log de cada regra caótica, em PT-BR e descrevendo o EFEITO.
 *
 * O terminal é a única explicação do jogo para o que o caos acabou de fazer;
 * imprimir o identificador interno (`random_fade`) deixava o jogador vendo
 * peças sumirem sem relacionar uma coisa à outra.
 */
const CHAOS_RULE_LOG: Record<ChaosRule, string> = {
  NORMAL: 'SISTEMA ESTÁVEL :: o caos recuou, o tabuleiro voltou ao normal',
  RANDOM_FADE: 'CAOS: Símbolo Aleatório Instável :: qualquer peça sua pode sumir na sua jogada',
  BLOCKED_CELL: 'CAOS: Casa Interditada :: uma célula foi lacrada e não aceita jogadas',
};

/** Toast curto do surto de caos — o log tem a explicação longa. */
const CHAOS_RULE_NOTICE: Record<ChaosRule, string> = {
  NORMAL: 'SISTEMA ESTÁVEL',
  RANDOM_FADE: 'CAOS: SÍMBOLO INSTÁVEL',
  BLOCKED_CELL: 'CAOS: CASA INTERDITADA',
};

/* -------------------------------------------------------------------------- */
/*                              DOMÍNIO (reexport)                             */
/* -------------------------------------------------------------------------- */
/* O modelo de domínio vive em `@/engine/rules`. Reexportamos daqui porque
   praticamente todo componente já importa do store — um import só é mais
   simples de consumir do que dois, e os arquivos existentes seguem valendo.
   A direção da dependência continua sendo `store → engine`, nunca o inverso. */

export {
  AUTO_DRAW_INTERVAL_TURNS,
  CHAOS_RULE_DURATION_TURNS,
  CHAOS_SURGE_INTERVAL_ROUNDS,
  CHAOS_SURGE_INTERVAL_TURNS,
  HAND_LIMIT,
  INITIAL_HP,
  LOG_LIMIT,
  MARK_BY_COMBATANT,
  MAX_PIECES_PER_PLAYER,
  OPENING_HAND_SIZE,
  ROUND_DAMAGE,
  TRAP_LIMIT,
  TURNS_PER_GLOBAL_ROUND,
  canPlaceAt,
  createEmptyBoard,
  findWinner,
  getOldestPieceIndex,
  getPieceIndexes,
  getVanishingIndex,
  isCellUnavailable,
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

export type {
  AcknowledgementKind,
  AcknowledgementTone,
  CardId,
  Combatant,
  GameState,
  Notice,
  NoticeTone,
  PendingAcknowledgement,
  PendingAction,
};

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

  /** Aumenta o HP do alvo. Faz clamp em `INITIAL_HP` — cura não excede o teto. */
  healTarget: (target: Combatant, amount: number) => void;

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
   * Sorteia uma nova `ChaosRule` **caótica** (nunca `NORMAL`) pelo canal
   * `RULES` do RNG e agenda sua expiração `CHAOS_RULE_DURATION_TURNS` turnos
   * globais à frente.
   *
   * Chamada automaticamente por `placeMark` a cada `CHAOS_SURGE_INTERVAL_TURNS`
   * turnos — não mais por um timer de tempo real da WebView, e não mais por
   * um intervalo aleatório. Cadência fixa e determinística: o jogador nunca
   * pode simplesmente esperar uma regra ruim passar sem jogar, e o resultado
   * é sempre previsível (2 turnos de caos, a cada 4 turnos).
   */
  triggerTerminalGlitch: () => void;

  /**
   * Compra `count` cartas para o Player pelo canal `CARDS` do RNG (sorteio
   * ponderado pelo `weight` de cada definição). Respeita `HAND_LIMIT`.
   */
  drawCard: (count?: number) => void;

  /** Espelha `drawCard`, mas para a mão da Máquina. */
  drawMachineCard: (count?: number) => void;

  /**
   * Executa o efeito da carta identificada por `uid` (mão do Player) e a
   * remove da mão.
   *
   * Endereçar por `uid` (e não por `cardId`) é o que permite jogar *aquela*
   * carta específica quando a mão tem duplicatas.
   *
   * @returns `true` se a carta foi jogada — inclusive quando uma TRAP do
   * oponente a anulou (a carta é consumida mesmo sem efeito). `false` em
   * jogada inválida (fora do turno, `uid` ausente da mão, alvo faltando ou
   * ilegal, `canPlay` reprovou) — nesse caso nada muda.
   */
  playCard: (uid: string, targetIndex?: number) => boolean;

  /** Espelha `playCard`, mas resolve a partir da mão da Máquina. Usada pela IA. */
  playMachineCard: (uid: string, targetIndex?: number) => boolean;

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

  /**
   * Publica um aviso efêmero (toast) sobre o tabuleiro.
   *
   * Complementa `pushLog`, não substitui: o log é histórico consultável no
   * terminal, o toast é o alerta que o jogador não pode deixar de ver. Fatos
   * que mudam a mão dele ("a CPU destruiu sua carta MINA") precisam dos dois.
   */
  pushNotice: (text: string, tone?: NoticeTone) => void;

  /**
   * Pausa ou retoma a partida.
   *
   * `true` bloqueia `canPlaceAt` (o tabuleiro para de aceitar toques) e faz
   * o hook da CPU cancelar qualquer "pensamento" em andamento sem iniciar um
   * novo turno — ao retomar, a CPU recomeça a decisão do zero.
   */
  setPaused: (paused: boolean) => void;

  /**
   * Confirma a pausa de confirmação manual em exibição ("Entendi"): aplica
   * o efeito adiado (se houver) e mostra a próxima da fila, se houver.
   *
   * Se aplicar o efeito encerrar a partida (`status === 'MATCH_OVER'`),
   * descarta qualquer confirmação restante na fila — a tela de fim de jogo
   * assume a partir daí, e revelações adicionais não fariam mais sentido.
   *
   * No-op se não houver nada pendente.
   */
  acknowledgePending: () => void;
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
  lockedCell: null,
  lockedCellExpiresAtTurn: null,
  revealDoomedFor: null,
  playerHand: [],
  nextCardUid: 0,
  pendingAction: null,
  playerTraps: [],
  machineTraps: [],
  pendingAcknowledgement: null,
  nextAcknowledgementId: 0,
  machineHand: [],
  machineCardTurn: null,
  // `null`: NORMAL não expira sozinho. O 1º surto vem naturalmente quando
  // `turnCount` alcançar `CHAOS_SURGE_INTERVAL_TURNS` (ver `tickGlobalClock`).
  ruleExpiresAtTurn: null,
  lastDamageEvent: null,
  nextDamageEventId: 0,
  lastExtraTurn: null,
  nextExtraTurnId: 0,
  lastNotice: null,
  nextNoticeId: 0,
  isPaused: false,
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
/*                         TRANSIÇÃO AUTOMÁTICA DE RODADA                      */
/* -------------------------------------------------------------------------- */
/* Mesmo racional do barramento acima: é maquinário de agendamento, não estado
   de jogo. Fica fora do Zustand para não disparar re-render por si só.       */

let roundTransitionTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Cancela uma transição agendada, se houver.
 *
 * Chamado por `startMatch`/`startNextRound`. Não é estritamente necessário
 * para a correção — o próprio callback re-checa `status === 'ROUND_OVER'`
 * antes de agir — mas evita deixar um timer órfão vivo depois de a partida
 * já ter sido reiniciada por outro caminho (menu de pause, tela de fim de
 * jogo).
 */
function clearRoundTransition(): void {
  if (roundTransitionTimer !== null) {
    clearTimeout(roundTransitionTimer);
    roundTransitionTimer = null;
  }
}

/* -------------------------------------------------------------------------- */
/*                       FILA DE CONFIRMAÇÃO MANUAL (acknowledge)             */
/* -------------------------------------------------------------------------- */
/* Mesmo racional das duas seções acima: maquinário de agendamento, fora do
   Zustand. Existe porque certos efeitos (armadilha revelada, carta de
   espionagem) precisam pausar o jogo até o JOGADOR confirmar que leu — não
   um timer de tempo fixo, que não garante leitura nenhuma, só que a tela
   ficou parada por tempo suficiente.                                        */

interface PendingAcknowledgementEntry {
  descriptor: PendingAcknowledgement;
  /** Aplica o patch/dano/mensagem já calculados. Chamado só quando o jogador confirma. */
  apply: () => void;
}

let acknowledgementQueue: PendingAcknowledgementEntry[] = [];

/** Descarta confirmações pendentes sem aplicá-las. Só é seguro ao abandonar a partida inteira. */
function clearAcknowledgementQueue(): void {
  acknowledgementQueue = [];
}

/* -------------------------------------------------------------------------- */
/*                                    STORE                                    */
/* -------------------------------------------------------------------------- */

export const useGameStore = create<GameStore>()((set, get) => {
  /* ------------------------------------------------------------------------ */
  /*                          HELPERS INTERNOS (fechados sobre set/get)       */
  /* ------------------------------------------------------------------------ */
  /* Não fazem parte da API pública da store — não estão no objeto retornado
     nem em `GameActions`. Existem só para `placeMark`/`playCard`/`playMachineCard`
     compartilharem lógica sem duplicá-la entre Player e Máquina.             */

  /**
   * Agenda a limpeza automática do tabuleiro depois de uma rodada.
   *
   * Substitui o antigo `useEffect` na tela que observava `status ===
   * 'ROUND_OVER'` — se a tela fosse simplificada (como aconteceu) e esse
   * efeito desaparecesse, o jogo travava no tabuleiro cheio para sempre. Ao
   * mover o agendamento para dentro da própria action, o avanço de rodada
   * deixa de depender de qualquer componente estar montado.
   */
  function scheduleRoundTransition(): void {
    clearRoundTransition();
    roundTransitionTimer = setTimeout(() => {
      roundTransitionTimer = null;
      // Re-checagem no instante do disparo: se a partida foi reiniciada nesse
      // meio-tempo, o status não é mais ROUND_OVER e isto vira um no-op —
      // sem precisar de um token/epoch adicional para invalidar o timer.
      if (get().status === 'ROUND_OVER') get().startNextRound();
    }, ROUND_TRANSITION_DELAY_MS);
  }

  /**
   * Relógio global: roda a cada jogada de tabuleiro (nunca a cada carta —
   * "jogada global" é lida literalmente como posicionar uma peça).
   *
   * Três responsabilidades independentes que só coincidem em serem
   * disparadas pelo mesmo evento:
   * 1. distribuir 1 carta para cada lado a cada `AUTO_DRAW_INTERVAL_TURNS`;
   * 2. reverter a regra caótica para NORMAL quando `ruleExpiresAtTurn` for
   *    alcançado (dura exatamente `CHAOS_RULE_DURATION_TURNS` turnos);
   * 3. disparar um novo surto a cada `CHAOS_SURGE_INTERVAL_TURNS` turnos.
   *
   * A ordem (reverter ANTES de checar novo surto) importa só no caso raro de
   * as duas janelas coincidirem no mesmo turno — reverter primeiro garante
   * que o novo surto sempre parte de NORMAL, nunca de uma regra "vencida".
   */
  function tickGlobalClock(nextTurnCount: number): void {
    if (isAutoDrawTurn(nextTurnCount)) {
      drawCardsFor('PLAYER', 1);
      drawCardsFor('MACHINE', 1);
    }

    // Trava de célula da carta TRAVAR — expira por conta própria, num campo
    // separado da regra caótica. É o que garante que um surto de caos no meio
    // do caminho não solte a casa antes da hora (e vice-versa).
    if (isLockedCellExpired(get())) {
      set({ lockedCell: null, lockedCellExpiresAtTurn: null });
      get().pushLog('travar :: a casa lacrada foi liberada');
    }

    if (isChaosRuleExpired(get())) {
      get().applyChaosRule('NORMAL');
    }

    // `isChaosSurgeTurn` já embute `turnCount > 0` internamente — o teste
    // fica repetido aqui, explícito, como segunda linha de defesa: nenhum
    // surto pode nascer de `nextTurnCount === 0`, nem que uma futura edição
    // daquela função em `rules.ts` derrube a guarda por engano. Turno 0 é
    // "partida acabou de começar, tabuleiro vazio" — caos ali seria o jogador
    // vendo o terminal "ligar" antes de qualquer peça existir para reagir.
    if (nextTurnCount > 0 && isChaosSurgeTurn(nextTurnCount)) {
      get().triggerTerminalGlitch();
    }
  }

  /**
   * Mantém `pendingAcknowledgement` sincronizado com a frente da fila.
   *
   * Chamado depois de qualquer mudança na fila (`queueAcknowledgement` ao
   * empilhar, `acknowledgePending` ao desempilhar). Empilhar no FIM do
   * array nunca muda quem está na FRENTE a menos que a fila estivesse vazia
   * — é assim que múltiplas confirmações enfileiradas no mesmo instante
   * (ex: dois eventos disparando duas armadilhas) aparecem uma de cada vez,
   * na ordem em que dispararam.
   */
  function syncPendingAcknowledgement(): void {
    const front = acknowledgementQueue[0];
    set({ pendingAcknowledgement: front ? front.descriptor : null });
  }

  /**
   * Enfileira uma pausa de confirmação manual e mostra imediatamente, se
   * nada mais já estiver na tela.
   *
   * `apply` só roda quando o jogador clicar "Entendi" (`acknowledgePending`)
   * — é isso que garante que o efeito mecânico (dano, patch) nunca acontece
   * antes do jogador ter visto o que o causou.
   */
  function queueAcknowledgement(
    descriptor: {
      kind?: AcknowledgementKind;
      tone?: AcknowledgementTone;
      subtitle: string;
      title: string;
      description: string;
      revealedCards?: CardId[];
    },
    apply: () => void,
  ): void {
    const id = get().nextAcknowledgementId;
    set({ nextAcknowledgementId: id + 1 });

    acknowledgementQueue.push({
      descriptor: {
        id,
        kind: descriptor.kind ?? 'INFO',
        tone: descriptor.tone ?? 'DANGER',
        subtitle: descriptor.subtitle,
        title: descriptor.title,
        description: descriptor.description,
        revealedCards: descriptor.revealedCards ?? [],
      },
      apply,
    });

    syncPendingAcknowledgement();
  }

  /** Implementação compartilhada de `drawCard`/`drawMachineCard`. */
  function drawCardsFor(target: Combatant, count: number): void {
    const rng = getChannel('CARDS');
    const key = handKeyFor(target);
    const before = get()[key].length;

    set((state) => {
      const hand = [...state[key]];
      let uid = state.nextCardUid;

      for (let i = 0; i < count && hand.length < HAND_LIMIT; i++) {
        const cardId = drawCardId(rng);
        hand.push({ uid: `${cardId}#${uid++}`, cardId });
      }

      // Identidade nova só se algo entrou — evita re-render à toa da mão.
      return hand.length === state[key].length ? {} : { [key]: hand, nextCardUid: uid };
    });

    if (get()[key].length > before) {
      get().dispatchEvent({ type: 'CARD_DRAWN', player: target });
    }
  }

  /**
   * Dá à(s) TRAP(s) armadas do OPONENTE de `event.player` a chance de vetar
   * uma carta de ação antes do efeito dela rodar.
   *
   * Resolvida de forma SÍNCRONA (ao contrário de `dispatchEvent`, que
   * enfileira e adia): um veto tem que acontecer ANTES do patch da carta ser
   * aplicado, nunca depois — não dá para segurar isso esperando o jogador
   * confirmar, como as armadilhas reativas fazem. O patch do veto (se
   * houver) já é aplicado na hora; a confirmação manual entra na MESMA fila
   * só para efeito informativo, com `apply` vazio (não há mais nada a
   * aplicar depois — o veto já aconteceu).
   *
   * Para na primeira armadilha que casar a condição.
   *
   * @returns `true` se alguma armadilha vetou a jogada.
   */
  function resolveCounterTraps(event: GameEvent): boolean {
    const actor = eventActor(event);
    if (!actor) return false;

    const defender = opponentOf(actor);
    const trapsKey = trapsKeyFor(defender);

    for (const trap of get()[trapsKey]) {
      const state = get();
      const card = getCard(trap.cardId);
      if (!card.triggerCondition?.(event, state)) continue;

      const result = card.effect({
        state,
        caster: defender,
        uid: trap.uid,
        event,
        rng: getChannel('CARDS'),
      });
      if (!result?.cancelsAction) continue;

      const remaining = state[trapsKey].filter((t) => t.uid !== trap.uid);
      set({ ...result.patch, [trapsKey]: remaining });
      if (result.message) get().pushLog(result.message);

      queueAcknowledgement(
        {
          tone: 'DANGER',
          subtitle: defender === 'PLAYER' ? 'SUA ARMADILHA' : 'ARMADILHA DA CPU',
          title: card.name,
          description: card.description,
        },
        () => {}, // efeito já aplicado — isto só pausa para leitura
      );
      return true;
    }

    return false;
  }

  /**
   * Implementação compartilhada de `playCard` (Player) e `playMachineCard`
   * (Máquina/IA) — a única diferença entre as duas é qual mão/traps são lidas.
   */
  function resolveCardPlay(caster: Combatant, uid: string, targetIndex?: number): boolean {
    const state = get();

    // Primeira linha de defesa, de propósito: NENHUMA carta resolve fora de
    // `PLAYING` — nem em `ROUND_OVER` (transição entre rodadas), nem em
    // `MATCH_OVER`, nem em `IDLE`. Revisado e confirmado — este é o único
    // portão que `playCard`/`playMachineCard` atravessam, então mantê-lo
    // como a PRIMEIRA checagem (antes de qualquer leitura de mão/alvo) é o
    // que garante que nenhum caminho abaixo dele rode com a partida encerrada.
    if (state.status !== 'PLAYING') return false;
    if (state.turn !== caster) return false;
    // Mesma janela de `canPlaceAt`: uma confirmação manual pendente segura
    // qualquer ação até o jogador clicar "Entendi".
    if (state.pendingAcknowledgement !== null) return false;

    const handKey = handKeyFor(caster);
    const handIndex = state[handKey].findIndex((c) => c.uid === uid);
    if (handIndex === -1) return false;

    const { cardId } = state[handKey][handIndex];
    const card = getCard(cardId);

    /* --- Desvio das armadilhas ---------------------------------------------
       Uma TRAP não resolve nada ao ser jogada: sai da mão e vai virada para a
       mesa. O efeito só roda quando `dispatchEvent` acionar o gatilho.        */
    if (card.type === 'TRAP') {
      const trapsKey = trapsKeyFor(caster);
      if (state[trapsKey].length >= TRAP_LIMIT) return false;

      const hand = [...state[handKey]];
      hand.splice(handIndex, 1);

      set({
        [handKey]: hand,
        [trapsKey]: [...state[trapsKey], { uid, cardId }],
        pendingAction: null,
        ...(caster === 'MACHINE' ? { machineCardTurn: state.turnCount } : null),
      });

      get().pushLog(
        caster === 'PLAYER'
          ? `armadilha :: você armou ${card.name.toLowerCase()}`
          : 'armadilha :: a cpu armou uma armadilha na mesa',
      );

      /* A jogada da CPU é anunciada, mas o NOME da armadilha não: revelá-lo
         destruiria a única coisa que faz uma armadilha valer o custo. O
         jogador fica sabendo que existe uma ameaça nova na mesa — que é o
         mesmo que ele já vê na zona de armadilhas — e não qual é. */
      if (caster === 'MACHINE') {
        queueAcknowledgement(
          {
            tone: 'CPU',
            subtitle: 'A CPU JOGOU',
            title: 'ARMADILHA',
            description: 'A CPU virou uma carta na mesa. Você não sabe qual é — ainda.',
          },
          () => {},
        );
      }

      get().dispatchEvent({ type: 'TRAP_ARMED', player: caster, cardId });
      return true;
    }

    // Carta de mira sem alvo legal nunca resolve.
    if (card.requiresTarget) {
      if (targetIndex === undefined) return false;
      if (!isValidTargetFor(state, cardId, targetIndex, caster)) return false;
    }

    if (card.canPlay && !card.canPlay({ state, caster, uid, targetIndex })) return false;

    /* --- Janela de contra-ataque --------------------------------------------
       Uma TRAP do oponente (ANTI-MAGIA, PROTEÇÃO) pode vetar aqui. A carta é
       consumida mesmo assim — ela foi jogada, só não fez efeito.             */
    if (resolveCounterTraps({ type: 'CARD_ABOUT_TO_RESOLVE', player: caster, cardId })) {
      const hand = [...state[handKey]];
      hand.splice(handIndex, 1);
      set({
        [handKey]: hand,
        pendingAction: null,
        // A carta da máquina foi gasta, ainda que anulada — sem marcar o
        // turno aqui, a IA voltaria do "Entendi" da armadilha achando que
        // ainda não jogou e queimaria uma segunda carta.
        ...(caster === 'MACHINE' ? { machineCardTurn: state.turnCount } : null),
      });
      return true;
    }

    // --- Efeito ------------------------------------------------------------
    // O efeito é puro: devolve um patch, não mexe no store. Se devolver null,
    // nada é consumido — nem a carta, nem números do RNG já sacados.
    const result = card.effect({ state, caster, uid, targetIndex, rng: getChannel('CARDS') });
    if (!result) return false;

    /* --- Blindagem do relógio global ----------------------------------------
       `turnCount` é o relógio que dispara compra automática, surto de caos e —
       via `placeMark` — o sumiço de peças. Uma carta que o adiantasse faria
       peças evaporarem "do nada" no meio de uma jogada de carta, que era
       exatamente o bug relatado. O contrato passa a ser explícito e verificado
       pelo compilador: NENHUM patch de carta pode tocar em `turnCount`. Quem
       precisa passar a vez usa `consumesTurn`, tratado abaixo num lugar só. */
    const { turnCount: _turnCountIsNotCardBusiness, ...safePatch } = result.patch ?? {};

    // --- Aplicação -----------------------------------------------------------
    // Remoção padrão: exclui a carta jogada da mão do caster. Se o EFEITO já
    // mexeu nessa mesma mão (SAQUE, TROCA — ambos recebem `uid` e excluem a
    // carta jogada sozinhos), `...safePatch` é aplicado DEPOIS e prevalece,
    // então não há dupla remoção nem a carta "voltando" por cima do patch.
    const defaultCasterHand = state[handKey].filter((c) => c.uid !== uid);

    /* Patch ESTREITO, não `{...state, ...}`: reescrever o estado inteiro a
       partir do snapshot lido no topo da função desfaria silenciosamente
       qualquer coisa que tivesse mudado desde então (um contra-ataque, um
       log). Zustand faz merge raso, então listar só o que muda é ao mesmo
       tempo mais barato e mais seguro. */
    const patch: Partial<GameState> = {
      [handKey]: defaultCasterHand,
      ...safePatch,
      pendingAction: null, // a mira (se havia) cumpriu seu papel
      // Marca que a máquina já gastou a carta deste turno. Sem isto ela
      // recomeçaria a decisão do zero depois do "Entendi" do anúncio e
      // jogaria uma segunda carta no mesmo turno.
      ...(caster === 'MACHINE' ? { machineCardTurn: state.turnCount } : null),
    };

    /**
     * Aplica tudo o que a carta produziu. Fica numa closure porque a jogada da
     * CPU só executa DEPOIS do jogador fechar o anúncio — ver logo abaixo.
     */
    const applyResult = (): void => {
      // Cartas podem mover/remover peças, então revalidamos a linha vencedora.
      const outcome = findWinner(safePatch.board ?? state.board);

      if (outcome) {
        set({
          ...patch,
          status: 'ROUND_OVER',
          roundWinner: outcome.winner,
          winningLine: outcome.line,
        });
        get().pushLog(`rodada :: ${outcome.winner === 'PLAYER' ? 'você venceu' : 'a cpu venceu'}`);
        get().takeDamage(outcome.winner === 'PLAYER' ? 'MACHINE' : 'PLAYER', ROUND_DAMAGE);
        if (get().status !== 'MATCH_OVER') scheduleRoundTransition();
        return;
      }

      set({
        ...patch,
        // Único caminho pelo qual uma carta avança o relógio global, e ainda
        // assim só se ela pedir explicitamente.
        ...(result.consumesTurn
          ? { turn: opponentOf(caster), turnCount: get().turnCount + 1 }
          : null),
      });

      if (result.message) get().pushLog(result.message);
      if (result.notice) get().pushNotice(result.notice.text, result.notice.tone);
      if (result.damage) get().takeDamage(result.damage.target, result.damage.amount);
      if (result.heal) get().healTarget(result.heal.target, result.heal.amount);
      if (result.draw) drawCardsFor(result.draw.target, result.draw.count);

      // Cartas de espionagem (ESPIONAGEM, VISÃO ABSOLUTA): a revelação já
      // aconteceu (é o que `card.effect` acabou de calcular), isto só pausa o
      // jogo com um modal até o jogador confirmar que leu. `apply` vazio: não
      // há efeito mecânico para adiar, diferente do caso das armadilhas.
      if (result.acknowledge) {
        queueAcknowledgement(
          {
            kind: result.acknowledge.kind ?? 'INFO',
            tone: result.acknowledge.tone ?? 'INTEL',
            subtitle: result.acknowledge.subtitle,
            title: result.acknowledge.title,
            description: result.acknowledge.description,
            revealedCards: result.acknowledge.revealedCards,
          },
          () => {},
        );
      }

      get().dispatchEvent({ type: 'CARD_PLAYED', player: caster, cardId });
    };

    /* --- Anúncio da jogada da CPU -------------------------------------------
       A máquina jogar uma carta e o efeito aparecer no mesmo frame é a origem
       da sensação de "aconteceu do nada": o jogador vê o HP cair, a mão
       encolher ou a casa travar sem nunca ter visto a causa. Enfileirar o
       anúncio ANTES de aplicar inverte isso — primeiro ele lê "A CPU JOGOU
       SAQUE", confirma, e só então o efeito acontece.

       A carta já saiu da mão da CPU aqui (o `patch` está montado), mas nada
       dele foi escrito ainda: `applyResult` é o `apply` da fila. */
    if (caster === 'MACHINE') {
      queueAcknowledgement(
        {
          tone: 'CPU',
          subtitle: 'A CPU JOGOU',
          title: card.name,
          description: card.description,
        },
        applyResult,
      );
      return true;
    }

    applyResult();
    return true;
  }

  /* ------------------------------------------------------------------------ */
  /*                                   ACTIONS                                */
  /* ------------------------------------------------------------------------ */

  return {
  ...createInitialState(),

  placeMark: (index) => {
    const state = get();

    // --- Guardas (compartilhadas com a UI via canPlaceAt) ------------------
    if (!canPlaceAt(state, index)) return;

    const owner = state.turn;
    const board = [...state.board];
    const nextTurnCount = state.turnCount + 1;

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
        turnCount: nextTurnCount,
        lastVanishedIndex: vanishingIndex,
        status: 'ROUND_OVER',
        roundWinner: result.winner,
        winningLine: result.line,
      });

      // Quem perdeu a rodada leva dano. takeDamage cuida do fim de partida.
      const loser: Combatant = result.winner === 'PLAYER' ? 'MACHINE' : 'PLAYER';
      get().pushLog(`rodada :: ${result.winner === 'PLAYER' ? 'você venceu' : 'cpu venceu'}`);
      get().takeDamage(loser, ROUND_DAMAGE);

      tickGlobalClock(nextTurnCount);

      // Fim de RODADA não é fim de JOGO: se ninguém zerou o HP, a próxima
      // rodada começa sozinha depois de um respiro para ler a linha
      // vencedora. É isto que elimina o soft-lock relatado — antes disto o
      // avanço dependia de um `useEffect` na tela de jogo observando
      // `status === 'ROUND_OVER'`, e essa tela foi simplificada sem ele.
      if (get().status !== 'MATCH_OVER') scheduleRoundTransition();
      return;
    }

    // --- 4. Turno extra (carta EXTRA_TURN) ---------------------------------
    // A flag é consumida aqui: vale por uma jogada só.
    const keepsTurn = state.extraTurnPending === owner;

    // Empate por tabuleiro cheio é impossível aqui: no máximo 3 + 3 = 6 peças
    // ocupam o grid de 9 células. A rodada só termina por vitória.
    set({
      board,
      turnCount: nextTurnCount,
      lastVanishedIndex: vanishingIndex,
      turn: keepsTurn ? owner : opponentOf(owner),
      extraTurnPending: keepsTurn ? null : state.extraTurnPending,
      // A previsão do VIDENTE valia para a próxima jogada DESTE combatente;
      // ele acabou de jogar, então o destaque cumpriu seu papel e sai. Se
      // fosse limpo em qualquer jogada, sumiria já no lance seguinte de quem
      // usou a carta — antes de mostrar o que prometeu.
      ...(state.revealDoomedFor === owner ? { revealDoomedFor: null } : null),
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

    // --- 6. Relógio global: cartas automáticas + expiração de regra --------
    tickGlobalClock(nextTurnCount);
  },

  takeDamage: (target, amount) => {
    if (amount <= 0) return;

    const state = get();
    const key = target === 'PLAYER' ? 'playerHp' : 'machineHp';
    const nextHp = Math.max(0, state[key] - amount);

    if (nextHp === state[key]) return;

    set({
      [key]: nextHp,
      // Efêmero, com `id` monotônico: é o que o `<DamageFlashOverlay />` usa
      // para disparar o flash vermelho a cada chamada, mesmo quando target/
      // amount se repetem (dois hits de 1 de dano seguidos ainda "piscam" duas
      // vezes — sem o id, o segundo set com o mesmo objeto não mudaria nada
      // para quem compara por referência).
      lastDamageEvent: { target, amount, id: state.nextDamageEventId },
      nextDamageEventId: state.nextDamageEventId + 1,
      ...(nextHp === 0
        ? {
            status: 'MATCH_OVER' as MatchStatus,
            matchWinner: (target === 'PLAYER' ? 'MACHINE' : 'PLAYER') as Combatant,
          }
        : null),
    });
  },

  healTarget: (target, amount) => {
    if (amount <= 0) return;

    const state = get();
    const key = target === 'PLAYER' ? 'playerHp' : 'machineHp';
    const nextHp = Math.min(INITIAL_HP, state[key] + amount);

    if (nextHp === state[key]) return;
    set({ [key]: nextHp });
  },

  applyChaosRule: (rule, payload) => {
    const state = get();
    // Descreve o que a regra FAZ, não o nome interno dela: "regra ::
    // random_fade" não explicava nada a quem está jogando, e o efeito (uma
    // peça sumindo) chegava sem aviso reconhecível.
    if (state.activeRule !== rule) get().pushLog(CHAOS_RULE_LOG[rule]);

    set({
      activeRule: rule,
      blockedCell:
        rule === 'BLOCKED_CELL'
          ? // sorteia uma célula livre se nenhuma for informada
            (payload?.cell ?? pickFreeCell(state.board))
          : null,
      // NORMAL não expira sozinho (`null`) — só o próximo surto agendado o
      // interrompe. Regras caóticas duram exatamente `CHAOS_RULE_DURATION_TURNS`
      // turnos, sem sorteio: cadência fixa e previsível, de propósito (ver
      // `tickGlobalClock`).
      ruleExpiresAtTurn: rule === 'NORMAL' ? null : state.turnCount + CHAOS_RULE_DURATION_TURNS,
    });
  },

  startMatch: (seed) => {
    // Semear ANTES de montar o estado: createInitialState lê a seed efetiva.
    const usedSeed = seedMatch(seed);
    resetEventBus(); // eventos da partida anterior não vazam para a nova
    clearRoundTransition();
    clearAcknowledgementQueue(); // confirmação pendente de uma partida abandonada não sobrevive
    /**
     * `{ ...createInitialState() }` é uma substituição TOTAL do estado — e é
     * isso, e não um reset campo-a-campo, que garante que absolutamente
     * NENHUM valor efêmero de uma partida anterior atravesse para a nova:
     * `lastExtraTurn`, `nextExtraTurnId`, `lastDamageEvent`,
     * `nextDamageEventId`, `lastNotice`, `nextNoticeId`, `pendingAcknowledgement`
     * — todos voltam a `null`/`0` aqui porque `createInitialState()` os
     * declara assim, e o spread não deixa nenhum campo "de fora" para
     * sobreviver com o valor antigo. Se um estado efêmero aparecer vazando
     * entre partidas, o bug não está aqui: está no COMPONENTE que o consome
     * guardando cópia própria em `useState`/`useRef` sem reagir ao valor
     * voltando a `null` (foi o caso do `<ExtraTurnBanner />`/`<NoticeToast />`,
     * corrigidos separadamente).
     */
    set({ ...createInitialState(), matchSeed: usedSeed, status: 'PLAYING' });

    // Mão inicial dos dois lados — autocontido aqui para que NENHUMA tela
    // precise lembrar de chamar `drawCard` depois de iniciar a partida.
    drawCardsFor('PLAYER', OPENING_HAND_SIZE);
    drawCardsFor('MACHINE', OPENING_HAND_SIZE);
  },

  startNextRound: () => {
    clearRoundTransition();
    set((state) => ({
      board: createEmptyBoard(),
      // turnCount NÃO reseta: é o relógio global do qual a distribuição
      // automática de cartas e a duração das regras caóticas dependem. Como
      // o tabuleiro é limpo a cada rodada, nenhuma peça "antiga" sobrevive
      // para a ordenação de `turnPlaced` se confundir entre rodadas.
      turn: state.roundWinner === 'PLAYER' ? 'MACHINE' : 'PLAYER',
      status: 'PLAYING',
      roundWinner: null,
      winningLine: null,
      lastVanishedIndex: null,
      extraTurnPending: null, // turno extra não atravessa rodadas
      pendingAction: null, // mira pendente morre com a rodada
      // Nunca há confirmação pendente aqui: `canPlaceAt` bloqueia jogadas
      // enquanto `pendingAcknowledgement !== null`, então uma rodada nunca
      // termina (via placeMark) no meio de uma pausa de confirmação.
      pendingAcknowledgement: null,
      // Armadilhas e mãos NÃO são limpas: continuam de pé até dispararem ou
      // serem jogadas. É o que justifica gastar uma carta numa aposta longa.
      blockedCell: state.activeRule === 'BLOCKED_CELL' ? pickFreeCell(createEmptyBoard()) : null,
      // A trava do TRAVAR, ao contrário da regra caótica, foi comprada para
      // uma situação de tabuleiro específica. Com o tabuleiro limpo ela não
      // significa mais nada, então é devolvida em vez de lacrar uma casa
      // arbitrária da rodada seguinte.
      lockedCell: null,
      lockedCellExpiresAtTurn: null,
      // Mesma ideia: a peça condenada revelada pelo VIDENTE não existe mais.
      revealDoomedFor: null,
    }));
  },

  endTurn: () =>
    set((state) =>
      state.status === 'PLAYING'
        ? { turn: state.turn === 'PLAYER' ? 'MACHINE' : 'PLAYER', turnCount: state.turnCount + 1 }
        : {},
    ),

  triggerTerminalGlitch: () => {
    const { activeRule, applyChaosRule } = get();

    // Sempre uma regra CAÓTICA — nunca NORMAL. O repouso não é mais um
    // resultado possível do surto: ele já volta sozinho quando
    // `CHAOS_RULE_DURATION_TURNS` se esgota (ver `tickGlobalClock`). Antes,
    // o sorteio ponderava fortemente a favor de NORMAL, o que fazia o caos
    // "sumir" com frequência e dava a impressão de que nada acontecia.
    const CHAOTIC_RULES = ['RANDOM_FADE', 'BLOCKED_CELL'] as const;
    const pool = CHAOTIC_RULES.filter((r) => r !== activeRule);
    const resolved = getChannel('RULES').pick<ChaosRule>(pool.length > 0 ? pool : CHAOTIC_RULES);

    applyChaosRule(resolved);
    // Toast além do log: o surto muda as regras do tabuleiro no meio da
    // partida — é o tipo de evento que não pode depender do jogador estar
    // olhando para o terminal na hora certa.
    get().pushNotice(CHAOS_RULE_NOTICE[resolved], 'NEUTRAL');
  },

  drawCard: (count = 1) => drawCardsFor('PLAYER', count),
  drawMachineCard: (count = 1) => drawCardsFor('MACHINE', count),

  setPendingAction: (action) => {
    if (action === null) {
      set({ pendingAction: null });
      return false;
    }

    const state = get();
    // Mesma primeira linha de defesa de `resolveCardPlay`: armar mira fora de
    // `PLAYING` deixaria o tabuleiro num modo mira que nenhuma jogada real
    // resolveria — revisado e confirmado como o portão de entrada correto.
    if (state.status !== 'PLAYING') return false;
    if (state.turn !== 'PLAYER') return false;

    const entry = state.playerHand.find((c) => c.uid === action.uid);
    if (!entry || entry.cardId !== action.cardId) return false;

    const card = getCard(entry.cardId);
    if (!card.requiresTarget) return false; // carta sem mira não arma nada
    if (
      card.canPlay &&
      !card.canPlay({ state, caster: 'PLAYER', uid: action.uid, targetIndex: undefined })
    ) {
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

  pushNotice: (text, tone = 'NEUTRAL') =>
    set((state) => ({
      // `id` monotônico pela mesma razão de `lastDamageEvent`: dois avisos de
      // texto idêntico em sequência ainda precisam disparar duas animações, e
      // quem compara por referência não veria diferença sem ele.
      lastNotice: { id: state.nextNoticeId, text, tone },
      nextNoticeId: state.nextNoticeId + 1,
    })),

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
            uid: trap.uid,
            event: current,
            rng: getChannel('CARDS'),
          });

          // Efeito que devolve null não dispara e não é consumido — a
          // armadilha continua armada esperando uma condição melhor.
          if (!result) continue;

          const remaining = live.filter((t) => t.uid !== trap.uid);
          set({ [trapsKeyFor(defender)]: remaining });

          /* --- Confirmação manual adia o efeito -------------------------
             A carta vira para cima agora (some da mesa), mas o patch/dano/
             mensagem só aplicam quando o JOGADOR confirmar (`acknowledgePending`)
             — nunca depois de um timer fixo, que não garante leitura nenhuma. */
          queueAcknowledgement(
            {
              tone: 'DANGER',
              subtitle: defender === 'PLAYER' ? 'SUA ARMADILHA' : 'ARMADILHA DA CPU',
              title: card.name,
              description: card.description,
            },
            () => {
              // Mesma blindagem de `resolveCardPlay`: uma armadilha também não
              // tem por que mexer no relógio global.
              const { turnCount: _clockIsNotTrapBusiness, ...trapPatch } = result.patch ?? {};
              set({ ...trapPatch });
              if (result.message) get().pushLog(result.message);
              if (result.notice) get().pushNotice(result.notice.text, result.notice.tone);
              // Dano passa por takeDamage: clamp em 0, fim de partida e a
              // animação do HUD vivem lá, num lugar só.
              if (result.damage) get().takeDamage(result.damage.target, result.damage.amount);
            },
          );
        }
      }
    } finally {
      isDraining = false;
      eventQueue = [];
    }
  },

  playCard: (uid, targetIndex) => resolveCardPlay('PLAYER', uid, targetIndex),
  playMachineCard: (uid, targetIndex) => resolveCardPlay('MACHINE', uid, targetIndex),

  setPaused: (paused) => {
    if (get().isPaused !== paused) set({ isPaused: paused });
  },

  acknowledgePending: () => {
    const entry = acknowledgementQueue.shift();
    if (!entry) return;

    entry.apply();

    // A partida acabou como consequência deste efeito (ex: a MINA que
    // acabou de aplicar zerou o HP): descarta o resto da fila — a tela de
    // fim de jogo assume, e mais uma revelação não ajudaria em nada.
    if (get().status === 'MATCH_OVER') {
      acknowledgementQueue = [];
      set({ pendingAcknowledgement: null });
      return;
    }

    syncPendingAcknowledgement();
  },
  };
});

/* -------------------------------------------------------------------------- */
/*                    ANÚNCIO EFÊMERO DE TURNO EXTRA                           */
/* -------------------------------------------------------------------------- */
/* `extraTurnPending` é a flag de CONTROLE (consumida por `placeMark`), não um
   evento — várias cartas/armadilhas diferentes escrevem nela, e ela permanece
   com o mesmo valor entre a concessão e o consumo. Um componente que tentasse
   detectar "acabou de ser concedida" comparando com um valor anterior guardado
   em ref ficaria vulnerável ao double-invoke de efeitos do React em dev: a
   comparação pode ser feita pela invocação do efeito que é DESCARTADA, e a
   invocação que sobrevive já vê "sem mudança" — o timer que esconderia o
   banner nunca é agendado, e ele fica preso na tela piscando para sempre. Foi
   exatamente isso que aconteceu com o `ExtraTurnBanner`.

   Resolver isso AQUI, centralizado, em vez de dentro do componente: o
   `subscribe` do Zustand entrega `(state, prevState)` a cada mudança, e essa
   comparação não é reexecutada por nenhum efeito do React — só dispara uma
   vez por mudança de estado real. Threading a transição por um campo efêmero
   com `id` monotônico (mesmo padrão de `lastDamageEvent`/`lastNotice`) é o
   que permite ao componente reagir de forma robusta, sem guardar nada
   localmente. */
useGameStore.subscribe((state, prevState) => {
  if (state.extraTurnPending === null) return;
  if (state.extraTurnPending === prevState.extraTurnPending) return;

  const id = useGameStore.getState().nextExtraTurnId;
  useGameStore.setState({
    lastExtraTurn: { target: state.extraTurnPending, id },
    nextExtraTurnId: id + 1,
  });
});

/* -------------------------------------------------------------------------- */
/*                            ADAPTADORES DE MIRA                              */
/* -------------------------------------------------------------------------- */
/* A engine de regras recebe a `CardDefinition` pronta, para não precisar
   importar o catálogo de cartas (o que criaria ciclo de módulo). O store é a
   camada que conhece o registry, então é aqui que o `cardId` vira definição. */

/** A célula é alvo legal para a carta de `cardId`? */
export function isValidTargetFor(
  state: GameState,
  cardId: CardId,
  index: number,
  caster: Combatant = 'PLAYER',
): boolean {
  return isValidTargetForCard(state, getCard(cardId), index, caster);
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
/** Pausa de confirmação manual em exibição, ou `null` fora dessa janela. */
export const selectPendingAcknowledgement = (s: GameStore) => s.pendingAcknowledgement;
/** Booleano — barato de assinar só para bloquear interação (guardas de UI). */
export const selectHasPendingAcknowledgement = (s: GameStore) => s.pendingAcknowledgement !== null;
export const selectTerminalLog = (s: GameStore) => s.terminalLog;
export const selectIsPaused = (s: GameStore) => s.isPaused;
export const selectMachineHand = (s: GameStore) => s.machineHand;
export const selectLastDamageEvent = (s: GameStore) => s.lastDamageEvent;
/** Aviso efêmero mais recente — alimenta o toast sobre o tabuleiro. */
export const selectLastNotice = (s: GameStore) => s.lastNotice;
/**
 * Concessão de turno extra mais recente, com `id` monotônico. Alimenta o
 * `<ExtraTurnBanner />` — reagir ao `id` (e não a `extraTurnPending` direto)
 * é o que evita o banner ficar preso piscando; ver o comentário do `subscribe`
 * logo abaixo da store.
 */
export const selectLastExtraTurn = (s: GameStore) => s.lastExtraTurn;

/** Turnos globais restantes até a regra caótica atual expirar. `null` se não houver prazo. */
export const selectRuleTurnsLeft = (s: GameStore) =>
  s.ruleExpiresAtTurn === null ? null : Math.max(0, s.ruleExpiresAtTurn - s.turnCount);

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

/**
 * A carta `uid` (mão do Player) pode ser usada/armada agora?
 *
 * Alimenta o botão "Usar"/"Armar" do modo foco: cobre os mesmos gates de
 * `resolveCardPlay` (turno, fase, pausa, revelação em curso) mais o
 * `canPlay` específico da carta (ex: CURAR com HP já cheio) e, para TRAPs,
 * se ainda há espaço na mesa. Não substitui as guardas do store — é só a
 * UI antecipando se `playCard` vai aceitar, para desabilitar o botão.
 */
export const selectCanUseCard = (uid: string) => (s: GameStore): boolean => {
  if (s.status !== 'PLAYING' || s.turn !== 'PLAYER') return false;
  if (s.isPaused || s.pendingAcknowledgement !== null) return false;

  const entry = s.playerHand.find((c) => c.uid === uid);
  if (!entry) return false;

  const card = getCard(entry.cardId);
  if (card.type === 'TRAP') return s.playerTraps.length < TRAP_LIMIT;

  return !card.canPlay || card.canPlay({ state: s, caster: 'PLAYER', uid, targetIndex: undefined });
};
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

/**
 * A célula está interditada — pelo caos OU pela carta TRAVAR?
 *
 * A `<Cell />` só precisa saber que não dá para jogar ali; qual dos dois
 * subsistemas lacrou é irrelevante para o desenho. Quem quiser distinguir usa
 * `selectIsCardLocked`.
 */
export const selectIsBlocked = (index: number) => (s: GameStore): boolean =>
  isCellUnavailable(s, index);

/**
 * A célula foi lacrada por uma carta TRAVAR (e não pelo caos)?
 *
 * Existe para a UI marcar a trava do jogador com um visual próprio: uma casa
 * que ELE lacrou de propósito não deveria parecer o mesmo azar aleatório que
 * uma casa interditada pelo terminal.
 */
export const selectIsCardLocked = (index: number) => (s: GameStore): boolean =>
  isCellLocked(s, index);

/**
 * A peça em `index` é a que o VIDENTE marcou como condenada?
 *
 * Derivado do tabuleiro vivo (e não de um índice congelado no estado): se um
 * DEMOLIR destruir a peça marcada antes da hora, o destaque acompanha para a
 * próxima da fila em vez de apontar para uma casa vazia.
 */
export const selectIsRevealedDoomed = (index: number) => (s: GameStore): boolean => {
  if (s.revealDoomedFor === null) return false;
  return getOldestPieceIndex(s.board, s.revealDoomedFor) === index;
};

/** A célula faz parte da linha vencedora da rodada? */
export const selectIsWinningCell = (index: number) => (s: GameStore): boolean =>
  s.winningLine?.includes(index) ?? false;

export const selectIsPlayerTurn = (s: GameStore) => s.turn === 'PLAYER' && s.status === 'PLAYING';
