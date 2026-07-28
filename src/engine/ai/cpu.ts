import { TRAP_CARD_IDS } from '@/engine/cards/registry';
import { getChannel } from '@/engine/rng';
import {
  HAND_LIMIT,
  INITIAL_HP,
  MARK_BY_COMBATANT,
  TRAP_LIMIT,
  findWinner,
  getOldestPieceIndex,
  handKeyFor,
  hpOf,
  trapsKeyFor,
  type Board,
  type Combatant,
  type GameState,
} from '@/engine/rules';
import type { CardId } from '@/engine/cards/definitions';

/* -------------------------------------------------------------------------- */
/*                                    TIPOS                                    */
/* -------------------------------------------------------------------------- */

/** Por que a CPU escolheu a jogada. Vai para o log de combate. */
export type CpuReason = 'WIN' | 'BLOCK' | 'POSITIONAL';

export interface CpuDecision {
  index: number;
  reason: CpuReason;
}

/**
 * Só o que a IA precisa do store.
 *
 * Interface mínima em vez de receber a store inteira: a IA não deve conseguir
 * comprar cartas, mudar regra ou aplicar dano — e o compilador garante isso.
 */
export interface CpuActions {
  placeMark: (index: number) => void;
  /** Resolve a partir da mão da máquina. A IA nunca toca na mão do Player. */
  playCard: (uid: string, targetIndex?: number) => boolean;
}

/** Token de cancelamento cooperativo. O React vira `cancelled = true` no cleanup. */
export interface CpuSignal {
  cancelled: boolean;
}

export interface CpuOptions {
  signal?: CpuSignal;
  /** Estado fresco no momento de agir. Sem isto a CPU decide com dados velhos. */
  getState?: () => GameState;
  minDelay?: number;
  maxDelay?: number;
  /**
   * No desempate, prefere centro > cantos > bordas em vez de sortear entre
   * todas as células. Desligue para uma CPU mais fraca.
   */
  positionalBias?: boolean;
}

/* -------------------------------------------------------------------------- */
/*                                  CONSTANTES                                 */
/* -------------------------------------------------------------------------- */

const CPU: Combatant = 'MACHINE';
const HUMAN: Combatant = 'PLAYER';

const DEFAULT_MIN_DELAY = 800;
const DEFAULT_MAX_DELAY = 1500;

/**
 * Células por valor posicional decrescente.
 *
 * No jogo da velha clássico o centro participa de 4 linhas, cantos de 3 e
 * bordas de 2. A regra do infinito não muda essa contagem.
 */
const POSITION_TIERS: readonly (readonly number[])[] = [
  [4], // centro
  [0, 2, 6, 8], // cantos
  [1, 3, 5, 7], // bordas
];

/* -------------------------------------------------------------------------- */
/*                                  SIMULAÇÃO                                  */
/* -------------------------------------------------------------------------- */

/**
 * Aplica uma jogada hipotética e devolve o tabuleiro resultante, ou `null` se
 * a jogada for ilegal.
 *
 * ⚠️ **Reproduz a regra do infinito.** Uma simulação ingênua que só escreve a
 * peça no índice erra o caso decisivo: se a CPU já tem 3 peças, posicionar a
 * quarta **remove a mais antiga** — e se essa peça fizer parte da linha que ela
 * pretendia fechar, a jogada não vence. Sem isto a CPU "ganha" no papel e
 * depois joga em cima do próprio pé.
 *
 * Sob `RANDOM_FADE` a peça sacrificada é sorteada no instante da jogada, então
 * é impossível prever. A simulação assume a mais antiga como palpite — a CPU
 * joga um pouco pior nessa regra, o que é honesto: ninguém consegue planejar
 * contra sorteio.
 */
function simulate(state: GameState, owner: Combatant, index: number): Board | null {
  if (index < 0 || index > 8) return null;
  if (state.board[index] !== null) return null;
  if (state.activeRule === 'BLOCKED_CELL' && state.blockedCell === index) return null;

  const board = [...state.board];

  const doomed = getOldestPieceIndex(board, owner); // puro: não consome RNG
  if (doomed !== null) board[doomed] = null;

  board[index] = {
    owner,
    mark: MARK_BY_COMBATANT[owner],
    turnPlaced: state.turnCount,
  };

  return board;
}

/** Índices onde `owner` pode legalmente jogar agora. */
function legalMoves(state: GameState): number[] {
  const out: number[] = [];
  for (let i = 0; i < 9; i++) {
    if (state.board[i] !== null) continue;
    if (state.activeRule === 'BLOCKED_CELL' && state.blockedCell === i) continue;
    out.push(i);
  }
  return out;
}

