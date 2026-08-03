import { getChannel } from '@/engine/rng';
import type { CardDefinition, CardId } from '@/engine/cards/definitions';
// Type-only, como em `definitions.ts`: `log.ts` importa `Combatant` daqui, e
// o TypeScript apaga as duas linhas na compilação — não sobra ciclo em runtime.
import type { LogEntry, Notice } from './log';

/**
 * Modelo de domínio do Tic Tac Boom.
 *
 * Este arquivo é a **fonte de verdade** das regras: tipos, constantes e funções
 * puras. Não conhece React, nem Zustand, nem a WebView.
 *
 * O `gameStore` consome daqui e reexporta por conveniência, mas a direção da
 * dependência é só uma: `store → engine`. Nada em `src/engine/` importa de
 * `src/store/`.
 */

/* -------------------------------------------------------------------------- */
/*                                    TIPOS                                    */
/* -------------------------------------------------------------------------- */

/** Símbolo desenhado no tabuleiro. */
export type Mark = 'X' | 'O';

/** Quem controla as peças. O Player sempre joga de 'X', a Máquina de 'O'. */
export type Combatant = 'PLAYER' | 'MACHINE';

/**
 * Regra caótica ativa no tabuleiro.
 * - NORMAL:       jogo da velha infinito padrão.
 * - RANDOM_FADE:  em vez da peça mais antiga, uma peça aleatória do jogador some.
 * - BLOCKED_CELL: uma célula fica interditada e não aceita jogadas.
 */
export type ChaosRule = 'NORMAL' | 'RANDOM_FADE' | 'BLOCKED_CELL';

/** Fase da partida — controla o que a UI pode ou não disparar. */
export type MatchStatus = 'IDLE' | 'PLAYING' | 'ROUND_OVER' | 'MATCH_OVER';

/** Peça ocupando uma célula do tabuleiro. */
export interface Piece {
  owner: Combatant;
  mark: Mark;
  /** Turno global em que foi jogada. É isso que define quem é "a mais velha". */
  turnPlaced: number;
}

/** Célula do tabuleiro: uma peça ou vazia. */
export type BoardCell = Piece | null;

/** Tabuleiro 3x3 achatado em um array de 9 posições (índices 0..8). */
export type Board = BoardCell[];

/**
 * Carta na mão.
 *
 * O `uid` existe porque a mão pode conter duas cartas do mesmo `cardId`, e sem
 * identidade estável não há como (a) endereçar *qual* delas foi jogada, nem
 * (b) dar `key` estável ao React — o que quebra as layout animations do
 * Reanimated ao remover uma carta do meio do leque.
 */
export interface HandCard {
  uid: string;
  cardId: CardId;
}

/**
 * Ação aguardando um alvo.
 *
 * Enquanto isto não for `null` o tabuleiro está em **modo mira**: toques em
 * células resolvem a carta em vez de posicionar peça.
 */
export type PendingAction = {
  type: 'PLAY_CARD';
  uid: string;
  cardId: CardId;
};

/**
 * Linha do log de combate exibida no ChaosTerminal.
 *
 * O `id` monotônico é o que permite ao terminal imprimir só o que ainda não
 * viu — comparar conteúdo falharia com mensagens repetidas legítimas
 * ("demolir :: célula 4" duas vezes seguidas).
 */
/* O log de combate é semântico: o motor emite FATOS, não frases. Os tipos
   vivem em `./log` e são reexportados aqui por conveniência de quem já
   importa tudo de `rules`. Ver `LogCode` para o porquê da separação. */
export type {
  LogCode,
  LogEntry,
  LogPayload,
  Notice,
  NoticePayload,
  NoticeTone,
} from './log';

/**
 * Como o modal de confirmação APRESENTA a informação.
 *
 * - `INFO`       — só texto e um destaque. Armadilha revelada, ação da CPU.
 * - `SPY_PICK`   — mostra `revealedCards` viradas para BAIXO e o jogador
 *                  escolhe UMA para virar (ESPIONAGEM). A escolha é dele, não
 *                  do RNG: decidir onde gastar a informação É a jogada.
 * - `INTEL_FLIP` — todas viradas para baixo, e o jogador vira/desvira quantas
 *                  quiser (VISÃO ABSOLUTA).
 *
 * `SPY_PICK`/`INTEL_FLIP` existem porque "receber uma lista pronta de nomes"
 * não se parece com espionagem — virar a carta com o próprio dedo, sim.
 */
