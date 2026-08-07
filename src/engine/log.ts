import type { Combatant } from './rules';

/**
 * Vocabulário de eventos do log de combate.
 *
 * O motor emite **fatos absolutos** — "o combatente PLAYER venceu a rodada" —
 * e nunca texto. Quem transforma fato em frase é a camada de apresentação
 * (`src/i18n/logMessages.ts`), que é a única que sabe quem está segurando o
 * aparelho e, portanto, quem é "você".
 *
 * Antes disso o `gameStore` montava strings com pronome embutido
 * (`"rodada :: você venceu"`), o que funcionava só porque o humano era sempre
 * o `PLAYER`. Numa sala online o convidado controla o `MACHINE`, e o terminal
 * narrava a partida dele invertida: "a cpu venceu" no momento em que ele
 * ganhava. O acoplamento entre domínio e idioma não era um problema estético
 * — era um bug de correção.
 *
 * ⚠️ **Cada código define o significado do próprio `value`.** O contrato está
 * documentado abaixo, código a código, e o tradutor é a única coisa que
 * precisa conhecê-lo.
 */
export type LogCode =
  /* --- Tabuleiro ---------------------------------------------------------- */
  /** `subject` posicionou peça. `value` = índice da célula (0..8). */
  | 'MOVE_PLACED'
  /** `subject` venceu a rodada. */
  | 'ROUND_WIN'
  /** `subject` passou a vez sem colocar peça (botão ou REBOBINAR). */
  | 'TURN_PASSED'

  /* --- Caos --------------------------------------------------------------- */
  /** Regra caótica entrou em vigor. `value` = `ChaosRule`. */
  | 'CHAOS_RULE'
  /** A trava da carta TRAVAR expirou sozinha. Sem parâmetros. */
  | 'CELL_UNLOCKED'

  /* --- Armadilhas --------------------------------------------------------- */
  /**
   * `subject` armou uma armadilha. `value` = `CardId`.
   *
   * O nome da carta viaja no evento, mas **a apresentação esconde de quem não
   * é o dono** — revelar a identidade de uma armadilha do oponente destruiria
   * a única coisa que a faz valer o custo. Guardar o segredo na tradução (e
   * não omitindo o dado no motor) mantém um log único e correto para os dois
   * lados, cada um vendo o que tem direito de ver.
   */
  | 'TRAP_ARMED'
  /** Armadilha de `subject` anulou uma carta que leu/retirou da mão dele. */
  | 'TRAP_SHIELD'
  /** A MINA de `subject` detonou no centro. */
  | 'TRAP_BOMB'
  /** ANTIMAGIA de `subject` anulou a próxima carta do oponente. */
  | 'TRAP_ANTI_SPELL'
  /** RICOCHETE de `subject` inverteu ou anulou um efeito de `target`. */
  | 'TRAP_RICOCHET'

  /* --- Cartas ------------------------------------------------------------- */
  /** `subject` destruiu uma peça. `value` = índice. */
  | 'CARD_BREAK_PIECE'
  /** `subject` fez o oponente perder a próxima jogada dele. */
  | 'CARD_TURNO_EXTRA'
  /** `subject` recuperou 1 HP. */
  | 'CARD_HEAL'
  /** `subject` causou dano direto em `target`. */
  | 'CARD_DAMAGE'
  /** `subject` comprou cartas. `value` = quantidade. */
  | 'CARD_DRAW'
  /** `subject` roubou uma carta de `target`. `value` = `CardId` roubada. */
  | 'CARD_RAID_STOLE'
  /** SAQUE de `subject` contra `target` falhou — nada aconteceu. */
  | 'CARD_RAID_FAILED'
  /**
   * `subject` destruiu 1 carta aleatória de `target` — ramo de falha de SAQUE/
   * SAQUE II (antes era no-op; Fase 4 passou a destruir de verdade). `value` =
   * `CardId` destruída.
   */
  | 'CARD_RAID_DESTROYED'
  /** `subject` liberou uma célula interditada. `value` = índice. */
  | 'CARD_CLEANSE'
  /** `subject` limpou TODAS as células interditadas do tabuleiro. Sem `value`. */
  | 'CARD_CLEANSE_ALL'
  /** `subject` trocou a mão inteira com `target`. Sem `value` — não há "a carta cedida", é a mão toda. */
  | 'CARD_HAND_SWAP'
  /** `subject` destacou a peça mais antiga de `target`. `value` = índice. */
  | 'CARD_HIGHLIGHT_OLDEST'
  /** `subject` embaralhou a fila do "infinito" de `target`. Sem `value`. */
  | 'CARD_QUEUE_SHUFFLE'
  /**
   * `subject` marcou uma peça de `target` como a próxima a sumir da fila do
   * "infinito" dele (OBSOLESCÊNCIA — `forcedVanish`, não mais destruição
   * imediata). `value` = índice.
   */
  | 'CARD_MARK_DOOMED'
  /**
   * `subject` bloqueou a colocação de peça de `target` no próximo turno dele
   * (REBOBINAR). O resto do turno de `target` segue normal — sem `value`.
   */
  | 'CARD_REBOBINAR'
  /** `subject` lacrou uma célula. `value` = índice. */
  | 'CARD_LOCK_CELL'
  /** `subject` espiou uma carta aleatória de `target`. `value` = `CardId`. */
  | 'CARD_SPY_PEEK'
  /** `subject` revelou e descartou uma carta de `target`. `value` = `CardId` descartada. */
  | 'CARD_SPY_DISCARD'
  /** `subject` leu a mão inteira de `target`. `value` = nº de cartas. */
  | 'CARD_INTEL_HAND'
  /**
   * `subject` revelou N cartas da mão de `target` (ESPIONAGEM) sem descartar
   * nenhuma — as cartas continuam com `target`. `value` = nº de cartas
   * reveladas (1 ou 2, conforme o tamanho real da mão dele).
   */
  | 'CARD_INTEL_REVEAL'
  /**
   * `subject` trocou 1 carta com `target` (TROCAR — 1 por 1, com escolha
   * manual dos dois lados). `value` = `CardId` que `subject` recebeu na
   * troca.
   */
  | 'CARD_SINGLE_TRADE'
  /**
   * `subject` escolheu 1 carta entre as opções reveladas (PROCRASTINAR/
   * PROCRASTINAR II) — as outras são descartadas sem entrar em jogo. `value`
   * = `CardId` escolhida.
   */
  | 'CARD_DRAFT_PICK'
  /** `subject` disparou a roleta do caos. */
  | 'CARD_CHAOS_ROULETTE'
  /** `subject` invocou uma carta nova no Altar de Sacrifício. `value` = `CardId` invocada. */
  | 'CARD_ALTAR_INVOKED';

