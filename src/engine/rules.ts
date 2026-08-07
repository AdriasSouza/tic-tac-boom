import { getChannel } from '@/engine/rng';
import type { CardDefinition, CardId, CardRarity } from '@/engine/cards/definitions';
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

/** Ver `GameState.forcedVanish`. */
export type ForcedVanish =
  | { owner: Combatant; mode: 'RANDOM' }
  | { owner: Combatant; mode: 'CHOSEN'; index: number; turnPlaced: number };

/** Ver `GameState.highlightedOldestFor`. */
export type HighlightedOldest = {
  caster: Combatant;
  /** Dono da peça destacada — `opponentOf(caster)` no instante do cast. */
  owner: Combatant;
  index: number;
  /** Identidade da peça, mesma ideia do `CHOSEN` de `ForcedVanish`. */
  turnPlaced: number;
};

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
 * Uma escolha do jogador respondendo a um passo de `PendingInteraction`.
 *
 * Quase zero dependência de `definitions.ts` de propósito (só primitivos) — é
 * por isso que mora aqui e `definitions.ts` importa daqui, nunca o contrário.
 * Única exceção: `PICK_ONE_REVEALED` carrega `CardId` diretamente (Fase 4) —
 * a UI/rede já sabem a identidade de cada opção (renderizam `pending.options[i]`
 * pra desenhar a carta), então resolvem na ORIGEM em vez de mandar um `index`
 * que o `effect()` não teria como traduzir de volta ao `CardId` no passo final
 * (`resolveInteraction` não repassa `pending.options` pro `effect`, só
 * `{selection, priorSelections}` — ver `CardEffectContext.interaction` em
 * `definitions.ts`). Mesmo import type-only já usado no restante do arquivo
 * (`CardId` em `PendingInteractionBase.cardId`), sem ciclo novo.
 */
export type InteractionSelection =
  | { kind: 'BOARD_TARGET'; index: number }
  | { kind: 'PICK_ONE_FROM_HAND'; uid: string }
  | { kind: 'PICK_MANY_FROM_HAND'; uids: readonly string[] }
  | { kind: 'PICK_ONE_REVEALED'; cardId: CardId }
  | { kind: 'SACRIFICE_DRAG'; uids: readonly [string, string] };

interface PendingInteractionBase {
  caster: Combatant;
  cardId: CardId;
  cardUid: string;
  /**
   * Índice original na mão do `caster` — restaura a carta no MESMO lugar se a
   * interação for cancelada. Não é "entrar na mão" no sentido de `CLAUDE.md`
   * #7 (carta nova sempre pelo fim): é desfazer uma remoção, a carta nunca
   * foi embora de verdade do ponto de vista de quem a possui.
   */
  handIndex: number;
  /** Escolhas de passos ANTERIORES da MESMA jogada, em ordem. Vazio no 1º passo. */
  priorSelections: readonly InteractionSelection[];
}

/**
 * Interação pendente: uma carta pediu uma escolha do jogador e o jogo pausa
 * até ela chegar (ou a jogada ser cancelada). Generaliza o antigo
 * `PendingAction`/"modo mira" — `BOARD_TARGET` é o caso que ele virou, não um
 * sistema à parte.
 *
 * Campo ÚNICO em `GameState` (não um par por combatente): só o dono do turno
 * ATUAL pode ter uma interação viva (`canPlaceAt`/`endTurn` recusam agir
 * enquanto ela existir — a mesma guarda que `pendingAction` já tinha), e só
 * um turno está em curso por vez. Extensão do 5º critério de
 * `docs/NOTAS_TECNICAS.md`: par-por-combatente é para quando os dois lados
 * PODEM ter um valor vivo ao mesmo tempo — aqui isso é estruturalmente
 * impossível, igual `highlightedOldestFor`.
 *
 * `BOARD_TARGET` é o único `kind` que nunca nasce de `card.effect()` — o
 * motor de resolução de carta o abre diretamente para cartas
 * `requiresTarget` sem alvo ainda escolhido (ver `resolveCardPlay`,
 * `gameStore.ts`). Os outros 4 nascem de `effect()` devolver
 * `CardEffectResult.interaction` (`definitions.ts`).
 */
