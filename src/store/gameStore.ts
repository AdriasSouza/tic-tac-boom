import { create } from 'zustand';

import { drawCardId, getCard } from '@/engine/cards/registry';
import { eventActor } from '@/engine/events';
import { getChannel, getMatchSeed, seedMatch } from '@/engine/rng';
import {
  AUTO_DRAW_INTERVAL_TURNS,
  CHAOS_RULE_DURATION_TURNS,
  CHAOS_SURGE_INTERVAL_ROUNDS,
  CHAOS_SURGE_INTERVAL_TURNS,
  ENERGY_CAP,
  HAND_LIMIT,
  INITIAL_HP,
  LOG_LIMIT,
  MARK_BY_COMBATANT,
  MAX_PIECES_PER_PLAYER,
  OPENING_HAND_SIZE,
  ROUND_DAMAGE,
  STARTING_ENERGY,
  TRAP_LIMIT,
  TURNS_PER_GLOBAL_ROUND,
  canPlaceAt,
  createEmptyBoard,
  energyKeyFor,
  energyOf,
  findWinner,
  getOldestPieceIndex,
  getPieceIndexes,
  getVanishingIndex,
  handKeyFor,
  handOf,
  isAutoDrawTurn,
  isCellLocked,
  isCellUnavailable,
  isChaosRuleExpired,
  isChaosSurgeTurn,
  isHighlightedOldestValid,
  isLockedCellExpired,
  isValidTargetForCard,
  opponentOf,
  pickFreeCell,
  placementBlockedKeyFor,
  regenEnergy,
  shieldKeyFor,
  trapsKeyFor,
  type AcknowledgementCode,
  type AcknowledgementKind,
  type ChaosRule,
  type Combatant,
  type GameState,
  type MatchStatus,
  type LogPayload,
  type Notice,
  type NoticePayload,
  type NoticeTone,
  type InteractionSelection,
  type PendingAcknowledgement,
  type PendingInteraction,
} from '@/engine/rules';
import type { CardEffectResult, CardId, PendingInteractionRequest } from '@/engine/cards/definitions';
import type { GameEvent } from '@/engine/events';

/** Intervalo entre o fim da rodada e a limpeza automática do tabuleiro. */
const ROUND_TRANSITION_DELAY_MS = 1300;

/**
 * Cronograma do giro de TIC TAC BOOM! (CHAOS_ROULETTE), em ms desde a
 * resolução da carta. Índice = coluna do grid (`index % 3`): 0 esquerda,
 * 1 meio, 2 direita. FONTE ÚNICA — `<Cell />` usa para saber quando travar o
 * próprio glifo, `<ChaosRouletteBanner />` usa para cronometrar "TIC"/"TAC"/
 * "BOOM!", e este arquivo usa o ÚLTIMO valor para saber quando
 * `chaosRouletteSpinning` volta a `false`. Mudar aqui move as três coisas
 * juntas — nunca duplicar estes números em outro arquivo.
 */
export const CHAOS_ROULETTE_COLUMN_STOP_MS: readonly [number, number, number] = [900, 1700, 2500];

/** Intervalo entre trocas de glifo enquanto uma célula ainda gira. */
export const CHAOS_ROULETTE_FLICKER_MS = 90;

/** Fade de entrada/saída do destaque laranja por célula. */
export const CHAOS_ROULETTE_FADE_MS = 120;

/**
 * Quanto "BOOM!" fica na tela após a coluna final travar — cosmético só;
 * NÃO estende `chaosRouletteSpinning`, que já desliga em
 * `CHAOS_ROULETTE_COLUMN_STOP_MS[2]`.
 */
export const CHAOS_ROULETTE_BANNER_HOLD_MS = 500;

/**
 * Tudo que precisa acontecer quando um combatente PASSA a jogar agora: regen
 * de energia (por padrão).
 *
 * `regenEnergyStep` é `true` por padrão e só vira `false` na segunda colocação
 * de TURNO_EXTRA (mesmo `owner` continuando a jogar, ver `placeMark`): a carta
 * concede uma colocação extra, não uma energia extra — sem esta exceção, o
 * regen normal (+1 aos dois lados) rodaria de novo entre as duas colocações, e
 * a carta se pagaria sozinha (`CLAUDE.md`, pendência P11 de `docs/CARTAS.md`).
 *
 * Até a Fase 2 também resolvia a marca da antiga VIDENTE (`doomedCell`) — essa
 * carta virou OBSOLESCÊNCIA e passou a usar `forcedVanish`
 * (`rules.ts`/`getVanishingIndex`, consultado direto em `placeMark`), então
 * `beginTurn` voltou a ser só sobre energia.
 */
function beginTurn(
  state: Pick<GameState, 'playerEnergy' | 'machineEnergy'>,
  regenEnergyStep = true,
): { patch: Partial<GameState> } {
  return {
    patch: regenEnergyStep ? regenEnergy(state.playerEnergy, state.machineEnergy) : {},
  };
}

/* Os textos das regras caóticas viviam aqui e migraram para
   `src/i18n/logMessages.ts`: o store emite `{ code: 'CHAOS_RULE', value: rule }`
   e quem escolhe as palavras é a apresentação. */

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
  ENERGY_CAP,
  HAND_LIMIT,
  INITIAL_HP,
  LOG_LIMIT,
  MARK_BY_COMBATANT,
  MAX_PIECES_PER_PLAYER,
  OPENING_HAND_SIZE,
  ROUND_DAMAGE,
  STARTING_ENERGY,
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
  LogEntry,
  Mark,
  MatchStatus,
  Piece,
} from '@/engine/rules';

export type {
  AcknowledgementCode,
  AcknowledgementKind,
  CardId,
  Combatant,
  GameState,
  InteractionSelection,
  LogPayload,
  Notice,
  NoticePayload,
  NoticeTone,
  PendingAcknowledgement,
  PendingInteraction,
};

export interface GameActions {
  /**
   * Registra uma jogada na célula `index` para `combatant`.
   *
   * `combatant` é OBRIGATÓRIO e precisa bater com `state.turn` — quem chama
   * declara quem está tentando jogar, e a guarda (`canPlaceAt`) recusa se não
   * for a vez dele. Sem isto, qualquer chamador (toque durante a vez do
   * oponente, uma ação de rede fora de ordem) colocaria peça como se fosse o
   * dono da vez — não existia checagem nenhuma disso antes desta função além
   * de a UI se recusar a chamar, o que não é uma garantia do motor.
   *
   * Fluxo:
   * 1. valida (é a vez de `combatant`, partida em andamento, célula livre,
   *    célula não bloqueada);
   * 2. se o jogador já tem 3 peças, remove a mais antiga (ou uma aleatória
   *    sob RANDOM_FADE) — a remoção acontece ANTES de posicionar a nova;
   * 3. posiciona a peça carimbando o `turnCount` atual;
   * 4. checa vitória: se houver, aplica dano e encerra a rodada;
   * 5. caso contrário, incrementa o turno e passa a vez.
   *
   * Devolve `true` se a jogada aconteceu, `false` se foi recusada (mesmo
   * contrato de `playCard`/`playMachineCard`) — jogadas inválidas não mudam
   * NADA no estado.
   */
  placeMark: (combatant: Combatant, index: number) => boolean;

  /** Reduz o HP do alvo. Faz clamp em 0 e encerra a partida se zerar. */
  takeDamage: (target: Combatant, amount: number) => void;

  /**
   * Encerra a partida por desistência/abandono, sem tocar HP.
   *
   * Só faz sentido `status === 'PLAYING'` ou `'ROUND_OVER'` — uma partida já
   * `MATCH_OVER` (HP zerou primeiro) não é sobrescrita por um W.O. tardio que
   * chegue atrasado pela rede. Usada pelo `syncBridge` quando o oponente fica
   * desconectado por tempo demais; nada aqui sabe o que é rede ou presença —
   * só recebe QUEM venceu.
   */
  forfeitMatch: (winner: Combatant) => void;

  /** Aumenta o HP do alvo. Faz clamp em `INITIAL_HP` — cura não excede o teto. */
  healTarget: (target: Combatant, amount: number) => void;

  /** Drena energia do alvo. Faz clamp em 0 — nunca fica negativa. */
  drainEnergy: (target: Combatant, amount: number) => void;

  /** Troca a regra caótica ativa. `payload.cell` só é usado por BLOCKED_CELL. */
  applyChaosRule: (rule: ChaosRule, payload?: { cell?: number }) => void;

  /**
   * Inicia uma partida nova (zera HP, tabuleiro, regra e mão) e (re)semeia o
   * RNG. Passe uma `seed` para reproduzir uma partida específica; omita para
   * sortear uma nova.
   *
   * `isOnline` marca que o combatente `MACHINE` é um humano em outro
   * aparelho, e não a IA — ver a flag homônima em `GameState`. Omitir mantém
   * o comportamento offline de sempre.
   */
  startMatch: (seed?: number, isOnline?: boolean) => void;

  /**
   * Retoma uma partida local/CPU a partir de um snapshot persistido
   * (`src/store/matchPersistence.ts`) — ao contrário de `startMatch`, NÃO
   * resemeia o RNG nem sorteia mão nova (quem chama já rodou `restoreRng`
   * antes). Sanitiza os campos que dependiam de maquinário desta sessão de
   * JS que já não existe mais (timers, fila de confirmação) — ver a
   * implementação para a lista completa.
   */
  resumeMatch: (gameState: GameState) => void;