export type AcknowledgementKind = 'INFO' | 'SPY_PICK' | 'INTEL_FLIP';

/**
 * O QUE fez o jogo pausar — o fato, nunca a frase.
 *
 * Mesmo princípio do `LogCode` (ver `./log`): o motor informa o tipo do evento
 * e quem é o sujeito, e a apresentação decide as palavras. Enquanto o
 * descritor carregava `title`/`subtitle`/`description` prontos, o pronome
 * ficava congelado no instante do fato — e numa sala online, onde o convidado
 * controla o `MACHINE`, o selo "ARMADILHA DA CPU" aparecia em cima da
 * armadilha DELE, e "A CPU JOGOU" chamava de robô a pessoa do outro lado.
 *
 * - `TRAP_TRIGGERED` — armadilha disparou. `subject` é o DONO dela,
 *                      `target` quem caiu, `cardId` a carta revelada.
 * - `TRAP_ARMED`     — alguém virou uma armadilha na mesa. `cardId` viaja
 *                      junto, mas só o dono pode lê-lo (ver a tradução).
 * - `CARD_PLAYED`    — anúncio de carta jogada, antes de o efeito aplicar.
 * - `HAND_REVEALED`  — espionagem: `target` é o dono da mão exibida.
 */
export type AcknowledgementCode =
  | 'TRAP_TRIGGERED'
  | 'TRAP_ARMED'
  | 'CARD_PLAYED'
  | 'HAND_REVEALED';

/**
 * Pausa de confirmação manual — uma armadilha disparou, alguém jogou uma
 * carta, ou uma carta revelou informação, e o jogo espera o clique em
 * "Entendi" antes de continuar.
 *
 * Substitui um timer automático: dar um tempo fixo (ex: 1.8s) não garante que
 * o jogador realmente LEU a informação — só que ela ficou na tela por tempo
 * suficiente. Exigir um clique explícito garante leitura, e além disso não
 * exclui quem lê mais devagar.
 */
export interface PendingAcknowledgement {
  /** Monotônico — `key` estável na UI e evita reabrir a mesma pausa duas vezes. */
  id: number;
  code: AcknowledgementCode;
  /** Como o modal se comporta (virar cartas ou não). Comportamento, não texto. */
  kind: AcknowledgementKind;
  /** Quem causou o evento, em coordenadas absolutas do motor. */
  subject: Combatant;
  /** Quem sofreu/possui, quando o evento tem dois lados. */
  target?: Combatant;
  /** A carta em destaque, quando há uma. */
  cardId?: CardId;
  /**
   * Cartas envolvidas. Em `INFO` normalmente vazio (o destaque principal já é
   * a `cardId`); em `SPY_PICK`/`INTEL_FLIP` é a mão que o jogador vai virar
   * carta a carta.
   */
  revealedCards: CardId[];
}

/* Os avisos efêmeros (toasts) seguem o mesmo modelo semântico do log e vivem
   em `./log`, reexportados no topo deste arquivo. */

/* -------------------------------------------------------------------------- */
/*                                   ESTADO                                    */
/* -------------------------------------------------------------------------- */

/**
 * Estado completo de uma partida.
 *
 * Mora na engine, e não no store, porque é o **modelo de domínio**: efeitos de
 * carta, gatilhos de armadilha e a IA operam sobre ele sem nunca tocar em
 * Zustand. O store é apenas o recipiente reativo que o hospeda.
 */
export interface GameState {
  /** 9 células. `null` = vazia. */
  board: Board;
  /** De quem é a vez. */
  turn: Combatant;
  /** Contador global de jogadas. Serve de "timestamp" para a fila de peças. */
  turnCount: number;

  playerHp: number;
  machineHp: number;