export type PendingInteraction =
  | (PendingInteractionBase & { kind: 'BOARD_TARGET' })
  | (PendingInteractionBase & {
      kind: 'PICK_ONE_FROM_HAND';
      /**
       * De quem é a mão sendo escolhida. `source === caster` → mostra a
       * FACE (é a própria mão de quem escolhe); `source !== caster` →
       * mostra o VERSO (mão oculta do oponente). Visibilidade sempre
       * DERIVADA daqui, nunca um flag à parte.
       */
      source: Combatant;
      optionUids: readonly string[];
    })
  | (PendingInteractionBase & {
      kind: 'PICK_MANY_FROM_HAND';
      source: Combatant;
      optionUids: readonly string[];
      /**
       * Já clampado a `Math.min(pedido, optionUids.length)` pelo store ao
       * abrir — nunca confiar num `count` que `effect()` pediu sem reclampar.
       */
      count: number;
    })
  | (PendingInteractionBase & { kind: 'PICK_ONE_REVEALED'; options: readonly CardId[] })
  | (PendingInteractionBase & {
      kind: 'SACRIFICE_DRAG';
      eligibleUids: readonly string[];
      count: number; // mesma regra de clamp
    });

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
 * - `INTEL_FLIP` — todas já vêm viradas pra CIMA ao abrir (VISÃO ABSOLUTA) —
 *                  leitura automática, sem seleção (decisão da Fase 3: é
 *                  exibição, não interação — por isso nunca passou por
 *                  `pendingInteraction`).
 *
 * `SPY_PICK` existe porque "receber uma lista pronta de nomes" não se parece
 * com espionagem — virar a carta com o próprio dedo, sim.
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
   * Cumulativa, com teto: ao final de QUALQUER turno os dois lados ganham +1,
   * até `ENERGY_CAP` (ver `regenEnergy`, chamado pelo store) — energia não
   * gasta persiste entre turnos, nunca é cravada de volta a um valor fixo.
   * Isso vale inclusive para o combatente que NÃO está na vez: ele também
   * acumula enquanto espera, é por isso que o regen precisa dos DOIS valores
   * a cada chamada, não só do valor de quem vai jogar agora.
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
   * Override de qual peça soma no PRÓXIMO sumiço do "infinito" para um
   * combatente — ANOMALIA (`RANDOM`) e OBSOLESCÊNCIA (`CHOSEN`) escrevem aqui,
   * `getVanishingIndex` consulta. Único por PARTIDA, não por combatente-alvo:
   * se as duas cartas forem jogadas contra o mesmo oponente antes dele
   * estourar 3 peças, a mais recente sobrescreve a mais antiga em silêncio —
   * decisão deliberada (a marcação vencida já "gastou" a carta que a criou,
   * é o custo de duas cartas mirando o mesmo alvo).
   *
   * `CHOSEN` guarda `turnPlaced` além do `index`: auto-invalidação se a peça
   * sair dali por outro caminho (DEMOLIR, sumiço natural) antes do gatilho —
   * `getVanishingIndex` cai para o comportamento padrão em vez de forçar uma
   * peça diferente da marcada. Substitui o antigo campo `doomedCell` (VIDENTE
   * antiga, removido na Fase 2 — OBSOLESCÊNCIA usa este mecanismo agora).
   */
  forcedVanish: ForcedVanish | null;

  /**
   * REBOBINAR em vigor contra este combatente: ele joga o turno normalmente
   * (energia, cartas, armadilhas) mas `canPlaceAt` recusa qualquer colocação
   * de peça dele enquanto isto for `true`. Dois campos independentes — não um
   * `Combatant | null` único — porque os dois valores possíveis qualificam
   * COMBATENTES DIFERENTES, não a mesma fila/alvo compartilhado (esse é o
   * caso de `forcedVanish`, onde "o mais recente vence" é correto). Aqui um
   * campo único faria REBOBINAR contra um lado apagar por acidente o bloqueio
   * já em vigor contra o outro. Consumido só por `endTurn` do PRÓPRIO
   * combatente (terminar o turno sempre limpa o próprio bloqueio); resetado
   * em `startNextRound` como qualquer flag de turno.
   */
  playerPlacementBlocked: boolean;
  machinePlacementBlocked: boolean;

  /**
   * VIDENTE em vigor: destaca no tabuleiro, só para `caster`, qual peça de
   * `owner` é a mais antiga (a próxima que sumiria pela regra do "infinito").
   * Leitura pura — ao contrário de `forcedVanish`/OBSOLESCÊNCIA, não altera a
   * fila de ninguém, só aponta pra ela.
   *
   * Campo ÚNICO (não um par por combatente como `playerPlacementBlocked`/
   * `machinePlacementBlocked`): aqui é seguro porque os dois valores possíveis
   * NUNCA coexistem — um destaque só existe enquanto `turn === caster` (é
   * limpo exatamente quando o turno de quem lançou termina, em `placeMark`/
   * `endTurn`), e só um turno está em curso por vez. Extensão do critério de
   * `playerPlacementBlocked` (ver `docs/NOTAS_TECNICAS.md`): par-por-combatente
   * é necessário quando os dois lados podem ter um valor vivo ao mesmo tempo;
   * aqui isso é estruturalmente impossível.
   *
   * `owner`+`turnPlaced` existem para AUTO-INVALIDAR a leitura (mesma ideia do
   * `CHOSEN` de `forcedVanish`): se a peça destacada sair do índice por outro
   * caminho (DEMOLIR, sumiço natural) antes do turno acabar, `owner`/
   * `turnPlaced` deixam de bater com a peça que está lá agora, e
   * `isHighlightedOldestValid` já reporta "não destaca mais" — sem precisar
   * de ninguém limpar o campo àquela hora. `startNextRound` limpa porque
   * referencia um índice do tabuleiro da rodada anterior.
   */
  highlightedOldestFor: HighlightedOldest | null;

  /**
   * `Combatant` que jogou VISÃO ABSOLUTA e está enxergando a mão inteira do
   * oponente agora — `null` fora dessa janela. Mesma classe de
   * `highlightedOldestFor`: campo TRANSITÓRIO, único (não par-por-combatente)
   * apesar de qualificar um combatente específico, seguro por exclusividade
   * TEMPORAL — só quem tem a vez pode ter revelado a mão do oponente agora
   * (a carta só é jogável no próprio turno), e nunca há dois turnos em curso
   * ao mesmo tempo, logo nunca duas revelações vivas simultâneas. Expira
   * exatamente quando o turno de quem jogou termina — mesmos 4 pontos de
   * limpeza de `highlightedOldestFor` (vitória de rodada, ramo normal de
   * `placeMark`, `endTurn`, `startNextRound`), mesma exceção de sobreviver à
   * 2ª colocação de TURNO_EXTRA (é o MESMO turno ainda). `startNextRound`
   * limpa incondicionalmente — sobreviveria a uma rodada que já não é mais a
   * atual.
   *
   * Deliberadamente SEPARADO de `playerRevealedUids`/`machineRevealedUids`
   * (ESPIADA/ESPIONAGEM): aquele é por-`uid`, sem prazo, cobre carta a carta;
   * este é por-mão-inteira, com prazo de turno. Ver `docs/NOTAS_TECNICAS.md`.
   */
  fullIntelRevealFor: Combatant | null;

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

  /**
   * Interação pendente — carta esperando uma escolha do jogador. `null` =
   * tabuleiro/mão em modo normal. Ver `PendingInteraction` para o contrato
   * completo (substitui o antigo `PendingAction`/"modo mira" — `BOARD_TARGET`
   * é o caso que ele virou).
   */
  pendingInteraction: PendingInteraction | null;

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
   * Enquanto não for `null`, `canPlaceAt` e `resolveCardPlay` recusam ação:
   * sem isso, o jogador poderia agir antes do efeito mecânico (turno extra,
   * dano) ter sido de fato aplicado — o efeito só aplica quando
   * `acknowledgePending` é chamado.
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

