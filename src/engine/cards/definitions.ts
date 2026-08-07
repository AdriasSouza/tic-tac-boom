import type { GameEvent } from '@/engine/events';
import type { Rng } from '@/engine/rng';
// `import type` é obrigatório aqui: `rules.ts` importa `CardDefinition` deste
// arquivo, e este arquivo importa `GameState` de lá. Com `import type` o
// TypeScript apaga as duas linhas na compilação e não sobra ciclo em runtime.
import type {
  AcknowledgementCode,
  AcknowledgementKind,
  Combatant,
  GameState,
  InteractionSelection,
} from '@/engine/rules';
import type { LogPayload, NoticePayload } from '@/engine/log';

/* -------------------------------------------------------------------------- */
/*                                    TIPOS                                    */
/* -------------------------------------------------------------------------- */

/**
 * Identificadores de carta.
 *
 * União literal em vez de `string`: o `Record<CardId, CardDefinition>` do
 * registry passa a ser verificado por exaustividade — esquecer de registrar
 * uma carta nova vira erro de compilação, não bug em runtime.
 */
export type CardId =
  | 'BREAK_PIECE'
  | 'TURNO_EXTRA'
  | 'BOMB_TRAP'
  | 'HEAL_SELF'
  | 'DIRECT_DAMAGE'
  | 'STUDY'
  | 'STUDY_II'
  | 'HAND_RAID'
  | 'CLEANSE'
  | 'CLEAR_BLOCK'
  | 'OBSOLESCENCE'
  | 'LOCK_CELL'
  | 'SHIELD_TRAP'
  | 'SABOTAGE'
  | 'PEEK_RANDOM'
  | 'HAND_SWAP'
  | 'FULL_INTEL'
  | 'CHAOS_ROULETTE'
  | 'ALTAR_OF_SACRIFICE'
  | 'HIGHLIGHT_OLDEST'
  | 'QUEUE_SHUFFLE'
  | 'ANTI_SPELL_TRAP'
  | 'REFLECT_TRAP'
  | 'REBOBINAR'
  | 'HAND_RAID_II'
  | 'SINGLE_CARD_TRADE'
  | 'INTEL_REVEAL'
  | 'CARD_DRAFT'
  | 'CARD_DRAFT_TIERED';

/**
 * - `ACTION`  — resolve imediatamente ao ser jogada.
 * - `TRAP`    — vai virada para a mesa e dispara quando o oponente cumpre
 *               `triggerCondition`.
 * - `COUNTER` — jogável fora do próprio turno, para anular outra carta.
 *
 * `COUNTER` ainda não tem implementação; permanece no tipo porque exige uma
 * janela de reação no fluxo de turno, e reservar o nome evita renomeação
 * depois.
 */
export type CardType = 'ACTION' | 'TRAP' | 'COUNTER';

/* -------------------------------------------------------------------------- */
/*                                  RARIDADE                                   */
/* -------------------------------------------------------------------------- */

/**
 * Faixa de raridade da carta. Define a chance de ela sair numa compra E a
 * intenção de design por trás dela (ver `RARITY_DRAW_WEIGHT`):
 *
 * - `COMMON`    — o pilar do jogo. Controle de tabuleiro (bloquear, limpar,
 *                 demolir): mantém a disputa tática do "jogo da velha" viva.
 * - `RARE`      — vantagem tática. Manipulação de mão, compra extra, roubo,
 *                 espionagem.
 * - `EPIC`      — impacto direto. Dano, cura, pular turno — taxa baixa de
 *                 propósito, para o jogo não virar um tiroteio de HP.
 * - `LEGENDARY` — pesada e punitiva, capaz de virar a partida de uma vez.
 * - `BOOM`      — caos puro, quebra as regras provisoriamente. Ainda SEM
 *                 cartas registradas — ver a nota em `RARITY_DRAW_WEIGHT`.
 */
export type CardRarity = 'COMMON' | 'RARE' | 'EPIC' | 'LEGENDARY' | 'BOOM';

/**
 * Chance de a COMPRA cair em cada faixa, em pontos percentuais.
 *
 * O sorteio é em dois estágios (faixa primeiro, carta depois) de propósito:
 * com um pool único ponderado carta a carta, a frequência de cada faixa
 * dependeria de QUANTAS cartas existem nela — acrescentar uma armadilha nova
 * aumentaria silenciosamente a chance de sair armadilha. Foi exatamente esse
 * efeito que fazia a mão da CPU virar um paredão de armadilhas. Sorteando a
 * faixa primeiro, estes 50/25/15/6/4 valem sempre, independente do tamanho
 * do deck.
 *
 * `BOOM` ainda não tem nenhuma carta no registry (chega numa etapa futura).
 * `drawCardId` descarta faixas vazias antes de sortear (ver `RARITY_POOL`),
 * então os 4% de `BOOM` hoje são redistribuídos proporcionalmente entre as
 * outras quatro — não é um bug, é a mesma rede de segurança que já existia
 * para "um deck sem lendárias não deveria derrubar o jogo".
 */