  /**
   * Energia (⚡) disponível AGORA para cada combatente.
   *
   * Não cumulativa: cravada em `STARTING_ENERGY` a cada início de turno (ver
   * `refillEnergy` no store), nunca somada ao que sobrou do turno anterior.
   * O valor do combatente que NÃO está na vez é irrelevante para qualquer
   * regra — `resolveCardPlay` só lê a energia de quem já passou pela guarda
   * `turn === caster` — e existe só para o campo nunca ficar `undefined`.
   */
  playerEnergy: number;
  machineEnergy: number;

  /** Regra caótica em vigor no tabuleiro. */
  activeRule: ChaosRule;
  /** Célula interditada enquanto `activeRule === 'BLOCKED_CELL'`. */
  blockedCell: number | null;

  /**
   * Célula lacrada pela carta TRAVAR — **independente** de `blockedCell`.
   *
   * Antes as duas coisas dividiam o mesmo campo, e isso era o bug: um surto
   * de caos sorteando `RANDOM_FADE` sobrescrevia `activeRule` e a trava do
   * jogador evaporava no meio do turno do oponente (e, no sentido inverso,
   * jogar TRAVAR cancelava a regra caótica em vigor de graça). Campos
   * separados fazem os dois efeitos coexistirem, cada um com sua expiração.
   */
  lockedCell: number | null;
  /** Turno global em que `lockedCell` é liberada. `null` quando não há trava. */
  lockedCellExpiresAtTurn: number | null;

  /**
   * Peça marcada pela carta VIDENTE — destruída no início do PRÓXIMO turno
   * do dono dela (`owner`).
   *
   * Guarda `owner` e `turnPlaced` além do `index`, e não só o índice, porque
   * a marca precisa se AUTO-INVALIDAR se a peça sair dali por outro caminho
   * antes do gatilho (um DEMOLIR, o sumiço natural do "infinito", ou outra
   * peça simplesmente ocupando a mesma casa depois): o gatilho (ver
   * `resolveDoomedPiece` no store) só dispara se as três informações ainda
   * baterem com o que está no tabuleiro — senão a marca expira em silêncio
   * em vez de destruir uma peça diferente da que foi de fato marcada.
   */
  doomedCell: { index: number; owner: Combatant; turnPlaced: number } | null;

  /**
   * Mão do jogador. Os dados da carta (nome, efeito, arte) vêm do
   * `CARD_REGISTRY`, então o estado fica leve e serializável.
   */
  playerHand: HandCard[];

  /**
   * Contador de `uid`. Mora no estado (e não num contador de módulo) para o
   * determinismo sobreviver a hot reload e a save/restore da partida.
   */
  nextCardUid: number;

  /** Carta aguardando alvo. `null` = tabuleiro em modo normal. */
  pendingAction: PendingAction | null;

  /**
   * Armadilhas viradas na mesa, por combatente.
   *
   * Dois campos espelhando `playerHp`/`machineHp` em vez de um
   * `Record<Combatant, …>`: os seletores devolvem a mesma referência de array
   * enquanto nada muda daquele lado — um `Record` recriado obrigaria
   * `useShallow` em todo consumidor.
   */
  playerTraps: HandCard[];
  machineTraps: HandCard[];

  /**
   * `uid`s da mão de cada combatente cuja identidade o OPONENTE já conhece
   * (ex.: espiada pela ESPIADA). Não há limpeza quando a carta sai da mão —
   * quem lê isto (`HandTracker`) só consulta um `uid` revelado enquanto ele
   * ainda está na mão viva, então uma entrada "orfã" aqui é inerte, nunca
   * lida de novo. Sem expiração por tempo: a revelação dura enquanto a carta
   * durar na mão (ver `revealedKeyFor`).
   */
  playerRevealedUids: string[];
  machineRevealedUids: string[];

  /**
   * Pausa de confirmação manual em exibição. Não-nula entre o gatilho
   * (armadilha revelada, carta de espionagem) e o jogador clicar "Entendi".
   *
   * Enquanto não for `null`, `canPlaceAt`, `resolveCardPlay` e `setPendingAction`
   * recusam ação: sem isso, o jogador poderia agir antes do efeito mecânico
   * (turno extra, dano) ter sido de fato aplicado — o efeito só aplica
   * quando `acknowledgePending` é chamado.
   */
  pendingAcknowledgement: PendingAcknowledgement | null;
  nextAcknowledgementId: number;

