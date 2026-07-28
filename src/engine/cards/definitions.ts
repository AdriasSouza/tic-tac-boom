import type { GameEvent } from '@/engine/events';
import type { Rng } from '@/engine/rng';
// `import type` é obrigatório aqui: `rules.ts` importa `CardDefinition` deste
// arquivo, e este arquivo importa `GameState` de lá. Com `import type` o
// TypeScript apaga as duas linhas na compilação e não sobra ciclo em runtime.
import type { Combatant, GameState } from '@/engine/rules';

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
  | 'EXTRA_TURN'
  | 'BOMB_TRAP'
  | 'HEAL_SELF'
  | 'DIRECT_DAMAGE'
  | 'DRAW_CARD'
  | 'HAND_RAID'
  | 'CLEANSE'
  | 'HAND_SWAP'
  | 'REVEAL_OLDEST'
  | 'LOCK_CELL'
  | 'SHIELD_TRAP'
  | 'COUNTER_TRAP'
  | 'SPY_CARD'
  | 'FULL_INTEL'
  | 'MIND_SHIELD_TRAP';

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
  /** Linha a imprimir no ChaosTerminal. */
  message?: string;
  /**
   * Pausa o jogo com um modal de confirmação ("Entendi") mostrando esta
   * informação, antes do jogador poder agir de novo.
   *
   * Diferente de `damage`/`heal`/`draw` (que adiam um efeito MECÂNICO), isto
   * não adia nada — o efeito da carta (revelar) já aconteceu. Existe só para
   * garantir que o jogador realmente LEIA o que foi descoberto antes de
   * seguir jogando. Usado por cartas de espionagem.
   */
  acknowledge?: {
    subtitle: string;
    title: string;
    description: string;
    /** Cartas a listar além da principal — só Visão Absoluta usa isso hoje. */
    revealedCards?: CardId[];
  };
}

/** Retornar `null` significa "jogada inválida" — a carta volta para a mão. */
export type CardEffect = (context: CardEffectContext) => CardEffectResult | null;

export interface CardDefinition {
  id: CardId;
  name: string;
  type: CardType;
  description: string;
  targeting: CardTargeting;
  /** Peso relativo no sorteio de `drawCard` (via `rng.weighted`). */
  weight: number;

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

  effect: CardEffect;
}

/* Consultas de domínio (`occupiedIndexes`, `opponentOf`, …) vivem em
   `@/engine/rules`. Este arquivo é só o contrato das cartas — mantê-lo sem
   valores em runtime é o que impede ciclo com `rules.ts`. */