  /** Limpa o tabuleiro mantendo o HP — usado entre rodadas. */
  startNextRound: () => void;

  /**
   * Passa a vez sem jogar — útil para cartas de "pular turno" (REBOBINAR) e
   * para o jogador escolher não colocar peça.
   *
   * `combatant` precisa bater com `state.turn` — mesma exigência de
   * `placeMark`/`resolveCardPlay` (AGENTS.md: a guarda mora no motor, não na
   * UI que só não oferece o caminho). Devolve `true` se o turno passou,
   * `false` se foi recusado (status, turno, pausa, confirmação ou mira
   * pendente) — mesmo contrato de `placeMark`/`playCard`.
   */
  endTurn: (combatant: Combatant) => boolean;

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
   * Resolve o PASSO ATUAL da interação pendente do combatente cuja vez é
   * agora, com `selection`. `BOARD_TARGET` chama `card.effect` com o
   * `targetIndex` escolhido (mesma chamada que toda carta `requiresTarget`
   * já espera); os outros `kind`s chamam `card.effect` de novo com
   * `context.interaction` preenchido — não existe uma função separada por
   * carta (ver `PendingInteraction`/`CardEffectContext.interaction`,
   * `rules.ts`/`definitions.ts`).
   *
   * Se o resultado tiver `.interaction` de novo, abre o PRÓXIMO passo (mesmo
   * custo já pago, histórico cresce). Se vier um resultado normal, aplica e
   * fecha a interação. Se vier `null`, trata como CANCELAMENTO — reembolsa
   * energia e devolve a carta, exatamente como `cancelInteraction`.
   *
   * @returns `false` se não havia interação pendente deste combatente, ou a
   * escolha não bate com o passo atual (`selection.kind !== pending.kind`).
   */
  resolveInteraction: (combatant: Combatant, selection: InteractionSelection) => boolean;

  /**
   * Cancela a interação pendente do combatante — devolve a carta (no
   * `handIndex` original, não pelo fim) e a energia (`getCard(cardId).cost`),
   * em qualquer passo da cadeia. Nunca há "meio reembolso": o custo pago é
   * sempre o da carta ORIGINAL, não importa quantos passos já resolveram.
   */
  cancelInteraction: (combatant: Combatant) => boolean;

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
  /**
   * Registra um FATO no log de combate.
   *
   * Recebe um evento semântico, nunca uma frase pronta: o motor não conhece
   * idioma nem sabe quem é "você". Ver `src/engine/log.ts`.
   */
  pushLog: (payload: LogPayload) => void;