/**
 * O fato, sem identidade. É o que os produtores (store, cartas) emitem.
 *
 * `subject`/`target` são combatentes ABSOLUTOS (`PLAYER`/`MACHINE`). A
 * conversão para "você"/"o oponente" acontece só na renderização.
 */
export interface LogPayload {
  code: LogCode;
  /** Quem causou o evento. */
  subject?: Combatant;
  /** Quem sofreu o evento, quando faz sentido distinguir. */
  target?: Combatant;
  /** Parâmetro do evento — o significado depende do `code`. Ver acima. */
  value?: string | number;
}

/**
 * Linha do log já no buffer, com `id` monotônico.
 *
 * O `id` é o que permite ao `<ChaosTerminal />` imprimir só o que ainda não
 * viu — comparar conteúdo falharia com eventos repetidos legítimos (a mesma
 * carta jogada duas vezes na mesma casa em rodadas diferentes).
 */
export interface LogEntry extends LogPayload {
  id: number;
}

/* -------------------------------------------------------------------------- */
/*                                   AVISOS                                    */
/* -------------------------------------------------------------------------- */

/** Cor do toast: ganho do jogador, prejuízo do jogador, ou neutro. */
export type NoticeTone = 'GOOD' | 'BAD' | 'NEUTRAL';

/**
 * Aviso efêmero, emitido junto com o log quando o fato merece um toast.
 *
 * Reusa o mesmo vocabulário `LogCode` de propósito: o toast e a linha do log
 * descrevem o MESMO fato, com formatações diferentes (curta e maiúscula
 * contra longa e corrida). Dois vocabulários paralelos garantiriam que um dia
 * eles discordassem entre si.
 *
 * `tone` é opcional no payload porque muitas vezes ele é derivável da
 * perspectiva (roubar é bom para quem rouba, ruim para quem perde) — quando
 * omitido, o tradutor decide.
 */
export interface NoticePayload extends LogPayload {
  tone?: NoticeTone;
}

/** Aviso já publicado, com `id` monotônico (mesma razão do `LogEntry`). */
export interface Notice extends LogPayload {
  id: number;
  tone: NoticeTone;
}