  /** Mão da máquina — espelha `playerHand`. Nunca exibida na UI (é secreta). */
  machineHand: HandCard[];

  /**
   * Turno global em que a máquina já gastou sua carta do turno. `null` = ainda
   * não jogou nenhuma.
   *
   * Existe porque o anúncio da jogada da CPU PAUSA o jogo até o jogador
   * confirmar: a IA aborta o turno ali e o retoma depois do "Entendi". Sem
   * esta marca ela recomeçaria a decisão do zero e jogaria uma segunda carta
   * no mesmo turno. Compara com `turnCount`, então se invalida sozinha — não
   * precisa de ninguém para limpá-la.
   */
  machineCardTurn: number | null;

  /**
   * Turno global (`turnCount`) em que a regra caótica ATUAL reverte para
   * `NORMAL`. `null` enquanto `activeRule === 'NORMAL'` — o repouso não
   * expira sozinho, só é interrompido pelo próximo surto agendado (ver
   * `isChaosSurgeTurn`).
   *
   * Duração fixa (`CHAOS_RULE_DURATION_TURNS`, não mais um intervalo
   * aleatório): o modelo antigo sorteava 2–4 turnos e ponderava a escolha da
   * regra fortemente a favor de `NORMAL`, o que na prática fazia o caos
   * "sumir" com frequência e dava a impressão de que nada estava
   * acontecendo. Cadência fixa e determinística elimina essa ambiguidade.
   */
  ruleExpiresAtTurn: number | null;

  /** Dano mais recente aplicado por `takeDamage`. Efêmero, dispara o flash vermelho de tela. */
  lastDamageEvent: { target: Combatant; amount: number; id: number } | null;
  nextDamageEventId: number;

  /**
   * Concessão de turno extra mais recente. Efêmero, com `id` monotônico —
   * mesmo padrão de `lastDamageEvent`.
   *
   * Existe PORQUE reagir direto a `extraTurnPending` (o valor de controle,
   * não um evento) é frágil: um componente que guarda "o valor anterior" numa
   * ref para detectar a transição perde a corrida sob o double-invoke de
   * efeitos do React em modo dev — a mesma transição pode ser "consumida"
   * pela invocação descartada do efeito, e o timer que esconderia o banner
   * nunca chega a ser reagendado, deixando-o preso piscando para sempre. Um
   * `id` que só muda quando uma NOVA concessão acontece não depende de
   * comparar com nada guardado localmente: o efeito reage à mudança de `id`,
   * e isso sobrevive ao double-invoke porque o `id` em si não regride.
   */
  lastExtraTurn: { target: Combatant; id: number } | null;
  nextExtraTurnId: number;

  /** Aviso mais recente. Efêmero — alimenta o toast sobre o tabuleiro. */
  lastNotice: Notice | null;
  nextNoticeId: number;

  /**
   * ALTAR DE SACRIFÍCIO acabou de resolver — mesmo padrão efêmero de
   * `lastExtraTurn`/`lastNotice`, com `id` monotônico para o `id` disparar o
   * `useEffect` do `<AltarModal />` mesmo se o MESMO combatente jogar a carta
   * duas vezes seguidas (dois valores idênticos de `caster` não mudariam nada
   * para uma comparação sem `id`).
   *
   * `caster` é quem deve VER o modal — nos dois clientes de uma partida
   * online este fato chega idêntico, mas só o lado cujo `caster` bate com o
   * `localCombatant` de fato abre o modal (ver `useMatchPerspective`); o outro
   * lado só recebe o anúncio genérico de "carta jogada" que qualquer carta já
   * emite.
   */
  lastAltarPrompt: { caster: Combatant; id: number } | null;
  nextAltarPromptId: number;

  /**
   * Partida pausada pelo menu de pause.
   *
   * Verificado em `canPlaceAt` (bloqueia o tabuleiro) e no hook da CPU
   * (interrompe o "pensamento" e não inicia um novo turno enquanto pausado).
   */
  isPaused: boolean;