  /**
   * Publica um aviso efêmero (toast) sobre o tabuleiro.
   *
   * Complementa `pushLog`, não substitui: o log é histórico consultável no
   * terminal, o toast é o alerta que o jogador não pode deixar de ver. Fatos
   * que mudam a mão dele ("a CPU destruiu sua carta MINA") precisam dos dois.
   */
  pushNotice: (payload: NoticePayload) => void;

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
  // Ambos cravados desde já: `turn: 'PLAYER'` abaixo já deixa o PLAYER pronto
  // para agir sem depender de um evento de "início de turno" que não existe
  // no instante zero da partida. O valor do MACHINE é só para o campo nunca
  // ficar `undefined` — o primeiro hook de recarga real dele é o instante em
  // que `turn` passar a valer `'MACHINE'`.
  playerEnergy: STARTING_ENERGY,
  machineEnergy: STARTING_ENERGY,
  playerShield: false,
  machineShield: false,
  activeRule: 'NORMAL',
  blockedCell: null,
  lockedCell: null,
  lockedCellExpiresAtTurn: null,
  forcedVanish: null,
  playerPlacementBlocked: false,
  machinePlacementBlocked: false,
  highlightedOldestFor: null,
  fullIntelRevealFor: null,
  playerHand: [],
  nextCardUid: 0,
  pendingInteraction: null,
  playerTraps: [],
  machineTraps: [],
  playerRevealedUids: [],
  machineRevealedUids: [],
  pendingAcknowledgement: null,
  nextAcknowledgementId: 0,
  machineHand: [],
  // `null`: NORMAL não expira sozinho. O 1º surto vem naturalmente quando
  // `turnCount` alcançar `CHAOS_SURGE_INTERVAL_TURNS` (ver `tickGlobalClock`).
  ruleExpiresAtTurn: null,
  lastDamageEvent: null,
  nextDamageEventId: 0,
  lastExtraTurn: null,
  nextExtraTurnId: 0,
  lastChaosRoulette: null,
  nextChaosRouletteId: 0,
  chaosRouletteSpinning: false,
  lastNotice: null,
  nextNoticeId: 0,
  isPaused: false,
  isOnline: false,
  terminalLog: [],
  nextLogId: 0,
  extraTurnPending: null,
  status: 'IDLE',
  roundWinner: null,
  winningLine: null,
  matchWinner: null,
  matchOverReason: null,
  lastVanishedIndex: null,
  nextVanishedIndexId: 0,
  lastShieldAbsorbed: null,
  nextShieldAbsorbedId: 0,
  lastTimeCapsuleSave: null,
  nextTimeCapsuleSaveId: 0,
  lastEnergyDrain: null,
  nextEnergyDrainId: 0,
  lastParadoxMirror: null,
  nextParadoxMirrorId: 0,
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
/*                    GIRO DE TIC TAC BOOM! (CHAOS_ROULETTE)                  */
/* -------------------------------------------------------------------------- */
/* Mesmo racional da seção acima: maquinário de agendamento, fora do Zustand. */

let chaosRouletteLockTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Cancela o desbloqueio agendado, se houver.
 *
 * Chamado por `startMatch`/`startNextRound` — mesmo racional de
 * `clearRoundTransition`: evita um timer órfão de uma partida/rodada
 * anterior desbloquear (ou, pior, cortar pela metade) o giro de uma NOVA.
 */
function clearChaosRouletteLock(): void {
  if (chaosRouletteLockTimer !== null) {
    clearTimeout(chaosRouletteLockTimer);
    chaosRouletteLockTimer = null;
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
  function scheduleRoundTransition(delayMs: number = ROUND_TRANSITION_DELAY_MS): void {
    clearRoundTransition();
    roundTransitionTimer = setTimeout(() => {
      roundTransitionTimer = null;
      // Re-checagem no instante do disparo: se a partida foi reiniciada nesse
      // meio-tempo, o status não é mais ROUND_OVER e isto vira um no-op —
      // sem precisar de um token/epoch adicional para invalidar o timer.
      if (get().status === 'ROUND_OVER') get().startNextRound();
    }, delayMs);
  }

  /**
   * Agenda o fim da trava de UI do giro de TIC TAC BOOM!, no último stop do
   * cronograma (`CHAOS_ROULETTE_COLUMN_STOP_MS[2]`).
   */
  function scheduleChaosRouletteUnlock(): void {
    clearChaosRouletteLock();
    chaosRouletteLockTimer = setTimeout(() => {
      chaosRouletteLockTimer = null;
      set({ chaosRouletteSpinning: false });
    }, CHAOS_ROULETTE_COLUMN_STOP_MS[2]);
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
      get().pushLog({ code: 'CELL_UNLOCKED' });
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
      code: AcknowledgementCode;
      kind?: AcknowledgementKind;
      subject: Combatant;
      target?: Combatant;
      cardId?: CardId;
      revealedCards?: CardId[];
    },
    apply: () => void,
  ): void {
    const id = get().nextAcknowledgementId;
    set({ nextAcknowledgementId: id + 1 });

    acknowledgementQueue.push({
      descriptor: {
        ...descriptor,
        id,
        kind: descriptor.kind ?? 'INFO',
        revealedCards: descriptor.revealedCards ?? [],
      },
      apply,
    });

    syncPendingAcknowledgement();
  }

  /**
   * Este evento vira uma pausa de anúncio?
   *
   * Offline, só as jogadas da CPU — o jogador não precisa que lhe anunciem a
   * própria carta. Online, TODAS: a fila de confirmação é consumida por uma
   * ação de rede (`ACKNOWLEDGE`) e por isso precisa ser idêntica nos dois
   * aparelhos. Um cliente que pulasse o anúncio da própria jogada receberia o
   * `ACKNOWLEDGE` do outro com a fila vazia, o `apply()` correspondente nunca
   * rodaria, e os dois estados divergiriam em silêncio.
   *
   * A condição é deliberadamente cega à perspectiva: `state.isOnline` vale o
   * mesmo nos dois clientes, `caster === 'MACHINE'` também. Quem sabe se o
   * anúncio diz "VOCÊ JOGOU" ou "O OPONENTE JOGOU" é a apresentação.
   */
  function announcesCardPlay(state: GameState, caster: Combatant): boolean {
    return state.isOnline || caster === 'MACHINE';
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
   * Aplica um `CardEffectResult` FINAL (nunca `.interaction` — quem chama já
   * confirmou que não tem) — recheca `findWinner`, avança o turno se
   * `consumesTurn`, e processa `log`/`notice`/`damage`/`heal`/`draw`/
   * `triggersChaosGlitch`/`acknowledge`.
   *
   * Único caminho para os TRÊS consumidores de `CardEffectResult`
   * (`resolveCardPlay`, `resolveInteraction`, `resolveCounterTraps`) — antes
   * da Fase 3, `resolveCounterTraps` duplicava um SUBCONJUNTO desta lista à
   * mão (sem recheck de `findWinner`, sem `consumesTurn`/
   * `triggersChaosGlitch` — lacuna documentada em `docs/NOTAS_TECNICAS.md`).
   * Unificado agora que um TERCEIRO consumidor ia duplicar de novo.
   *
   * `basePatch` é o que o CHAMADOR já monta (remoção de mão + débito de
   * energia, cada um variando por chamador) — esta função só soma o `patch`
   * do efeito por cima e decide o que fazer com o resultado.
   *
   * **Restrição:** armadilha reativa (`resolveCounterTraps`) NUNCA chama isto
   * com um `result.interaction` presente — um contra-ataque pausando o jogo
   * para uma 3ª decisão, no MEIO da resolução de outra carta, é território
   * novo o bastante para merecer discussão própria, não uma consequência
   * acidental desta unificação. Nenhuma armadilha hoje pede isso.
   */
  function applyCardEffectResult(
    caster: Combatant,
    cardId: CardId,
    result: CardEffectResult,
    basePatch: Partial<GameState>,
  ): void {
    // Mesma blindagem de sempre: nenhum patch de carta toca `turnCount`/
    // energia diretamente — só via `consumesTurn`/`energySpend` (já embutido
    // em `basePatch` por quem chama).
    const {
      turnCount: _turnCountIsNotCardBusiness,
      playerEnergy: _playerEnergyIsNotCardBusiness,
      machineEnergy: _machineEnergyIsNotCardBusiness,
      ...safePatch
    } = result.patch ?? {};

    const patch: Partial<GameState> = { ...basePatch, ...safePatch };

    /**
     * TIC TAC BOOM! (CHAOS_ROULETTE): montado ANTES do `findWinner` abaixo,
     * de propósito — colocado depois do `return` do ramo de vitória (como
     * `triggersChaosGlitch` mais abaixo) o giro NUNCA rodaria quando o
     * embaralhamento também fecha linha na hora, e esse é um caso real e
     * testado ("fechamento duplo ponta a ponta", mais abaixo neste arquivo).
     * `id` monotônico: mesmo padrão de `lastExtraTurn`/`lastDamageEvent`,
     * garante replay mesmo quando o board resultante é idêntico ao de uma
     * jogada anterior.
     */
    let chaosRoulettePatch: Partial<GameState> | null = null;
    if (cardId === 'CHAOS_ROULETTE') {
      const id = get().nextChaosRouletteId;
      chaosRoulettePatch = {
        lastChaosRoulette: { caster, id },
        nextChaosRouletteId: id + 1,
        chaosRouletteSpinning: true,
      };
      scheduleChaosRouletteUnlock();
    }

    // Cartas podem mover/remover peças, então revalidamos a linha vencedora
    // — é exatamente o recheck que faltava em `resolveCounterTraps`.
    const outcome = findWinner(safePatch.board ?? get().board);

    if (outcome) {
      set({
        ...patch,
        ...chaosRoulettePatch,
        status: 'ROUND_OVER',
        roundWinner: outcome.winner,
        winningLine: outcome.line,
      });
      get().pushLog({ code: 'ROUND_WIN', subject: outcome.winner });
      get().takeDamage(outcome.winner === 'PLAYER' ? 'MACHINE' : 'PLAYER', ROUND_DAMAGE);
      if (get().status !== 'MATCH_OVER') {
        // Giro em andamento: a transição de rodada espera o giro (+ hold do
        // banner) terminar — senão `startNextRound` limpa o tabuleiro por
        // baixo de uma animação que ainda não acabou.
        scheduleRoundTransition(
          chaosRoulettePatch
            ? Math.max(ROUND_TRANSITION_DELAY_MS, CHAOS_ROULETTE_COLUMN_STOP_MS[2] + CHAOS_ROULETTE_BANNER_HOLD_MS)
            : undefined,
        );
      }
      return;
    }

    // `{ ...get(), ...basePatch }`: o regen precisa da energia PÓS-custo do
    // caster. Funciona nos dois casos que este helper atende — quando
    // `basePatch` ainda NÃO foi escrito no store (resolução normal, o débito
    // está só no objeto que estamos montando) e quando já FOI escrito antes
    // (passo final de uma interação, o débito aconteceu ao abrir) — nos dois,
    // sobrepor `basePatch` por cima do estado atual dá o valor efetivo certo.
    const nextTurnInfo = result.consumesTurn ? beginTurn({ ...get(), ...basePatch }) : null;

    set({
      ...patch,
      ...chaosRoulettePatch,
      ...(nextTurnInfo
        ? { turn: opponentOf(caster), turnCount: get().turnCount + 1, ...nextTurnInfo.patch }
        : null),
    });

    if (result.log) get().pushLog(result.log);
    if (result.notice) get().pushNotice(result.notice);
    if (result.damage) get().takeDamage(result.damage.target, result.damage.amount);
    if (result.heal) get().healTarget(result.heal.target, result.heal.amount);
    if (result.energyDrain) get().drainEnergy(result.energyDrain.target, result.energyDrain.amount);
    if (result.draw) drawCardsFor(result.draw.target, result.draw.count);
    // TIC TAC BOOM!: mesma roleta do surto automático do relógio global, só
    // que provocada pelo jogador. `triggerTerminalGlitch` não é pura (lê
    // `activeRule`, publica seu próprio log/aviso da REGRA sorteada), por
    // isso a carta só sinaliza a intenção e o store decide chamá-la.
    if (result.triggersChaosGlitch) get().triggerTerminalGlitch();

    // Cartas de espionagem (ESPIONAGEM, VISÃO ABSOLUTA): a revelação já
    // aconteceu (é o que `card.effect` acabou de calcular), isto só pausa o
    // jogo com um modal até o jogador confirmar que leu.
    if (result.acknowledge) {
      queueAcknowledgement(result.acknowledge, () => {});
    }
  }

  /**
   * Monta a `PendingInteraction` completa a partir do que `effect()` PEDIU
   * (`PendingInteractionRequest`, sem os campos que só o store sabe
   * preencher) — e é AQUI que `count` é clampado a
   * `Math.min(pedido, fonte.length)` (regra obrigatória do contrato), nunca
   * confiando no que a carta pediu.
   */
  function openInteraction(
    base: {
      caster: Combatant;
      cardId: CardId;
      cardUid: string;
      handIndex: number;
      priorSelections: InteractionSelection[];
    },
    request: PendingInteractionRequest,
  ): PendingInteraction {
    switch (request.kind) {
      case 'PICK_MANY_FROM_HAND':
        return {
          ...base,
          kind: request.kind,
          source: request.source,
          optionUids: request.optionUids,
          count: Math.min(request.count, request.optionUids.length),
        };
      case 'SACRIFICE_DRAG':
        return {
          ...base,
          kind: request.kind,
          eligibleUids: request.eligibleUids,
          count: Math.min(request.count, request.eligibleUids.length),
        };
      case 'PICK_ONE_FROM_HAND':
        return { ...base, kind: request.kind, source: request.source, optionUids: request.optionUids };
      case 'PICK_ONE_REVEALED':
        return { ...base, kind: request.kind, options: request.options };
      case 'PICK_BOARD_CELL':
        return { ...base, kind: request.kind, eligibleIndexes: request.eligibleIndexes };
    }
  }

  /**
   * Reembolso — usado tanto por `cancelInteraction` (explícito) quanto por um
   * passo inválido (`effect` devolvendo `null` ao resolver, ver
   * `resolveInteraction`). Devolve a carta no `handIndex` ORIGINAL (não pelo
   * fim — não é "entrar na mão" no sentido de `CLAUDE.md` #7, é desfazer) e a
   * energia (`getCard(cardId).cost` — sempre o custo da carta ORIGINAL,
   * nunca importa quantos passos de uma cadeia já resolveram).
   */
  function refundInteraction(pending: PendingInteraction): Partial<GameState> {
    const card = getCard(pending.cardId);
    const handKey = handKeyFor(pending.caster);
    const hand = [...get()[handKey]];
    hand.splice(pending.handIndex, 0, { uid: pending.cardUid, cardId: pending.cardId });

    return {
      [handKey]: hand,
      [energyKeyFor(pending.caster)]: get()[energyKeyFor(pending.caster)] + card.cost,
      pendingInteraction: null,
    };
  }

  /**
   * Termina o passo de interação que acabou de resolver: encadeia (mais um
   * `interaction`), reembolsa (resultado `null`), ou aplica o resultado final
   * via `applyCardEffectResult`. Compartilhado pelos dois ramos de
   * `resolveInteraction` (`BOARD_TARGET` e os outros 4 `kind`s).
   */
  function finishInteractionStep(
    pending: PendingInteraction,
    selection: InteractionSelection,
    result: CardEffectResult | null,
  ): boolean {
    if (!result) {
      set(refundInteraction(pending));
      return true;
    }

    if (result.interaction) {
      set({
        pendingInteraction: openInteraction(
          {
            caster: pending.caster,
            cardId: pending.cardId,
            cardUid: pending.cardUid,
            handIndex: pending.handIndex,
            priorSelections: [...pending.priorSelections, selection],
          },
          result.interaction,
        ),
      });
      return true;
    }

    applyCardEffectResult(pending.caster, pending.cardId, result, {
      pendingInteraction: null,
    });
    get().dispatchEvent({ type: 'CARD_PLAYED', player: pending.caster, cardId: pending.cardId });
    return true;
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
      // `result.interaction` não é tratado de propósito — ver a restrição no
      // JSDoc de `applyCardEffectResult`. Nenhuma armadilha hoje o produz.
      applyCardEffectResult(defender, trap.cardId, result, { [trapsKey]: remaining });

      queueAcknowledgement(
        { code: 'TRAP_TRIGGERED', subject: defender, target: actor, cardId: trap.cardId },
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
    // Lacuna encontrada nesta fase (Fase 3): NADA aqui impedia jogar uma
    // SEGUNDA carta enquanto uma interação da primeira ainda estava pendente
    // — só a UI (`canDrag` desabilitado durante a mira) evitava o caminho.
    // 4ª ocorrência do padrão do AGENTS.md (regra de domínio só respeitada
    // porque a UI não oferece o caminho). A guarda mora aqui agora.
    if (state.pendingInteraction !== null) return false;

    const handKey = handKeyFor(caster);
    const handIndex = state[handKey].findIndex((c) => c.uid === uid);
    if (handIndex === -1) return false;

    const { cardId } = state[handKey][handIndex];
    const card = getCard(cardId);

    // --- Energia --------------------------------------------------------------
    // Mesmo idioma das guardas acima: energia insuficiente aborta em silêncio,
    // sem consumir a carta nem tocar o RNG. Cobre TRAP e ação igualmente —
    // armar uma armadilha custa ⚡ tanto quanto resolver uma ação na hora, e
    // este é o único ponto que os dois caminhos abaixo atravessam. Também
    // cobre ABRIR uma interação (armar a mira de `BOARD_TARGET` incluso) —
    // antes desta fase, `setPendingAction` nunca checava energia nenhuma; só
    // a UI (`canAfford`) evitava armar mira sem crédito. Fica coberto de
    // graça agora que abrir mira passa por este mesmo portão.
    if (state[energyKeyFor(caster)] < card.cost) return false;
    const energySpend: Partial<GameState> = {
      [energyKeyFor(caster)]: state[energyKeyFor(caster)] - card.cost,
    };

    /* --- Desvio das armadilhas ---------------------------------------------
       Uma TRAP não resolve nada ao ser jogada: sai da mão e vai virada para a
       mesa. O efeito só roda quando `dispatchEvent` acionar o gatilho.        */
    if (card.type === 'TRAP') {
      const trapsKey = trapsKeyFor(caster);
      if (state[trapsKey].length >= TRAP_LIMIT) return false;

      const hand = [...state[handKey]];
      hand.splice(handIndex, 1);

      /* --- Janela de contra-ataque, também no ARMAR -------------------------
         ANTIMAGIA cobre "o armar de outra armadilha não-lendária/Boom"
         (`docs/CARTAS.md`) — antes deste ponto só o ramo de AÇÃO passava por
         `resolveCounterTraps`. A carta é consumida mesmo vetada (foi jogada,
         só não chega a ficar virada na mesa) — mesmo idioma do veto no ramo
         de ação, logo abaixo. */
      if (resolveCounterTraps({ type: 'CARD_ABOUT_TO_RESOLVE', player: caster, cardId })) {
        set({
          [handKey]: hand,
          ...energySpend,
        });
        return true;
      }

      set({
        [handKey]: hand,
        [trapsKey]: [...state[trapsKey], { uid, cardId }],
        ...energySpend,
      });

      /* O `cardId` viaja no evento mas a APRESENTAÇÃO esconde de quem não é
         o dono — ver `TRAP_ARMED` em `log.ts`. Guardar o segredo na tradução
         mantém um log único e correto para os dois lados. */
      get().pushLog({ code: 'TRAP_ARMED', subject: caster, value: cardId });

      /* O anúncio sai, mas o NOME da armadilha só é legível para o DONO:
         revelá-lo ao adversário destruiria a única coisa que faz a carta
         valer o custo. Mesma decisão do `TRAP_ARMED` do log — o `cardId`
         viaja no fato e quem o esconde é a tradução, que sabe quem lê. */
      if (announcesCardPlay(state, caster)) {
        queueAcknowledgement({ code: 'TRAP_ARMED', subject: caster, cardId }, () => {});
      }

      get().dispatchEvent({ type: 'TRAP_ARMED', player: caster, cardId });
      return true;
    }

    /* --- BOARD_TARGET: abre a interação em vez de exigir o alvo já pronto ---
       Cartas `requiresTarget` sem `targetIndex` ainda (o caso de sempre —
       jogador tocou a carta, ainda não tocou uma célula) abrem
       `pendingInteraction` aqui, em vez de `setPendingAction` (removida) ou
       de recusar a jogada. `card.effect` NÃO roda ainda — cartas como
       DEMOLIR/TRAVAR/OBSOLESCÊNCIA leem `targetIndex` do contexto e não têm
       como rodar antes de ele existir; o alvo só é resolvido de verdade em
       `resolveInteraction`, exatamente como `resolveCardPlay(uid, targetIndex)`
       já fazia antes desta fase — nenhuma carta muda de comportamento. */
    if (card.requiresTarget && targetIndex === undefined) {
      if (card.canPlay && !card.canPlay({ state, caster, uid, targetIndex: undefined })) return false;

      // Sem alvo legal no tabuleiro, abrir a interação travaria o jogador num
      // modo do qual só cancelar sairia — mesma checagem que `setPendingAction`
      // já fazia (`hasAnyTarget`).
      const hasAnyTarget = state.board.some((_, index) =>
        isValidTargetFor(state, cardId, index, caster),
      );
      if (!hasAnyTarget) return false;

      const openBoardTarget = (): void => {
        const hand = [...state[handKey]];
        hand.splice(handIndex, 1);
        set({
          [handKey]: hand,
          ...energySpend,
          pendingInteraction: { kind: 'BOARD_TARGET', caster, cardId, cardUid: uid, handIndex, priorSelections: [] },
        });
      };

      // Mesmo anúncio que qualquer outra jogada — abrir a mira É jogar a
      // carta (energia/mão já saem daqui, decisão desta fase: ver "Timing de
      // cobrança" no plano). Consistente com o resto do fluxo: em online,
      // TODA jogada se anuncia antes de aplicar, não só a resolução final.
      if (announcesCardPlay(state, caster)) {
        queueAcknowledgement({ code: 'CARD_PLAYED', subject: caster, cardId }, openBoardTarget);
        return true;
      }
      openBoardTarget();
      return true;
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
        ...energySpend,
      });
      return true;
    }

    // --- Efeito ------------------------------------------------------------
    // O efeito é puro: devolve um patch (ou pede uma interação), não mexe no
    // store. Se devolver null, nada é consumido — nem a carta, nem números do
    // RNG já sacados. `targetIndex` aqui só existe para cartas `requiresTarget`
    // que JÁ chegam com o alvo (CPU sempre resolve o próprio alvo antes de
    // chamar `playCard`/`playMachineCard` — nunca abre `BOARD_TARGET`).
    const result = card.effect({ state, caster, uid, targetIndex, rng: getChannel('CARDS') });
    if (!result) return false;

    // --- Aplicação -----------------------------------------------------------
    // Remoção padrão: exclui a carta jogada da mão do caster. Se o EFEITO já
    // mexeu nessa mesma mão (SAQUE, TROCA — ambos recebem `uid` e excluem a
    // carta jogada sozinhos), o patch do efeito é aplicado DEPOIS e prevalece,
    // então não há dupla remoção nem a carta "voltando" por cima do patch.
    const defaultCasterHand = state[handKey].filter((c) => c.uid !== uid);
    const basePatch: Partial<GameState> = {
      [handKey]: defaultCasterHand,
      ...energySpend,
      pendingInteraction: null,
    };

    /**
     * Aplica tudo o que a carta produziu (ou abre a interação que ela pediu).
     * Fica numa closure porque a jogada da CPU só executa DEPOIS do jogador
     * fechar o anúncio — ver logo abaixo.
     */
    const applyResult = (): void => {
      if (result.interaction) {
        // Comita energia+mão AGORA (decisão desta fase: toda interação cobra
        // ao abrir, `BOARD_TARGET` incluso — cancelar sempre devolve os dois).
        const hand = [...state[handKey]];
        hand.splice(handIndex, 1);
        set({
          [handKey]: hand,
          ...energySpend,
          pendingInteraction: openInteraction(
            {
              caster,
              cardId,
              cardUid: uid,
              handIndex,
              /* Achado (patch pós-Fase 7a, bug relatado — CPU travava em loop
                 tentando DESLIZAR): quando `targetIndex` já chega pronto (é
                 SEMPRE o caso pra CPU, que nunca abre `BOARD_TARGET` — resolve
                 o alvo sozinha antes de chamar `playCard`), o 1º "passo" da
                 carta nunca passou por uma interação de verdade — mas ainda
                 assim FOI uma escolha de célula, e o 2º passo de uma carta
                 como DESLIZAR (`ctx.interaction.priorSelections[0]`, ver
                 `SLIDE_PIECE` em `registry.ts`) espera encontrá-la ali. Sem
                 isto, `priorSelections` chegava `[]` sempre, o 2º passo nunca
                 achava a origem, `effect()` devolvia `null` toda vez, a carta
                 era reembolsada, e a CPU tentava de novo — loop infinito
                 (nunca acontecia pra jogada humana, que SEMPRE passa por
                 `finishInteractionStep`, que já monta isto corretamente).
                 `targetIndex === undefined` (cartas `targeting: 'NONE'` tipo
                 MULLIGAN/SABOTAGEM) continua `[]` — nunca houve passo de
                 tabuleiro nenhum pra sintetizar. */
              priorSelections:
                targetIndex !== undefined ? [{ kind: 'BOARD_TARGET', index: targetIndex }] : [],
            },
            result.interaction,
          ),
        });
        return;
      }

      applyCardEffectResult(caster, cardId, result, basePatch);
      get().dispatchEvent({ type: 'CARD_PLAYED', player: caster, cardId });
    };

    /* --- Anúncio da jogada --------------------------------------------------
       A carta ser jogada e o efeito aparecer no mesmo frame é a origem da
       sensação de "aconteceu do nada": o jogador vê o HP cair, a mão encolher
       ou a casa travar sem nunca ter visto a causa. Enfileirar o anúncio ANTES
       de aplicar inverte isso — primeiro ele lê "O OPONENTE JOGOU SAQUE",
       confirma, e só então o efeito acontece (patch normal OU abertura de
       interação — as duas passam pelo mesmo anúncio). */
    if (announcesCardPlay(state, caster)) {
      queueAcknowledgement({ code: 'CARD_PLAYED', subject: caster, cardId }, applyResult);
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

  placeMark: (combatant, index) => {
    const state = get();

    // --- Guardas (compartilhadas com a UI via canPlaceAt) -------------------
    // `combatant` precisa BATER com `state.turn` — sem isto, qualquer chamador
    // (toque durante a vez da CPU, uma ação de rede fora de ordem) colocaria
    // peça como se fosse o dono da vez, não quem de fato chamou.
    if (!canPlaceAt(state, index, combatant)) return false;

    const owner = combatant;
    const board = [...state.board];
    const nextTurnCount = state.turnCount + 1;

    // --- 1. Abre espaço removendo a peça condenada -------------------------
    // `state.forcedVanish` (ANOMALIA/OBSOLESCÊNCIA) só é consultado se for
    // deste `owner` — `getVanishingIndex` já faz essa checagem internamente.
    const vanishingIndex = getVanishingIndex(board, owner, state.activeRule, state.forcedVanish);
    if (vanishingIndex !== null) {
      board[vanishingIndex] = null;
    }
    // Consumida uma vez: só limpa se a marca era DESTE owner e de fato foi
    // usada agora — se ele ainda não tinha 3 peças, a marca continua viva
    // esperando o overflow acontecer num turno futuro.
    const nextForcedVanish =
      state.forcedVanish?.owner === owner && vanishingIndex !== null ? null : state.forcedVanish;
    // Efêmero com `id` monotônico (mesmo padrão de `lastDamageEvent`) — só
    // avança quando uma peça de fato sumiu; sem vanish nesta jogada, o campo
    // não é tocado (o consumidor reage à MUDANÇA de `id`, não à presença).
    // `owner` vem do tabuleiro ORIGINAL (antes do `board[vanishingIndex] =
    // null` acima) — depois disso a peça já não existe mais pra capturar.
    const lastVanishedIndexPatch: Partial<GameState> =
      vanishingIndex !== null
        ? {
            lastVanishedIndex: {
              index: vanishingIndex,
              owner: state.board[vanishingIndex]!.owner,
              id: state.nextVanishedIndexId,
            },
            nextVanishedIndexId: state.nextVanishedIndexId + 1,
          }
        : {};

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
        ...lastVanishedIndexPatch,
        forcedVanish: nextForcedVanish,
        status: 'ROUND_OVER',
        roundWinner: result.winner,
        winningLine: result.line,
        // VIDENTE: a rodada de `owner` termina aqui de qualquer forma (não há
        // "próximo turno" a considerar) — limpa o destaque dele incondicional,
        // mesmo padrão de `forcedVanish` acima.
        highlightedOldestFor:
          state.highlightedOldestFor?.caster === owner ? null : state.highlightedOldestFor,
        // VISÃO ABSOLUTA: mesmo raciocínio de VIDENTE acima — a rodada de
        // `owner` termina aqui, a revelação dele não sobrevive.
        fullIntelRevealFor: state.fullIntelRevealFor === owner ? null : state.fullIntelRevealFor,
      });

      // Quem perdeu a rodada leva dano. takeDamage cuida do fim de partida.
      const loser: Combatant = result.winner === 'PLAYER' ? 'MACHINE' : 'PLAYER';
      get().pushLog({ code: 'ROUND_WIN', subject: result.winner });
      get().takeDamage(loser, ROUND_DAMAGE);

      tickGlobalClock(nextTurnCount);

      // Fim de RODADA não é fim de JOGO: se ninguém zerou o HP, a próxima
      // rodada começa sozinha depois de um respiro para ler a linha
      // vencedora. É isto que elimina o soft-lock relatado — antes disto o
      // avanço dependia de um `useEffect` na tela de jogo observando
      // `status === 'ROUND_OVER'`, e essa tela foi simplificada sem ele.
      if (get().status !== 'MATCH_OVER') scheduleRoundTransition();
      return true;
    }

    // --- 4. Turno extra (carta TURNO_EXTRA/TURNO EXTRA) ---------------------
    // A flag é consumida aqui: vale por uma jogada só.
    const keepsTurn = state.extraTurnPending === owner;
    // Continuação (turno extra) ou alternância normal — nos dois casos é uma
    // jogada NOVA começando. A ENERGIA já não é igual: `keepsTurn` é a segunda
    // colocação da MESMA jogada de TURNO_EXTRA, então pula o regen (P11 de
    // `docs/CARTAS.md` — a carta concede uma colocação extra, não energia
    // extra; regenerar aqui faria ela se pagar sozinha).
    const nextTurnHolder = keepsTurn ? owner : opponentOf(owner);
    const nextTurnInfo = beginTurn(state, !keepsTurn);

    // Empate por tabuleiro cheio é impossível aqui: no máximo 3 + 3 = 6 peças
    // ocupam o grid de 9 células. A rodada só termina por vitória.
    set({
      board,
      turnCount: nextTurnCount,
      ...lastVanishedIndexPatch,
      forcedVanish: nextForcedVanish,
      turn: nextTurnHolder,
      ...nextTurnInfo.patch,
      extraTurnPending: keepsTurn ? null : state.extraTurnPending,
      // VIDENTE: sobrevive à 2ª colocação de TURNO_EXTRA (`keepsTurn` — é o
      // MESMO turno de `owner` ainda) e só limpa quando o turno de fato passa
      // adiante.
      highlightedOldestFor:
        !keepsTurn && state.highlightedOldestFor?.caster === owner
          ? null
          : state.highlightedOldestFor,
      // VISÃO ABSOLUTA: mesma exceção de TURNO_EXTRA que VIDENTE já usa acima.
      fullIntelRevealFor:
        !keepsTurn && state.fullIntelRevealFor === owner ? null : state.fullIntelRevealFor,
    });

    /* Toda jogada de tabuleiro entra no log, de QUALQUER combatente.
       Antes só a CPU registrava a própria jogada (no hook da IA, já formatada
       em texto), então numa partida online — onde a IA está desligada — o
       terminal não registrava jogada nenhuma. Emitir daqui cobre os dois
       lados e os três modos com um caminho só. */
    get().pushLog({ code: 'MOVE_PLACED', subject: owner, value: index });

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
    return true;
  },