export const RARITY_DRAW_WEIGHT: Record<CardRarity, number> = {
  COMMON: 50,
  RARE: 25,
  EPIC: 15,
  LEGENDARY: 6,
  BOOM: 4,
};

/** Rótulo exibido na UI. */
export const RARITY_LABEL: Record<CardRarity, string> = {
  COMMON: 'COMUM',
  RARE: 'RARA',
  EPIC: 'ÉPICA',
  LEGENDARY: 'LENDÁRIA',
  BOOM: 'BOOM!',
};

/** O que a carta exige como alvo antes de poder ser jogada. */
export type CardTargeting =
  /** Sem alvo — joga direto. */
  | 'NONE'
  /** Qualquer célula do tabuleiro. */
  | 'CELL'
  /** Uma célula ocupada (por qualquer um). */
  | 'OCCUPIED_CELL';

/** Contexto da checagem de alvo. Sem RNG: precisa ser puro para a UI consumir. */
export interface CardTargetContext {
  readonly state: GameState;
  readonly caster: Combatant;
  /** Célula candidata (0..8). */
  readonly index: number;
}

/** Contexto entregue ao efeito. Somente leitura — o efeito não muta nada. */
export interface CardEffectContext {
  /** Snapshot do estado no instante do uso. */
  readonly state: GameState;
  /** Quem jogou a carta. */
  readonly caster: Combatant;
  /**
   * `uid` da carta sendo resolvida.
   *
   * Necessário para efeitos que reescrevem a MÃO inteira do caster (SAQUE,
   * TROCA): eles precisam excluir a própria carta jogada do resultado, e o
   * `uid` é a única forma de identificar exatamente qual entrada é essa —
   * `cardId` sozinho não basta quando a mão tem duplicatas.
   */
  readonly uid: string;
  /** Alvo escolhido na UI. `undefined` quando a carta foi jogada sem mira. */
  readonly targetIndex?: number;
  /**
   * Evento que disparou o efeito. Presente **apenas** em armadilhas — dá ao
   * efeito acesso ao contexto do gatilho (qual casa, quem jogou).
   */
  readonly event?: GameEvent;
  /** Canal `CARDS` do RNG — determinístico e isolado dos outros sistemas. */
  readonly rng: Rng;
  /**
   * Presente SÓ ao resolver um passo de uma `PendingInteraction` já aberta
   * (2ª+ chamada de `effect` para a MESMA jogada de carta) — ausente na 1ª
   * chamada. `effect` é a SUA PRÓPRIA continuação: quando este campo está
   * presente, ele decide se já tem tudo que precisa (devolve um resultado
   * normal) ou se quer mais um passo (devolve `interaction` de novo, com um
   * `kind` possivelmente diferente do anterior — é assim que uma carta de
   * múltiplos passos, tipo "escolha 1 sua, depois 1 do oponente", funciona
   * sem precisar de uma função separada nem de um `kind` de composição).
   */
  readonly interaction?: {
    /** A escolha feita no passo que acabou de resolver. */
    readonly selection: InteractionSelection;
    /** Escolhas de passos ANTERIORES da mesma jogada, em ordem. */
    readonly priorSelections: readonly InteractionSelection[];
  };
}

/**
 * Resultado de um efeito.
 *
 * O efeito **não** chama o store: devolve um patch declarativo e o `playCard`
 * aplica. Isso mantém `effect` como função pura, testável sem montar React
 * nem instanciar Zustand.
 */