  /**
   * Esta partida tem um humano do outro lado da rede?
   *
   * **Não é estado de rede** — a engine continua sem saber o que é Firebase,
   * sala ou latência. É um fato sobre a PARTIDA que muda uma regra de
   * domínio: se o combatente `MACHINE` é a IA ou uma pessoa.
   *
   * Existe porque o resto do motor tratava `MACHINE` como sinônimo de "a
   * inteligência artificial", e cartas de informação (ESPIONAGEM, VISÃO
   * ABSOLUTA) pulavam o modal quando a IA as jogava — ela não precisa ler
   * nada na tela. No online esse atalho é falso: `MACHINE` é um humano que
   * PRECISA do modal. Com esta flag a distinção fica explícita no lugar de
   * ficar implícita numa suposição que só valia enquanto o jogo era offline.
   */
  isOnline: boolean;

  /**
   * Log de combate — buffer circular de `LOG_LIMIT` linhas.
   *
   * Mora no estado, e não direto na WebView, para sobreviver a recarregamento
   * da página: quando o renderer do Android reinicia, o terminal reimprime o
   * histórico em vez de aparecer vazio.
   */
  terminalLog: LogEntry[];
  nextLogId: number;

  /**
   * Combatente que ganhou um turno extra. A alternância é pulada na PRÓXIMA
   * jogada dele e a flag é consumida.
   */
  extraTurnPending: Combatant | null;

  status: MatchStatus;
  /** Quem venceu a rodada atual (resetado ao iniciar a próxima). */
  roundWinner: Combatant | null;
  /** Linha vencedora — a UI usa para animar o traço/explosão. */
  winningLine: readonly [number, number, number] | null;
  /** Quem venceu a partida inteira (zerou o HP do oponente, ou W.O.). */
  matchWinner: Combatant | null;
  /**
   * Por que a partida acabou, quando não foi por HP zerado.
   *
   * `null` cobre o caminho normal (vitória por dano) — a UI já sabe contar
   * essa história a partir do placar de HP sozinha. `FORFEIT` existe só para
   * o `GameOverOverlay` distinguir "venci jogando" de "venci porque o outro
   * lado sumiu", que merecem textos diferentes na tela final.
   */
  matchOverReason: 'FORFEIT' | null;

  /** Índice da peça removida na última jogada. Efêmero, só para animação. */
  lastVanishedIndex: number | null;

  /**
   * Seed que gerou toda a aleatoriedade desta partida. Exiba no fim de jogo:
   * com ela o jogador reproduz a partida inteira em `startMatch(seed)`.
   */
  matchSeed: number;
}

/* -------------------------------------------------------------------------- */
/*                                 CONSTANTES                                  */
/* -------------------------------------------------------------------------- */

/** Máximo de peças que cada jogador mantém no tabuleiro (regra do "infinito"). */
export const MAX_PIECES_PER_PLAYER = 3;

/** Vidas iniciais de cada lado. */
export const INITIAL_HP = 5;

/**
 * Energia cravada a cada início de turno. Fixa, não cumulativa — ver
 * `playerEnergy`/`machineEnergy` em `GameState`.
 *
 * Teto de facto do `cost` de qualquer carta: como a energia NUNCA acumula
 * entre turnos, uma carta custando mais que isto seria impossível de jogar
 * para sempre. Nenhuma carta do registry atual passa de 3.
 */
export const STARTING_ENERGY = 3;

/** Dano padrão aplicado ao perdedor de uma rodada. Cartas podem alterar. */
export const ROUND_DAMAGE = 1;

/** Teto de cartas na mão do jogador. */
export const HAND_LIMIT = 5;

/** Teto de armadilhas armadas por combatente. */
export const TRAP_LIMIT = 3;

/** Linhas retidas no log de combate. Buffer circular. */
export const LOG_LIMIT = 40;

/**
 * Jogadas que compõem uma **rodada global** — uma de cada lado.
 *
 * `turnCount` conta MEIOS-turnos (uma unidade por peça posicionada). O jogador
 * enxerga "turno" como a rodada completa, então tudo que é anunciado ao
 * jogador em turnos é convertido por aqui em vez de espalhar `* 2` pelo código.
 */
export const TURNS_PER_GLOBAL_ROUND = 2;