/** Primeira jogada de `owner` que fecha uma linha, ou `null`. */
function findWinningMove(state: GameState, owner: Combatant, moves: number[]): number | null {
  for (const index of moves) {
    const board = simulate(state, owner, index);
    if (!board) continue;
    if (findWinner(board)?.winner === owner) return index;
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/*                                CARTAS DA CPU                                */
/* -------------------------------------------------------------------------- */

export interface CpuCardPlay {
  uid: string;
  cardId: CardId;
  targetIndex?: number;
}

/**
 * Escolhe (no máximo) UMA carta para a CPU jogar antes de mover no tabuleiro.
 *
 * Heurística simples e determinística (só consome RNG onde há empate real:
 * escolher qual armadilha armar, se o SAQUE vale a pena, alvo do TRAVAR).
 * Prioridade fixa, primeira que se aplica vence — nenhuma prevê o futuro além
 * de "o oponente tem 3 peças" (para o alvo do DEMOLIR).
 *
 * Limitar a uma carta por turno é o que mantém isto "simples": nada impede
 * cartas futuras de se acumularem — a CPU só age quando alguma regra abaixo
 * casa, senão guarda a mão para o próximo turno.
 */
export function chooseCpuCardPlay(state: GameState): CpuCardPlay | null {
  const hand = state[handKeyFor(CPU)];
  const find = (id: CardId) => hand.find((c) => c.cardId === id);
  const rng = getChannel('AI');

  // 1. Cura crítica — sobreviver vem antes de qualquer outra jogada.
  const heal = find('HEAL_SELF');
  if (heal && hpOf(state, CPU) <= 2) return { uid: heal.uid, cardId: heal.cardId };

  // 2. Possível abate — se o dano fecha a partida, é sempre a melhor jogada.
  const attack = find('DIRECT_DAMAGE');
  if (attack && hpOf(state, HUMAN) <= 2) return { uid: attack.uid, cardId: attack.cardId };

  // 3. Remove a própria interdição antes de tentar jogar no tabuleiro.
  const cleanse = find('CLEANSE');
  if (cleanse && state.activeRule === 'BLOCKED_CELL') {
    return { uid: cleanse.uid, cardId: cleanse.cardId };
  }

  // 4. Turno extra é sempre bom e nunca tem alvo — sem desvantagem em usar.
  const extra = find('EXTRA_TURN');
  if (extra && state.extraTurnPending !== CPU) return { uid: extra.uid, cardId: extra.cardId };

  // 5. Arma a primeira armadilha disponível, se sobrar espaço na mesa.
  if (state[trapsKeyFor(CPU)].length < TRAP_LIMIT) {
    const trap = hand.find((c) => TRAP_CARD_IDS.includes(c.cardId));
    if (trap) return { uid: trap.uid, cardId: trap.cardId };
  }

  // 6. Demolir a peça mais velha do HUMANO, só quando ele já tem 3 no
  // tabuleiro (senão a carta só abriria espaço de graça para ele).
  const breakPiece = find('BREAK_PIECE');
  if (breakPiece) {
    const target = getOldestPieceIndex(state.board, HUMAN);
    if (target !== null) return { uid: breakPiece.uid, cardId: breakPiece.cardId, targetIndex: target };
  }

  // 7. Saque oportunista — só incomoda se o oponente tiver o que perder.
  const raid = find('HAND_RAID');
  if (raid && state[handKeyFor(HUMAN)].length > 0 && rng.chance(0.5)) {
    return { uid: raid.uid, cardId: raid.cardId };
  }

  // 8. Trava uma célula vazia aleatória — disrupção de baixo custo.
  const lock = find('LOCK_CELL');
  if (lock) {
    const empty = state.board.map((cell, i) => (cell === null ? i : -1)).filter((i) => i !== -1);
    if (empty.length > 0) return { uid: lock.uid, cardId: lock.cardId, targetIndex: rng.pick(empty) };
  }

  // 9. Informação de baixo custo, quando nada mais se aplicou ainda.
  const reveal = find('REVEAL_OLDEST');
  if (reveal && getOldestPieceIndex(state.board, HUMAN) !== null) {
    return { uid: reveal.uid, cardId: reveal.cardId };
  }

  // 10. Cura não-crítica — melhor que deixar a carta parada na mão.
  if (heal) return { uid: heal.uid, cardId: heal.cardId };

  // 11. Compra por último: preenche a mão quando nada mais se aplica.
  const draw = find('DRAW_CARD');
  if (draw && hand.length < HAND_LIMIT) return { uid: draw.uid, cardId: draw.cardId };

  // 12. Troca de mãos é alto risco (pode devolver cartas melhores ao
  // oponente) — só ocasionalmente, nunca como prioridade.
  const swap = find('HAND_SWAP');
  if (swap && rng.chance(0.15)) return { uid: swap.uid, cardId: swap.cardId };

  return null;
}

/* -------------------------------------------------------------------------- */
/*                                   DECISÃO                                   */
/* -------------------------------------------------------------------------- */

/**
 * Escolhe a jogada da CPU. **Determinística dada a seed** — consome o canal
 * `AI` do RNG apenas no desempate.
 *
 * Hierarquia:
 * 1. **Vencer** — fecha a linha se puder;
 * 2. **Bloquear** — ocupa a célula onde o humano venceria na jogada seguinte;
 * 3. **Posicional** — sorteia dentro do melhor grupo de células disponível.
 */
export function chooseCpuMove(state: GameState, positionalBias = true): CpuDecision | null {
  const moves = legalMoves(state);
  if (moves.length === 0) return null;

  // --- 1. Vitória ---------------------------------------------------------
  const winning = findWinningMove(state, CPU, moves);
  if (winning !== null) return { index: winning, reason: 'WIN' };

  // --- 2. Bloqueio --------------------------------------------------------
  // Simula o HUMANO jogando em cada célula. Se ele venceria ali, a CPU ocupa
  // a célula primeiro. A simulação usa a regra de sumiço DELE, que pode
  // invalidar a ameaça — outra armadilha que a simulação ingênua não pega.
  const threat = findWinningMove(state, HUMAN, moves);
  if (threat !== null) return { index: threat, reason: 'BLOCK' };

  // --- 3. Posicional ------------------------------------------------------
  const rng = getChannel('AI');

  if (positionalBias) {
    for (const tier of POSITION_TIERS) {
      const available = tier.filter((index) => moves.includes(index));
      if (available.length > 0) {
        return { index: rng.pick(available), reason: 'POSITIONAL' };
      }
    }
  }

  return { index: rng.pick(moves), reason: 'POSITIONAL' };
}

/* -------------------------------------------------------------------------- */
/*                                   TURNO                                     */
/* -------------------------------------------------------------------------- */

/**
 * Executa o turno da máquina.
 *
 * O atraso vem antes da decisão, não depois: durante 800–1500ms o estado pode
 * mudar (rodada terminou, partida reiniciou, jogador saiu da tela). Decidir
 * com o estado de antes do atraso produziria jogadas em tabuleiros que já não
 * existem. Por isso relê o estado via `getState` e revalida tudo.
 *
 * @returns a decisão tomada, ou `null` se o turno foi abortado.
 */
export async function playCPUTurn(
  state: GameState,
  actions: CpuActions,
  options: CpuOptions = {},
): Promise<CpuDecision | null> {
  const {
    signal,
    getState,
    minDelay = DEFAULT_MIN_DELAY,
    maxDelay = DEFAULT_MAX_DELAY,
    positionalBias = true,
  } = options;

  // Atraso do canal `AI`: determinístico junto com o resto da partida, e
  // sempre uma extração por turno — a ordem de consumo não varia.
  const delay = getChannel('AI').int(minDelay, maxDelay);
  await new Promise<void>((resolve) => setTimeout(resolve, delay));

  if (signal?.cancelled) return null;

  let fresh = getState ? getState() : state;

  // Revalidação pós-atraso. Cada guarda cobre um caso real de corrida:
  if (fresh.status !== 'PLAYING') return null; // rodada acabou nesse meio-tempo
  if (fresh.turn !== CPU) return null; // armadilha ou carta devolveu a vez
  if (fresh.pendingAction !== null) return null; // humano está mirando

  /* --- Cartas antes do tabuleiro -------------------------------------------
     No máximo uma por turno (ver `chooseCpuCardPlay`). A mensagem de log já
     sai de graça: `playCard`/`playMachineCard` chamam `pushLog` com a
     `message` do efeito, então nenhuma plumbing extra é necessária aqui.    */
  const cardPlay = chooseCpuCardPlay(fresh);
  if (cardPlay) {
    const played = actions.playCard(cardPlay.uid, cardPlay.targetIndex);

    if (played) {
      // Releitura obrigatória: a carta pode ter mudado HP, mão, regra ou até
      // encerrado a rodada — decidir a jogada de tabuleiro com dados velhos
      // arriscaria jogar num estado que já não existe mais.
      fresh = getState ? getState() : fresh;
      if (fresh.status !== 'PLAYING' || fresh.turn !== CPU || fresh.pendingAction !== null) {
        return null;
      }
    }
  }

  const decision = chooseCpuMove(fresh, positionalBias);
  if (!decision) return null;

  actions.placeMark(decision.index);
  return decision;
}

/* -------------------------------------------------------------------------- */
/*                                   FORMATO                                   */
/* -------------------------------------------------------------------------- */

const REASON_LABEL: Record<CpuReason, string> = {
  WIN: 'fecha linha',
  BLOCK: 'bloqueia',
  POSITIONAL: 'avança',
};

/** Linha de log legível para o ChaosTerminal. */
export function describeCpuMove({ index, reason }: CpuDecision): string {
  const row = Math.floor(index / 3) + 1;
  const col = (index % 3) + 1;
  return `cpu :: ${REASON_LABEL[reason]} em ${row}x${col}`;
}