export interface CardEffectResult {
  /** Campos do estado a sobrescrever. */
  patch?: Partial<GameState>;
  /**
   * Dano a aplicar depois do patch.
   *
   * Existe como campo próprio, e não como `patch: { playerHp }`, porque HP
   * tem regra própria (clamp em 0, fim de partida, animação do HUD). Deixar
   * a carta escrever HP direto duplicaria essa lógica em cada efeito novo.
   */
  damage?: { target: Combatant; amount: number };
  /**
   * Cura a aplicar depois do patch. Mesma razão de existir de `damage`: HP
   * tem regra própria (clamp em `INITIAL_HP`, animação do HUD).
   */
  heal?: { target: Combatant; amount: number };
  /**
   * Compra adicional a processar depois do patch. Um efeito não pode chamar
   * `drawCard` diretamente (permaneceria impuro), então declara a intenção
   * aqui e o store executa via o canal `CARDS` do RNG.
   */
  draw?: { target: Combatant; count: number };
  /**
   * `true` quando este efeito é de uma TRAP de contra-ataque e a carta do
   * oponente NÃO deve resolver. Só tem sentido dentro de
   * `resolveCounterTraps` — cartas normais nunca devem setar isto.
   */
  cancelsAction?: boolean;
  /** `true` faz a carta gastar o turno do jogador. Padrão: `false`. */
  consumesTurn?: boolean;
  /**
   * `true` dispara um surto de caos ao final da aplicação — mesma "roleta"
   * automática do relógio global (`triggerTerminalGlitch`), só que provocada
   * pelo jogador em vez do turno global. Declarativo como os demais campos:
   * o efeito não pode chamar `triggerTerminalGlitch()` ele mesmo (não é uma
   * função pura), então só sinaliza a intenção e o store decide quando/como.
   */
  triggersChaosGlitch?: boolean;
  /**
   * `true` abre o `<AltarModal />` para o CASTER escolher 2 cartas a
   * sacrificar. Mesma razão declarativa de `triggersChaosGlitch`: abrir um
   * modal é decisão de apresentação, e o efeito só sinaliza a intenção — quem
   * decide QUANDO/COMO mostrar é o store (`lastAltarPrompt`) e a UI que o
   * observa.
   *
   * O sacrifício em si (`sacrificeCards`) é uma ação PRÓPRIA, publicada só no
   * clique de "Confirmar" — nunca parte do resultado desta carta, porque a
   * escolha de quais cartas ainda não existe no instante em que o efeito
   * roda.
   */
  opensAltar?: boolean;
  /**
   * Fato a registrar no log de combate.
   *
   * Um EVENTO, não uma frase: a carta descreve o que aconteceu em termos
   * absolutos (`{ code: 'CARD_HEAL', subject: caster }`) e quem escolhe as
   * palavras — inclusive se o `subject` vira "você" ou "o oponente" — é a
   * camada de apresentação. Ver `src/engine/log.ts`.
   */
  log?: LogPayload;
  /**
   * Pausa o jogo com um modal de confirmação ("Entendi") mostrando esta
   * informação, antes do jogador poder agir de novo.
   *
   * Diferente de `damage`/`heal`/`draw` (que adiam um efeito MECÂNICO), isto
   * não adia nada — o efeito da carta (revelar) já aconteceu. Existe só para
   * garantir que o jogador realmente LEIA o que foi descoberto antes de
   * seguir jogando. Usado por cartas de espionagem.
   *
   * Semântico, como `log`/`notice`: a carta diz O QUE revelou e de quem, e a
   * apresentação escreve "MÃO DO RIVAL" ou "MÃO DA CPU" conforme quem está
   * segurando o aparelho.
   */
  acknowledge?: {
    code: AcknowledgementCode;
    /** Padrão `INFO`. `SPY_PICK`/`INTEL_FLIP` viram cartas com o dedo. */
    kind?: AcknowledgementKind;
    subject: Combatant;
    /** Dono da mão revelada / alvo do efeito. */
    target?: Combatant;
    cardId?: CardId;
    /** Cartas exibidas viradas para baixo (espionagem) ou em miniatura. */
    revealedCards?: CardId[];
  };
  /**
   * Toast efêmero sobre o tabuleiro. **Não pausa o jogo** — é para o jogador
   * VER um fato que o afeta sem ter que ler o log do terminal.
   *
   * Separado de `log` (que vai para o histórico do terminal) porque as duas
   * coisas têm públicos diferentes: o log é consulta, o toast é alerta. Mas
   * compartilham o mesmo vocabulário de `LogCode`, então os dois nunca podem
   * discordar sobre o que aconteceu — só sobre quanto texto usar para dizê-lo.
   */
  notice?: NoticePayload;
  /**
   * Em vez de resolver agora, pede uma escolha do jogador — o motor abre uma
   * `PendingInteraction` (`rules.ts`) e pausa até ela chegar. Quando chegar,
   * `effect` é chamado DE NOVO, com `context.interaction` preenchido (ver lá)
   * — não existe uma função `resolveInteraction` separada por carta.
   *
   * Exclusivo com todos os outros campos deste resultado: uma carta que pede
   * interação não aplica patch/dano/etc. NESTA chamada — só quando `effect`
   * devolver um resultado SEM `interaction`.
   */
  interaction?: PendingInteractionRequest;
}