  takeDamage: (target, amount) => {
    if (amount <= 0) return;

    const state = get();

    /* --- BATERIA RESERVA -----------------------------------------------------
       Absorve o golpe INTEIRO, qualquer que seja a origem (ATAQUE, MINA, SAQUE
       II refletido, dano de rodada perdida) — checado antes de qualquer outra
       coisa, inclusive antes da CÁPSULA DO TEMPO: um escudo ativo nunca deixa
       o HP se mexer, então a Cápsula nem chega a ter o que interceptar. */
    const shieldKey = shieldKeyFor(target);
    if (state[shieldKey]) {
      set({
        [shieldKey]: false,
        // Efêmero com `id` monotônico — mesmo padrão de `lastDamageEvent`,
        // alimenta o pulso de absorção no `<HpTracker />` (`HUD.tsx`).
        lastShieldAbsorbed: { target, id: state.nextShieldAbsorbedId },
        nextShieldAbsorbedId: state.nextShieldAbsorbedId + 1,
      });
      get().pushLog({ code: 'CARD_SHIELD_ABSORBED', subject: target });
      get().pushNotice({ code: 'CARD_SHIELD_ABSORBED', subject: target, tone: 'NEUTRAL' });
      return;
    }

    const key = target === 'PLAYER' ? 'playerHp' : 'machineHp';
    const nextHp = Math.max(0, state[key] - amount);

    if (nextHp === state[key]) return;

    /* --- CÁPSULA DO TEMPO -----------------------------------------------------
       Intercepta o golpe que zeraria o HP, direto aqui — não existe evento de
       "dano prestes a ser letal" no barramento (`DAMAGE_TAKEN` nunca é
       disparado, de propósito, ver `events.ts`), então é a ÚNICA armadilha do
       jogo cuja regra vive fora do formato "reage a um `GameEvent`". */
    if (nextHp === 0) {
      const trapsKey = trapsKeyFor(target);
      const capsule = state[trapsKey].find((t) => t.cardId === 'TIME_CAPSULE');
      if (capsule) {
        set({
          [key]: 1,
          [trapsKey]: state[trapsKey].filter((t) => t.uid !== capsule.uid),
          lastDamageEvent: { target, amount, id: state.nextDamageEventId },
          nextDamageEventId: state.nextDamageEventId + 1,
          // Efêmero próprio, além do flash de dano acima — alimenta
          // `<TimeCapsuleBanner />` (`app/game/[mode].tsx`).
          lastTimeCapsuleSave: { target, id: state.nextTimeCapsuleSaveId },
          nextTimeCapsuleSaveId: state.nextTimeCapsuleSaveId + 1,
        });
        get().pushLog({ code: 'CARD_TIME_CAPSULE', subject: target });
        get().pushNotice({ code: 'CARD_TIME_CAPSULE', subject: target, tone: 'NEUTRAL' });
        drawCardsFor(target, 2);
        return;
      }
    }

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

  /**
   * Drena energia do alvo, clampada em 0. Mesmo racional de `takeDamage`/
   * `healTarget`: `applyCardEffectResult` retira `playerEnergy`/`machineEnergy`
   * de qualquer `patch` de propósito, então um efeito que precisa mexer na
   * energia do ALVO (APAGÃO, FIO DE ARAME) passa por aqui.
   */
  drainEnergy: (target, amount) => {
    if (amount <= 0) return;
    const state = get();
    const key = energyKeyFor(target);
    const next = Math.max(0, state[key] - amount);
    if (next === state[key]) return;
    set({
      [key]: next,
      // Efêmero com `id` monotônico — alimenta o burst nos `<EnergyPip />`
      // do lado drenado (`HUD.tsx`).
      lastEnergyDrain: { target, amount: state[key] - next, id: state.nextEnergyDrainId },
      nextEnergyDrainId: state.nextEnergyDrainId + 1,
    });
  },

  forfeitMatch: (winner) => {
    if (get().status === 'MATCH_OVER') return; // HP já decidiu — W.O. atrasado não sobrescreve
    // `pendingInteraction` por higiene: `MATCH_OVER` já bloqueia tudo sozinho
    // (nenhum reembolso pendente importa mais), mas não custa deixar limpo.
    set({ status: 'MATCH_OVER', matchWinner: winner, matchOverReason: 'FORFEIT', pendingInteraction: null });
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
    if (state.activeRule !== rule) get().pushLog({ code: 'CHAOS_RULE', value: rule });

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

  startMatch: (seed, isOnline = false) => {
    // Semear ANTES de montar o estado: createInitialState lê a seed efetiva.
    const usedSeed = seedMatch(seed);
    resetEventBus(); // eventos da partida anterior não vazam para a nova
    clearRoundTransition();
    clearChaosRouletteLock();
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
    set({ ...createInitialState(), matchSeed: usedSeed, status: 'PLAYING', isOnline });

    // Mão inicial dos dois lados — autocontido aqui para que NENHUMA tela
    // precise lembrar de chamar `drawCard` depois de iniciar a partida.
    drawCardsFor('PLAYER', OPENING_HAND_SIZE);
    drawCardsFor('MACHINE', OPENING_HAND_SIZE);
  },

  resumeMatch: (gameState) => {
    resetEventBus();
    clearRoundTransition();
    clearChaosRouletteLock();
    clearAcknowledgementQueue();

    set({
      ...gameState,
      /**
       * Travas/avisos que dependiam de um `setTimeout`/fila DESTA sessão de
       * JS — a sessão anterior morreu, e nenhum desses maquinários sobrevive
       * a um remount/relançamento. Rehidratar como se ainda existissem
       * travaria o jogo para sempre, sem nenhum timer sobrando para destravar:
       * - `chaosRouletteSpinning`: só desliga via `scheduleChaosRouletteUnlock`.
       * - `isPaused`: só desliga via o `<PauseModal />` da tela anterior.
       * - `pendingAcknowledgement`: o `apply` de quem a enfileirou (ex.:
       *   `openBoardTarget` de uma carta de mira anunciada) vive só no
       *   `acknowledgementQueue` em memória deste módulo, não em `GameState`.
       */
      chaosRouletteSpinning: false,
      isPaused: false,
      pendingAcknowledgement: null,
      // Eventos "acabou de acontecer" — sem isto, o flash/banner de um evento
      // de vários turnos atrás dispararia de novo no primeiro frame da
      // retomada (cada um é lido por um efeito de componente reagindo ao
      // `id` mudar, não a este valor voltando a existir).
      lastDamageEvent: null,
      lastExtraTurn: null,
      lastChaosRoulette: null,
      lastNotice: null,
      lastVanishedIndex: null,
      lastShieldAbsorbed: null,
      lastTimeCapsuleSave: null,
      lastEnergyDrain: null,
      lastParadoxMirror: null,
    });

    // Uma interação a meio caminho (mira, escolha, sacrifício) também
    // dependia da sessão anterior para terminar — reembolsa como um
    // cancelamento explícito em vez de tentar resumir uma carta em limbo.
    const pending = get().pendingInteraction;
    if (pending) set(refundInteraction(pending));

    // ROUND_OVER tinha uma transição de rodada agendada via `setTimeout`,
    // morta com a sessão anterior — sem isto o tabuleiro da rodada que já
    // acabou ficaria na tela para sempre.
    if (get().status === 'ROUND_OVER') scheduleRoundTransition();
  },

  startNextRound: () => {
    clearRoundTransition();
    clearChaosRouletteLock();
    set((state) => {
      // Quem perdeu a rodada joga primeiro na próxima — e "jogar primeiro"
      // é início de turno como qualquer outro para fins de ⚡.
      const nextTurn: Combatant = state.roundWinner === 'PLAYER' ? 'MACHINE' : 'PLAYER';

      return {
        board: createEmptyBoard(),
        // turnCount NÃO reseta: é o relógio global do qual a distribuição
        // automática de cartas e a duração das regras caóticas dependem. Como
        // o tabuleiro é limpo a cada rodada, nenhuma peça "antiga" sobrevive
        // para a ordenação de `turnPlaced` se confundir entre rodadas.
        turn: nextTurn,
        // Regen simétrico, igual a qualquer outro fim de turno — decisão
        // explícita desta entrega (ver "Energia" em docs/CARTAS.md): quem
        // perde a rodada NÃO volta a 3⚡ cravado, carrega o que sobrou +1/teto.
        ...regenEnergy(state.playerEnergy, state.machineEnergy),
        status: 'PLAYING',
        roundWinner: null,
        winningLine: null,
        lastVanishedIndex: null,
        extraTurnPending: null, // turno extra não atravessa rodadas
        // Interação pendente morre com a rodada — mesma flag de turno que
        // `extraTurnPending`. Nunca deveria estar setada aqui de qualquer
        // forma (`canPlaceAt` bloqueia `placeMark` enquanto ela existir, ver
        // comentário de `pendingAcknowledgement` abaixo), mas o reset é
        // higiene defensiva, não reversão de algo que aconteceu de verdade.
        pendingInteraction: null,
        // Nunca há confirmação pendente aqui: `canPlaceAt` bloqueia jogadas
        // enquanto `pendingAcknowledgement !== null`, então uma rodada nunca
        // termina (via placeMark) no meio de uma pausa de confirmação.
        pendingAcknowledgement: null,
        // Armadilhas e mãos NÃO são limpas: continuam de pé até dispararem ou
        // serem jogadas. É o que justifica gastar uma carta numa aposta longa.
        // Pelo mesmo motivo `playerRevealedUids`/`machineRevealedUids` (abaixo,
        // fora deste patch — nada os toca aqui de propósito) também atravessam:
        // é informação sobre uma carta que ainda está na mão, e a mão persiste.
        // Ver auditoria completa em `docs/NOTAS_TECNICAS.md`.
        blockedCell: state.activeRule === 'BLOCKED_CELL' ? pickFreeCell(createEmptyBoard()) : null,
        // A trava do TRAVAR, ao contrário da regra caótica, foi comprada para
        // uma situação de tabuleiro específica. Com o tabuleiro limpo ela não
        // significa mais nada, então é devolvida em vez de lacrar uma casa
        // arbitrária da rodada seguinte.
        lockedCell: null,
        lockedCellExpiresAtTurn: null,
        // Tabuleiro novo e vazio: uma marca de ANOMALIA/OBSOLESCÊNCIA
        // (`forcedVanish`) apontando pra uma peça ou fila da rodada anterior
        // não significa mais nada — as peças de lá nem existem no tabuleiro
        // novo. Mesmo cuidado que o antigo `doomedCell` já tomava aqui.
        forcedVanish: null,
        // REBOBINAR: um bloqueio pertence ao turno da rodada que acabou de
        // fechar — sem isto, um REBOBINAR jogado pouco antes do PRÓPRIO
        // caster fechar linha (a rodada termina antes do turno bloqueado do
        // oponente sequer chegar) vazaria o bloqueio pra rodada seguinte.
        // Mesma classe de bug que `forcedVanish` teve (ver auditoria em
        // docs/NOTAS_TECNICAS.md).
        playerPlacementBlocked: false,
        machinePlacementBlocked: false,
        // VIDENTE: referencia um índice do tabuleiro da rodada anterior —
        // sem sentido no tabuleiro novo, mesma classe de `forcedVanish` acima.
        highlightedOldestFor: null,
        // VISÃO ABSOLUTA: pertence ao turno da rodada que acabou de fechar —
        // mesma classe de limpeza incondicional que os campos acima.
        fullIntelRevealFor: null,
        // Higiene defensiva: por construção o giro (se houver) já terminou
        // antes desta transição rodar (`scheduleRoundTransition` espera pelo
        // menos `CHAOS_ROULETTE_COLUMN_STOP_MS[2] + CHAOS_ROULETTE_BANNER_HOLD_MS`
        // quando `chaosRoulettePatch` está presente), mas nada aqui depende
        // dessa garantia se sobreviver — mesma classe de reset que os campos
        // acima.
        chaosRouletteSpinning: false,
      };
    });
  },

  endTurn: (combatant) => {
    const state = get();
    // Mesma linguagem de `canPlaceAt`/`resolveCardPlay`: quem chama declara
    // quem está passando a vez, e a guarda recusa se não bater com a vez real.
    if (state.status !== 'PLAYING') return false;
    if (state.turn !== combatant) return false;
    if (state.isPaused) return false;
    if (state.pendingAcknowledgement !== null) return false;
    if (state.pendingInteraction !== null) return false;

    const nextTurnCount = state.turnCount + 1;
    const nextTurn = opponentOf(combatant);
    const { patch } = beginTurn(state);

    set({
      turn: nextTurn,
      turnCount: nextTurnCount,
      ...patch,
      // Terminar o PRÓPRIO turno sempre consome o PRÓPRIO bloqueio de
      // REBOBINAR — sem ambiguidade de "para quem" (diferente de
      // `forcedVanish`): só quem está passando a vez pode estar bloqueado
      // agora, e passar a vez é exatamente o que o bloqueio permitia fazer.
      [placementBlockedKeyFor(combatant)]: false,
      // Mesmo consumo que `placeMark` já faz para a 2ª colocação de
      // TURNO_EXTRA: se o combatente tinha a concessão e escolheu passar em
      // vez de usá-la, ela não pode sobrar para reativar `keepsTurn` numa
      // jogada futura dele.
      extraTurnPending: state.extraTurnPending === combatant ? null : state.extraTurnPending,
      // VIDENTE: o destaque de `combatant` só existe enquanto o turno DELE
      // não terminou — passar a vez é exatamente isso terminando.
      highlightedOldestFor:
        state.highlightedOldestFor?.caster === combatant ? null : state.highlightedOldestFor,
      // VISÃO ABSOLUTA: mesmo raciocínio de VIDENTE acima.
      fullIntelRevealFor: state.fullIntelRevealFor === combatant ? null : state.fullIntelRevealFor,
    });

    get().pushLog({ code: 'TURN_PASSED', subject: combatant });

    // `placeMark` sempre chama isto (compra automática, expiração/surto de
    // caos) — `endTurn` nunca tinha um caller real para expor que não
    // chamava. Sem isto, qualquer turno que termina por "passar" em vez de
    // "colocar" pararia o relógio global nesse instante.
    tickGlobalClock(nextTurnCount);

    return true;
  },

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
    get().pushNotice({ code: 'CHAOS_RULE', value: resolved, tone: 'NEUTRAL' });
  },

  drawCard: (count = 1) => drawCardsFor('PLAYER', count),
  drawMachineCard: (count = 1) => drawCardsFor('MACHINE', count),

  resolveInteraction: (combatant, selection) => {
    const state = get();
    if (state.status !== 'PLAYING') return false;
    if (state.turn !== combatant) return false;
    if (state.pendingAcknowledgement !== null) return false;

    const pending = state.pendingInteraction;
    if (!pending || pending.caster !== combatant) return false;
    if (pending.kind !== selection.kind) return false;

    const card = getCard(pending.cardId);

    if (pending.kind === 'BOARD_TARGET') {
      if (selection.kind !== 'BOARD_TARGET') return false; // estreita o tipo pro TS
      if (!isValidTargetFor(state, pending.cardId, selection.index, combatant)) return false;
      if (
        card.canPlay &&
        !card.canPlay({ state, caster: combatant, uid: pending.cardUid, targetIndex: selection.index })
      ) {
        return false;
      }

      /* --- Janela de contra-ataque -----------------------------------------
         Mesmo ponto de sempre: depois do alvo validado, antes de `effect`
         rodar. Nenhuma carta muda de comportamento — é o mesmo lugar onde
         `resolveCardPlay` já chamava isto antes desta fase, só que agora
         numa função própria porque abrir e resolver deixaram de ser a
         MESMA chamada. */
      if (resolveCounterTraps({ type: 'CARD_ABOUT_TO_RESOLVE', player: combatant, cardId: pending.cardId })) {
        set({ pendingInteraction: null });
        return true;
      }

      const result = card.effect({
        state,
        caster: combatant,
        uid: pending.cardUid,
        targetIndex: selection.index,
        rng: getChannel('CARDS'),
      });
      return finishInteractionStep(pending, selection, result);
    }

    // Os outros 5 `kind`s: `effect` é a própria continuação — chamado de novo
    // com o histórico de escolhas (ver `CardEffectContext.interaction`).
    const result = card.effect({
      state,
      caster: combatant,
      uid: pending.cardUid,
      rng: getChannel('CARDS'),
      interaction: { selection, priorSelections: pending.priorSelections },
    });
    return finishInteractionStep(pending, selection, result);
  },

  cancelInteraction: (combatant) => {
    const state = get();
    if (state.status !== 'PLAYING') return false;
    if (state.turn !== combatant) return false;

    const pending = state.pendingInteraction;
    if (!pending || pending.caster !== combatant) return false;

    set(refundInteraction(pending));
    return true;
  },

  pushLog: (payload) =>
    set((state) => {
      const log = [...state.terminalLog, { ...payload, id: state.nextLogId }];
      // Buffer circular: descarta as mais antigas em vez de crescer sem fim.
      if (log.length > LOG_LIMIT) log.splice(0, log.length - LOG_LIMIT);
      return { terminalLog: log, nextLogId: state.nextLogId + 1 };
    }),

  pushNotice: ({ tone = 'NEUTRAL', ...payload }) =>
    set((state) => ({
      // `id` monotônico pela mesma razão de `lastDamageEvent`: dois avisos
      // idênticos em sequência ainda precisam disparar duas animações, e quem
      // compara por referência não veria diferença sem ele.
      lastNotice: { ...payload, id: state.nextNoticeId, tone },
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

        // FIFO exclusivo (Fase 5, mesma regra de `resolveCounterTraps`): a
        // mais antiga que casar a condição dispara SOZINHA para este evento —
        // o `break` abaixo garante isso. Antes da Fase 5 este loop nunca
        // parava (deixava qualquer trap cujo `triggerCondition` também
        // batesse disparar também), inofensivo só porque MINA é a única trap
        // reativa a `PIECE_PLACED` hoje — "Regra de Ouro 1" (armadilha mais
        // antiga primeiro) vale IGUAL aqui, não só para o veto síncrono de
        // `resolveCounterTraps` (ver `docs/CARTAS.md`).
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
            { code: 'TRAP_TRIGGERED', subject: defender, target: actor, cardId: trap.cardId },
            // Mesmo pipeline COMPLETO que `resolveCounterTraps`/`resolveCardPlay`
            // já usam (`applyCardEffectResult`) — antes desta unificação (via
            // reativa de PARADOXO/FIO DE ARAME) esta via só entendia um
            // subconjunto manual (`patch`/`log`/`notice`/`damage`), incapaz de
            // `heal`/`draw`/`energyDrain`/`acknowledge` que uma armadilha
            // copiada pelo PARADOXO pode devolver. A remoção do array de
            // armadilhas já aconteceu (linha acima) — `basePatch` vazio.
            () => {
              applyCardEffectResult(defender, trap.cardId, result, {});
              // Efêmero próprio, além do que a cópia em si já aplicou —
              // alimenta `<ParadoxEchoOverlay />` (`app/game/[mode].tsx`).
              // Só PARADOXO gera este eco; as outras traps reativas (MINA,
              // FIO DE ARAME) não tocam este campo.
              if (trap.cardId === 'PARADOX') {
                const fresh = get();
                set({
                  lastParadoxMirror: { subject: defender, id: fresh.nextParadoxMirrorId },
                  nextParadoxMirrorId: fresh.nextParadoxMirrorId + 1,
                });
              }
            },
          );

          break; // exclusivo — nenhuma outra trap do MESMO defensor avalia este evento
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

/**
 * A célula é alvo legal para a mira ATUAL do tabuleiro? Cobre os 2 `kind`s
 * que miram célula: `BOARD_TARGET` (1º passo de qualquer carta
 * `requiresTarget`, valida via `isValidTargetFor`) e `PICK_BOARD_CELL` (2º
 * passo de DESLIZAR — a lista de elegíveis já vem pronta do 1º passo,
 * `eligibleIndexes`, sem precisar recalcular a regra de adjacência aqui).
 */
export function isPendingTarget(state: GameState, index: number): boolean {
  const pending = state.pendingInteraction;
  if (!pending) return false;

  if (pending.kind === 'PICK_BOARD_CELL') {
    return pending.eligibleIndexes.includes(index);
  }
  if (pending.kind !== 'BOARD_TARGET') return false;

  // O caster é quem tem a vez — mesma razão de `resolveInteraction`. Cartas
  // cujo alvo válido depende de quem joga (DEMOLIR, TRAVAR) destacariam as
  // células erradas no tabuleiro do convidado se isto assumisse `'PLAYER'`.
  return isValidTargetFor(state, pending.cardId, index, state.turn);
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

/**
 * Mão de um combatente específico.
 *
 * Referência estável enquanto aquela mão não muda — é o que permite a
 * `<CardHand />` assinar a mão do combatente LOCAL (que no online pode ser o
 * `MACHINE`) sem re-renderizar quando a do oponente muda.
 */
export const selectHandOf = (combatant: Combatant) => (s: GameStore) =>
  combatant === 'PLAYER' ? s.playerHand : s.machineHand;
export const selectExtraTurnPending = (s: GameStore) => s.extraTurnPending;
export const selectPendingInteraction = (s: GameStore) => s.pendingInteraction;
export const selectPlayerTraps = (s: GameStore) => s.playerTraps;
export const selectMachineTraps = (s: GameStore) => s.machineTraps;
/** Pausa de confirmação manual em exibição, ou `null` fora dessa janela. */
export const selectPendingAcknowledgement = (s: GameStore) => s.pendingAcknowledgement;
/** Booleano — barato de assinar só para bloquear interação (guardas de UI). */
export const selectHasPendingAcknowledgement = (s: GameStore) => s.pendingAcknowledgement !== null;
export const selectTerminalLog = (s: GameStore) => s.terminalLog;
export const selectIsPaused = (s: GameStore) => s.isPaused;
/**
 * O destaque de VIDENTE, já filtrado por validade — devolve `null` se a peça
 * saiu do índice original (auto-invalidação, ver `isHighlightedOldestValid`),
 * então quem consome (`<Cell />`) não precisa repetir a checagem.
 */
export const selectHighlightedOldest = (s: GameStore) =>
  s.highlightedOldestFor && isHighlightedOldestValid(s) ? s.highlightedOldestFor : null;
/**
 * A marca de AMALDIÇOAR/ANOMALIA (`forcedVanish`), sem filtro de validade —
 * ao contrário de `selectHighlightedOldest`, `<Cell />` não precisa saber
 * qual peça É a marcada (o ponto é justamente NÃO revelar isso ao dono),
 * só QUE alguma peça sua está marcada, para acender o flicker ambíguo.
 */
export const selectForcedVanish = (s: GameStore) => s.forcedVanish;
/** Quem tem VISÃO ABSOLUTA ativa agora (vendo a mão inteira do oponente), ou `null`. */
export const selectFullIntelRevealFor = (s: GameStore) => s.fullIntelRevealFor;
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

/** Giro de TIC TAC BOOM! mais recente, com `id` monotônico. Alimenta o
 * cronograma de `<Cell />` e `<ChaosRouletteBanner />`. */
export const selectLastChaosRoulette = (s: GameStore) => s.lastChaosRoulette;

/**
 * Última peça a sumir (overflow natural, DEMOLIR ou ANOMALIA/RANDOM_FADE),
 * com `id` monotônico. Alimenta a animação de saída em `<Cell />` — a célula
 * do `index` compara contra o próprio, o resto ignora.
 */
export const selectLastVanishedIndex = (s: GameStore) => s.lastVanishedIndex;

/** Absorção de dano de BATERIA RESERVA mais recente, com `id` monotônico. */
export const selectLastShieldAbsorbed = (s: GameStore) => s.lastShieldAbsorbed;

/** Disparo de CÁPSULA DO TEMPO mais recente, com `id` monotônico. Alimenta `<TimeCapsuleBanner />`. */
export const selectLastTimeCapsuleSave = (s: GameStore) => s.lastTimeCapsuleSave;

/** Dreno de energia (FIO DE ARAME/APAGÃO) mais recente, com `id` monotônico. */
export const selectLastEnergyDrain = (s: GameStore) => s.lastEnergyDrain;

/** Cópia de PARADOXO mais recente, com `id` monotônico. Alimenta `<ParadoxEchoOverlay />`. */
export const selectLastParadoxMirror = (s: GameStore) => s.lastParadoxMirror;

/** O giro ainda está em cascata? Trava `<Cell />`/`<CardHand />` enquanto a
 * apresentação não termina (ver comentário de `chaosRouletteSpinning` no
 * `GameState`). */
export const selectIsChaosRouletteSpinning = (s: GameStore) => s.chaosRouletteSpinning;

/** Turnos globais restantes até a regra caótica atual expirar. `null` se não houver prazo. */
export const selectRuleTurnsLeft = (s: GameStore) =>
  s.ruleExpiresAtTurn === null ? null : Math.max(0, s.ruleExpiresAtTurn - s.turnCount);

/** Armadilhas de um combatente. Referência estável enquanto nada muda. */
export const selectTraps = (owner: Combatant) => (s: GameStore) =>
  owner === 'PLAYER' ? s.playerTraps : s.machineTraps;

/**
 * `uid`s da mão de `owner` já revelados a quem a espiou. Ver o comentário de
 * `playerRevealedUids` em `rules.ts` — o mesmo array serve tanto para "o que
 * eu sei da mão dele" (lado do oponente) quanto para "o que ele já sabe de
 * mim" (lado do próprio dono), lido pelo `<HandTracker />` dos dois lados.
 */
export const selectRevealedUids = (owner: Combatant) => (s: GameStore) =>
  owner === 'PLAYER' ? s.playerRevealedUids : s.machineRevealedUids;

/**
 * Existe QUALQUER interação pendente? Booleano — barato de assinar em
 * qualquer lugar. Substitui o antigo `selectIsTargeting`: bloqueia mão/
 * tabuleiro pra qualquer `kind`, não só `BOARD_TARGET` (mira).
 */
export const selectIsInteracting = (s: GameStore) => s.pendingInteraction !== null;

/** Tabuleiro especificamente em modo mira (`BOARD_TARGET` ou `PICK_BOARD_CELL`
 * — DESLIZAR passo 2, mesma UI de mira, célula em vez de carta na mão)? */
export const selectIsTargeting = (s: GameStore) =>
  s.pendingInteraction?.kind === 'BOARD_TARGET' || s.pendingInteraction?.kind === 'PICK_BOARD_CELL';

/** `uid` da carta em mira, ou `null`. Primitivo, seguro para assinar. */
export const selectPendingUid = (s: GameStore) =>
  s.pendingInteraction?.kind === 'BOARD_TARGET' ? s.pendingInteraction.cardUid : null;

/**
 * A célula é alvo válido da carta atualmente em mira (`BOARD_TARGET`)?
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
 * A carta `uid` (mão de quem tem a vez) pode ser usada/armada agora?
 *
 * Alimenta o botão "Usar"/"Armar" do modo foco: cobre os mesmos gates de
 * `resolveCardPlay` (turno, fase, pausa, revelação em curso) mais o
 * `canPlay` específico da carta (ex: CURAR com HP já cheio) e, para TRAPs,
 * se ainda há espaço na mesa. Não substitui as guardas do store — é só a
 * UI antecipando se `playCard` vai aceitar, para desabilitar o botão.
 *
 * Assim como `resolveInteraction`, o caster é `s.turn` e não `'PLAYER'`: quem
 * controla o `MACHINE` teria todas as cartas permanentemente desabilitadas no
 * modo foco.
 */
export const selectCanUseCard = (uid: string) => (s: GameStore): boolean => {
  if (s.status !== 'PLAYING') return false;
  if (s.isPaused || s.pendingAcknowledgement !== null) return false;

  const caster = s.turn;
  const entry = handOf(s, caster).find((c) => c.uid === uid);
  if (!entry) return false;

  const card = getCard(entry.cardId);
  if (s[energyKeyFor(caster)] < card.cost) return false;
  if (card.type === 'TRAP') return s[trapsKeyFor(caster)].length < TRAP_LIMIT;

  return !card.canPlay || card.canPlay({ state: s, caster, uid, targetIndex: undefined });
};
export const selectPlayerHp = (s: GameStore) => s.playerHp;
export const selectMachineHp = (s: GameStore) => s.machineHp;
export const selectMatchSeed = (s: GameStore) => s.matchSeed;

/** HP de um combatente específico. */
export const selectHp = (target: Combatant) => (s: GameStore) =>
  target === 'PLAYER' ? s.playerHp : s.machineHp;

/** Energia (⚡) atual de um combatente específico. */
export const selectEnergy = (target: Combatant) => (s: GameStore) => s[energyKeyFor(target)];

/** Escudo de BATERIA RESERVA ativo de um combatente específico. */
export const selectShield = (target: Combatant) => (s: GameStore) => s[shieldKeyFor(target)];

/**
 * Quantos pips de energia (⚡) de `target` estão "reservados" agora — já
 * debitados no store pelo timing unificado de `pendingInteraction` (a carta
 * cobra ao ABRIR a interação, não ao resolver), mas recuperáveis via
 * `cancelInteraction`. `0` fora dessa janela ou quando a interação pendente é
 * de outro combatente. Alimenta o 3º estado visual (contorno tracejado) do
 * `<EnergyPip />` — nunca muda o TAMANHO do pip nem a altura da fileira, só a
 * borda de pips que já estão vazios por causa da reserva.
 */
export const selectReservedEnergy = (target: Combatant) => (s: GameStore) =>
  s.pendingInteraction?.caster === target ? getCard(s.pendingInteraction.cardId).cost : 0;

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

/** A célula faz parte da linha vencedora da rodada? */
export const selectIsWinningCell = (index: number) => (s: GameStore): boolean =>
  s.winningLine?.includes(index) ?? false;

export const selectIsPlayerTurn = (s: GameStore) => s.turn === 'PLAYER' && s.status === 'PLAYING';