/**
 * Rodadas globais completas entre um surto de caos e o próximo.
 *
 * Antes o terminal "acendia" a cada 2 meios-turnos — o surto numa ponta e o
 * retorno a NORMAL na outra —, o que na prática era uma alteração de regra por
 * rodada e fazia o caos parecer constante e sem causa. Agora só o SURTO conta
 * como ativação (o retorno a NORMAL é uma calmaria silenciosa, ver
 * `ChaosTerminal`), e ele acontece uma vez a cada 2 rodadas globais.
 */
export const CHAOS_SURGE_INTERVAL_ROUNDS = 2;

/** A cada quantos meios-turnos um novo surto de caos troca a regra ativa. */
export const CHAOS_SURGE_INTERVAL_TURNS =
  CHAOS_SURGE_INTERVAL_ROUNDS * TURNS_PER_GLOBAL_ROUND;

/** Quantos turnos globais uma regra caótica dura antes de reverter a NORMAL. */
export const CHAOS_RULE_DURATION_TURNS = 2;

/**
 * Duração MÍNIMA (em turnos globais) de uma regra aplicada por CARTA (ex:
 * TRAVAR), distinta de `CHAOS_RULE_DURATION_TURNS` (surto automático do
 * terminal).
 *
 * Precisa ser >= 2, nunca 1 — o "paradoxo do turno": quem lança a carta
 * ainda vai completar a PRÓPRIA jogada (que soma +1 a `turnCount`) antes do
 * oponente sequer decidir. Com duração 1, `tickGlobalClock` reverteria a
 * regra na jogada de quem LANÇOU a carta, e o efeito nunca chegaria a valer
 * para o adversário — exatamente o bug que isto existe para prevenir.
 */
export const CARD_RULE_MIN_DURATION_TURNS = 2;

/** A cada quantas jogadas globais completas cada lado recebe 1 carta. */
export const AUTO_DRAW_INTERVAL_TURNS = 6;

/** Cartas na mão inicial de cada lado, distribuídas por `startMatch`. */
export const OPENING_HAND_SIZE = 2;

/** Combinações vencedoras no grid achatado. */
export const WIN_LINES: readonly (readonly [number, number, number])[] = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8], // linhas
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8], // colunas
  [0, 4, 8],
  [2, 4, 6], // diagonais
] as const;

/** Mapeia o combatente para o símbolo que ele desenha. */
export const MARK_BY_COMBATANT: Record<Combatant, Mark> = {
  PLAYER: 'X',
  MACHINE: 'O',
};

/** Tabuleiro vazio. Função, não constante: array compartilhado seria mutável. */
export const createEmptyBoard = (): Board => Array<BoardCell>(9).fill(null);

/* -------------------------------------------------------------------------- */
/*                              CONSULTAS PURAS                                */
/* -------------------------------------------------------------------------- */

/** O oponente de um combatente. */
export function opponentOf(combatant: Combatant): Combatant {
  return combatant === 'PLAYER' ? 'MACHINE' : 'PLAYER';
}

/**
 * Chave de `GameState` que guarda a mão de um combatente.
 *
 * Centraliza o ternário `caster === 'PLAYER' ? 'playerHand' : 'machineHand'`
 * que, sem isso, se repetiria em meia dúzia de lugares no store e nas cartas
 * — cada repetição é uma chance de trocar `player`/`machine` por engano.
 */
export function handKeyFor(combatant: Combatant): 'playerHand' | 'machineHand' {
  return combatant === 'PLAYER' ? 'playerHand' : 'machineHand';
}

/** Mesma ideia de `handKeyFor`, para a zona de armadilhas. */
export function trapsKeyFor(combatant: Combatant): 'playerTraps' | 'machineTraps' {
  return combatant === 'PLAYER' ? 'playerTraps' : 'machineTraps';
}

/**
 * Mesma ideia de `handKeyFor`, para os `uid`s revelados da mão de um
 * combatente — isto é, cartas daquele combatente cuja identidade quem as
 * espiou já conhece (ver `HandTracker`). Só o OPONENTE de um combatente pode
 * espiar a mão dele, então este mesmo array serve aos dois lados sem precisar
 * de uma segunda tabela: do ponto de vista de quem espiou, é "o que eu sei da
 * mão dele"; do ponto de vista do dono da mão, é "o que ele já sabe de mim".
 */
