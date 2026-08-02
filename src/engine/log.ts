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
  /** Armadilha de `subject` anulou um SAQUE ou uma ESPIONAGEM. */
  | 'TRAP_SHIELD'
  /** A MINA de `subject` detonou no centro. */
  | 'TRAP_BOMB'

  /* --- Cartas ------------------------------------------------------------- */
  /** `subject` destruiu uma peça. `value` = índice. */
  | 'CARD_BREAK_PIECE'
  /** `subject` fez o oponente perder a próxima jogada dele. */
  | 'CARD_EXTRA_TURN'
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
  /** `subject` liberou uma célula interditada. `value` = índice. */
  | 'CARD_CLEANSE'
  /** `subject` trocou uma carta com `target`. `value` = `CardId` que `subject` cedeu. */
  | 'CARD_TRADE'
  /** `subject` marcou uma peça de `target` para ser destruída no início do turno dele. `value` = índice. */
  | 'CARD_MARK_DOOMED'
  /** A peça marcada pelo VIDENTE foi destruída ao começar o turno de `subject` (o dono dela). `value` = índice. */
  | 'CARD_DOOM_TRIGGERED'
  /** `subject` lacrou uma célula. `value` = índice. */
  | 'CARD_LOCK_CELL'
  /** `subject` espiou uma carta aleatória de `target`. `value` = `CardId`. */
  | 'CARD_SPY_PEEK'
  /** `subject` revelou e descartou uma carta de `target`. `value` = `CardId` descartada. */
  | 'CARD_SPY_DISCARD'
  /** `subject` leu a mão inteira de `target`. `value` = nº de cartas. */
  | 'CARD_INTEL_HAND'
  /** `subject` disparou a roleta do caos. */
  | 'CARD_CHAOS_ROULETTE'
  /** `subject` abriu o Altar de Sacrifício (a escolha das cartas acontece depois, fora do motor). */
  | 'CARD_ALTAR_OPENED';

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