/**
 * Teto do regen de energia a cada fim de turno (ver `regenEnergy`). Hoje igual
 * a `STARTING_ENERGY`, mas é uma constante PRÓPRIA de propósito:
 * `STARTING_ENERGY` responde "quanta energia no início da PARTIDA" (valor
 * inicial, cravado uma vez), `ENERGY_CAP` responde "até onde o regen pode
 * subir" (teto aplicado a cada turno, para sempre). São perguntas diferentes
 * que hoje têm a mesma resposta — se um dia divergirem (ex.: a partida abrir
 * com menos energia que o teto normal), o acoplamento não pode ser silencioso.
 */
export const ENERGY_CAP = 3;

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

/** Mesma ideia de `handKeyFor`, para o bloqueio de colocação da REBOBINAR. */
export function placementBlockedKeyFor(
  combatant: Combatant,
): 'playerPlacementBlocked' | 'machinePlacementBlocked' {
  return combatant === 'PLAYER' ? 'playerPlacementBlocked' : 'machinePlacementBlocked';
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

/**
 * Regen de energia ao final de QUALQUER turno: os dois lados ganham +1, até
 * `ENERGY_CAP` — energia não gasta persiste (`CLAUDE.md`, 1). Pura e simétrica
 * de propósito: quem chama nunca precisa saber QUEM está prestes a jogar, só
 * o par de valores atuais — é o que torna trivial pular esta chamada quando
 * um efeito (TURNO_EXTRA) concede uma ação extra sem regen (ver `beginTurn`
 * no store).
 */
export function regenEnergy(
  playerEnergy: number,
  machineEnergy: number,
): Pick<GameState, 'playerEnergy' | 'machineEnergy'> {
  return {
    playerEnergy: Math.min(ENERGY_CAP, playerEnergy + 1),
    machineEnergy: Math.min(ENERGY_CAP, machineEnergy + 1),
  };
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
 * `combatant` pode colocar peça em `index` agora?
 *
 * Fonte única das guardas de `placeMark`. A UI chama a mesma função para
 * decidir entre haptic de sucesso e de erro — se a regra mudar, muda aqui e
 * os dois lados acompanham.
 *
 * `combatant` é obrigatório (não inferido de `state.turn`) de propósito: é
 * exatamente essa checagem — "quem está pedindo a jogada É o dono da vez?" —
 * que faltava aqui antes. `resolveCardPlay` sempre validou isto para cartas
 * (`state.turn !== caster`); `placeMark` só validava a CÉLULA, nunca o ATOR,
 * e a única coisa segurando um toque fora de hora era a UI (`isLocalTurn`,
 * que é sempre `true` fora do online) — um toque rápido durante a "vez" da
 * CPU passava por aqui e colocava peça como se fosse ela.
 */
export function canPlaceAt(state: GameState, index: number, combatant: Combatant): boolean {
  if (state.turn !== combatant) return false;
  if (state.status !== 'PLAYING') return false;
  if (state.isPaused) return false;
  // Uma pausa de confirmação em exibição segura o jogo antes do efeito
  // (armadilha, carta de espionagem) aplicar de fato — jogar nesta janela
  // poderia acontecer ANTES do turno extra/dano valer, criando uma corrida.
  if (state.pendingAcknowledgement !== null) return false;
  // Interação pendente sequestra o tabuleiro (mira, escolha de carta,
  // sacrifício...): nenhuma peça é posicionada até ela resolver ou cancelar.
  if (state.pendingInteraction !== null) return false;
  // REBOBINAR: o resto do turno de `combatant` segue normal (energia, cartas,
  // armadilhas) — só a colocação de peça é recusada aqui.
  if (state[placementBlockedKeyFor(combatant)]) return false;
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

/**
 * Esta raridade é imune a armadilha? Lendária e Boom "não podem ser paradas
 * por armadilhas" (PDF) — cobertura que `docs/CARTAS.md` já recomendava
 * centralizar aqui desde a Fase 1, para PROTEÇÃO/ANTIMAGIA/RICOCHETE
 * consultarem em vez de cada uma reimplementar a mesma exclusão por lista.
 */
export function isImmuneToTraps(rarity: CardRarity): boolean {
  return rarity === 'LEGENDARY' || rarity === 'BOOM';
}

/**
 * O destaque de VIDENTE (`highlightedOldestFor`) ainda aponta pra peça
 * original? Auto-invalidação — mesma ideia do `CHOSEN` de `forcedVanish`: se
 * a peça saiu do índice por outro caminho (DEMOLIR, sumiço natural) antes do
 * turno de quem lançou terminar, o glow só para de acender — ninguém precisa
 * limpar o campo naquela hora.
 */
export function isHighlightedOldestValid(state: GameState): boolean {
  const marked = state.highlightedOldestFor;
  if (!marked) return false;
  const piece = state.board[marked.index];
  return piece !== null && piece.owner === marked.owner && piece.turnPlaced === marked.turnPlaced;
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
 * `forced` (ANOMALIA/OBSOLESCÊNCIA, ver `GameState.forcedVanish`) só é
 * consultado quando `forced.owner === owner` e vence sobre a regra caótica:
 * `RANDOM` sorteia entre as peças dele (canal `BOARD`, mesmo sorteio de
 * `RANDOM_FADE`); `CHOSEN` devolve o índice marcado, mas só se a peça ali
 * ainda for exatamente a mesma (`owner`+`turnPlaced` batendo) — se ela já
 * saiu dali por outro caminho (DEMOLIR, sumiço natural), a marca expirou em
 * silêncio e o comportamento cai para o padrão abaixo.
 *
 * ⚠️ **Impura sob `RANDOM_FADE` ou `forced.mode === 'RANDOM'`** — consome o
 * canal `BOARD`. Use apenas dentro de `placeMark`. Para a UI existe
 * `selectIsVanishing`, que é puro.
 */
export function getVanishingIndex(
  board: Board,
  owner: Combatant,
  rule: ChaosRule = 'NORMAL',
  forced?: ForcedVanish | null,
): number | null {
  const indexes = getPieceIndexes(board, owner);
  if (indexes.length < MAX_PIECES_PER_PLAYER) return null;

  if (forced && forced.owner === owner) {
    if (forced.mode === 'RANDOM') {
      return getChannel('BOARD').pick(indexes);
    }
    const piece = board[forced.index];
    if (piece && piece.owner === owner && piece.turnPlaced === forced.turnPlaced) {
      return forced.index;
    }
    // Marca expirada (a peça saiu por outro caminho) — cai pro padrão abaixo.
  }

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