export function revealedKeyFor(combatant: Combatant): 'playerRevealedUids' | 'machineRevealedUids' {
  return combatant === 'PLAYER' ? 'playerRevealedUids' : 'machineRevealedUids';
}

/** HP atual de um combatente. */
export function hpOf(state: GameState, combatant: Combatant): number {
  return combatant === 'PLAYER' ? state.playerHp : state.machineHp;
}

/** Mesma ideia de `handKeyFor`, para a energia. */
export function energyKeyFor(combatant: Combatant): 'playerEnergy' | 'machineEnergy' {
  return combatant === 'PLAYER' ? 'playerEnergy' : 'machineEnergy';
}

/** Energia atual de um combatente. */
export function energyOf(state: GameState, combatant: Combatant): number {
  return state[energyKeyFor(combatant)];
}

/** Mão atual de um combatente. */
export function handOf(state: GameState, combatant: Combatant): HandCard[] {
  return state[handKeyFor(combatant)];
}

/** Índices ocupados do tabuleiro, opcionalmente filtrados por dono. */
export function occupiedIndexes(state: GameState, owner?: Combatant): number[] {
  const out: number[] = [];
  state.board.forEach((cell, index) => {
    if (cell && (owner === undefined || cell.owner === owner)) out.push(index);
  });
  return out;
}

/** Índices ocupados por um combatente, do mais antigo ao mais novo. */
export function getPieceIndexes(board: Board, owner: Combatant): number[] {
  return board
    .map((cell, index) => ({ cell, index }))
    .filter((entry): entry is { cell: Piece; index: number } => entry.cell?.owner === owner)
    .sort((a, b) => a.cell.turnPlaced - b.cell.turnPlaced)
    .map((entry) => entry.index);
}

/**
 * Índice da peça mais antiga do combatente, ou `null` se ele ainda não atingiu
 * o limite. **Puro** — é esta versão que a UI e a IA podem consumir.
 */
export function getOldestPieceIndex(board: Board, owner: Combatant): number | null {
  const indexes = getPieceIndexes(board, owner);
  return indexes.length < MAX_PIECES_PER_PLAYER ? null : indexes[0];
}

/** Procura uma linha fechada. Retorna o vencedor e a linha, ou `null`. */
export function findWinner(
  board: Board,
): { winner: Combatant; line: readonly [number, number, number] } | null {
  for (const line of WIN_LINES) {
    const [a, b, c] = line;
    const first = board[a];
    if (first && board[b]?.owner === first.owner && board[c]?.owner === first.owner) {
      return { winner: first.owner, line };
    }
  }
  return null;
}

/**
 * A jogada é legal?
 *
 * Fonte única das guardas de `placeMark`. A UI chama a mesma função para
 * decidir entre haptic de sucesso e de erro — se a regra mudar, muda aqui e
 * os dois lados acompanham.
 */
export function canPlaceAt(state: GameState, index: number): boolean {
  if (state.status !== 'PLAYING') return false;
  if (state.isPaused) return false;
  // Uma pausa de confirmação em exibição segura o jogo antes do efeito
  // (armadilha, carta de espionagem) aplicar de fato — jogar nesta janela
  // poderia acontecer ANTES do turno extra/dano valer, criando uma corrida.
  if (state.pendingAcknowledgement !== null) return false;
  // Modo mira sequestra o tabuleiro: nenhuma peça é posicionada até a carta
  // resolver ou ser cancelada.
  if (state.pendingAction !== null) return false;
  if (index < 0 || index > 8) return false;
  if (state.board[index] !== null) return false;
  // Caos (BLOCKED_CELL) e carta (TRAVAR) lacram por caminhos diferentes; aqui
  // a distinção não importa, só o resultado.
  if (isCellUnavailable(state, index)) return false;
  return true;
}

/**
 * A célula é alvo legal para esta carta? **Pura** — roda dentro de seletor do
 * Zustand, uma vez por célula a cada mudança de estado.
 *
 * Recebe a `CardDefinition` pronta em vez do `cardId`: assim a engine de regras
 * não precisa importar o catálogo de cartas, e o grafo de módulos fica sem
 * ciclos. Quem tem o id resolve o lookup antes de chamar.
 */