/**
 * O que uma carta pode PEDIR ao abrir uma interação — sem os campos que só o
 * STORE sabe preencher (`caster`/`cardId`/`cardUid`/`handIndex`/
 * `priorSelections`, ver `PendingInteraction` em `rules.ts`).
 *
 * `BOARD_TARGET` não aparece aqui de propósito: ele nunca nasce de um
 * `effect()` — só o próprio motor de resolução de carta o abre, para cartas
 * `requiresTarget` sem alvo ainda escolhido. Ver o comentário de
 * `PendingInteraction` em `rules.ts` para o porquê dessa assimetria (cartas
 * `requiresTarget` existentes leem `targetIndex` direto do contexto; não
 * têm como decidir "preciso de alvo" ANTES de já ter um).
 */
export type PendingInteractionRequest =
  | { kind: 'PICK_ONE_FROM_HAND'; source: Combatant; optionUids: readonly string[] }
  | {
      kind: 'PICK_MANY_FROM_HAND';
      source: Combatant;
      optionUids: readonly string[];
      count: number;
    }
  | { kind: 'PICK_ONE_REVEALED'; options: readonly CardId[] }
  | { kind: 'SACRIFICE_DRAG'; eligibleUids: readonly string[]; count: number };

/** Retornar `null` significa "jogada inválida" — a carta volta para a mão. */
export type CardEffect = (context: CardEffectContext) => CardEffectResult | null;

export interface CardDefinition {
  id: CardId;
  name: string;
  type: CardType;
  description: string;
  targeting: CardTargeting;
  /** Faixa de raridade — decide a chance de a carta sair numa compra. */
  rarity: CardRarity;
  /**
   * Peso relativo **dentro da própria faixa de raridade**.
   *
   * Não é mais o peso global: a faixa é sorteada antes (ver
   * `RARITY_DRAW_WEIGHT`) e só então este peso desempata entre as cartas
   * daquela faixa.
   */
  weight: number;
  /**
   * Custo em ⚡ para jogar. Debitado da energia do `caster` em
   * `resolveCardPlay` ANTES de qualquer efeito rodar — uma carta sem energia
   * suficiente aborta como qualquer outra jogada inválida, sem consumir nada.
   *
   * Vale para TRAPs também (armar uma armadilha custa): o motor não distingue
   * "gastar energia para armar" de "gastar energia para resolver na hora".
   */
  cost: number;

  /**
   * A carta entra em **modo mira** ao ser jogada: em vez de resolver na hora,
   * fica pendente até o jogador tocar numa célula válida.
   */
  requiresTarget?: boolean;

  /**
   * A célula é um alvo legal para esta carta?
   *
   * **Deve ser pura e determinística** — roda dentro de seletor do Zustand
   * (uma vez por célula, a cada mudança de estado) para acender o destaque no
   * tabuleiro. Nada de RNG aqui.
   *
   * Omitir com `requiresTarget: true` significa "qualquer célula serve".
   */
  isValidTarget?: (context: CardTargetContext) => boolean;

  /**
   * Pré-condição barata, avaliada antes do efeito. Serve para a UI esmaecer
   * cartas injogáveis sem precisar simular o efeito.
   */
  canPlay?: (context: Omit<CardEffectContext, 'rng'>) => boolean;

  /**
   * Gatilho da armadilha (`type: 'TRAP'`).
   *
   * O barramento só consulta armadilhas do **oponente** de quem causou o
   * evento, então aqui não é preciso checar autoria — só a condição em si.
   *
   * **Deve ser pura**: roda a cada evento, para cada armadilha armada.
   * Uma carta `TRAP` sem `triggerCondition` nunca dispara.
   */
  triggerCondition?: (event: GameEvent, state: GameState) => boolean;

  /**
   * Esta carta LÊ ou RETIRA cartas da mão do oponente? Categoria consultada
   * pelo `triggerCondition` de PROTEÇÃO — por CATEGORIA, não por lista fixa de
   * ids, para uma carta nova desta família ser coberta automaticamente (ver
   * `docs/CARTAS.md`, entrada de PROTEÇÃO: uma lista enumerada "apodrece").
   */
  readsOrRemovesFromHand?: boolean;

  /**
   * Esta carta é um efeito direcionado ao OPONENTE ou aos recursos dele (mão,
   * HP, peças, fila)? Categoria consultada pelo `triggerCondition` de
   * RICOCHETE — mesma razão de `readsOrRemovesFromHand`. Não decide SOZINHA
   * se o efeito é invertido ou só anulado ao disparar — isso é por carta (ver
   * `RICOCHET_INVERSIONS` em `registry.ts`); esta tag só decide se RICOCHETE
   * dispara.
   */
  targetsOpponentResource?: boolean;

  effect: CardEffect;
}

/* Consultas de domínio (`occupiedIndexes`, `opponentOf`, …) vivem em
   `@/engine/rules`. Este arquivo é só o contrato das cartas — mantê-lo sem
   valores em runtime é o que impede ciclo com `rules.ts`. */