export function isValidTargetForCard(
  state: GameState,
  card: CardDefinition,
  index: number,
  caster: Combatant = 'PLAYER',
): boolean {
  if (index < 0 || index > 8) return false;
  if (!card.requiresTarget) return false;

  return card.isValidTarget ? card.isValidTarget({ state, caster, index }) : true;
}

/**
 * A regra caótica atual já deveria ter revertido para NORMAL?
 *
 * `ruleExpiresAtTurn === null` significa "sem prazo" (é o caso de `NORMAL`
 * em repouso — ele não expira sozinho, só o próximo surto agendado o
 * interrompe), então nunca é considerado expirado.
 */
export function isChaosRuleExpired(state: GameState): boolean {
  return state.ruleExpiresAtTurn !== null && state.turnCount >= state.ruleExpiresAtTurn;
}

/** É turno de um novo surto de caos (`CHAOS_SURGE_INTERVAL_TURNS` em turnos)? */
export function isChaosSurgeTurn(turnCount: number): boolean {
  return turnCount > 0 && turnCount % CHAOS_SURGE_INTERVAL_TURNS === 0;
}

/**
 * A célula está lacrada pela carta TRAVAR?
 *
 * Separado de `BLOCKED_CELL` (regra caótica) de propósito — ver `lockedCell`
 * em `GameState`. Quem só quer saber "dá para jogar aqui?" usa `canPlaceAt`,
 * que consulta as duas coisas.
 */
export function isCellLocked(state: GameState, index: number): boolean {
  return state.lockedCell === index;
}

/** A trava de célula da carta TRAVAR já venceu? */
export function isLockedCellExpired(state: GameState): boolean {
  return (
    state.lockedCellExpiresAtTurn !== null && state.turnCount >= state.lockedCellExpiresAtTurn
  );
}

/**
 * A célula é interditada por QUALQUER motivo (caos ou carta)?
 *
 * É a pergunta que o tabuleiro e a IA realmente fazem — nenhum dos dois se
 * importa com qual dos dois subsistemas lacrou a casa.
 */
export function isCellUnavailable(state: GameState, index: number): boolean {
  if (isCellLocked(state, index)) return true;
  return state.activeRule === 'BLOCKED_CELL' && state.blockedCell === index;
}

/** É hora de distribuir a carta automática deste turno global? */
export function isAutoDrawTurn(turnCount: number): boolean {
  return turnCount > 0 && turnCount % AUTO_DRAW_INTERVAL_TURNS === 0;
}

/* -------------------------------------------------------------------------- */
/*                        CONSULTAS DEPENDENTES DE RNG                         */
/* -------------------------------------------------------------------------- */
/* Determinísticas dada a seed, mas **consomem** a sequência. Só podem ser
   chamadas uma vez por evento de jogo — nunca dentro de render ou seletor.   */

/**
 * Decide qual peça do combatente deve sumir para abrir espaço para a próxima.
 * Retorna `null` quando ele ainda não atingiu o limite.
 *
 * ⚠️ **Impura sob `RANDOM_FADE`** — consome o canal `BOARD`. Use apenas dentro
 * de `placeMark`. Para a UI existe `selectIsVanishing`, que é puro.
 */
export function getVanishingIndex(
  board: Board,
  owner: Combatant,
  rule: ChaosRule = 'NORMAL',
): number | null {
  const indexes = getPieceIndexes(board, owner);
  if (indexes.length < MAX_PIECES_PER_PLAYER) return null;

  if (rule === 'RANDOM_FADE') {
    return getChannel('BOARD').pick(indexes);
  }

  return indexes[0]; // menor turnPlaced = mais antiga
}

/**
 * Sorteia o índice de uma célula vazia pelo canal `BOARD`.
 * Retorna `null` se não houver nenhuma.
 */
export function pickFreeCell(board: Board): number | null {
  const free = board.map((cell, i) => (cell === null ? i : -1)).filter((i) => i !== -1);
  if (free.length === 0) return null;
  return getChannel('BOARD').pick(free);
}
