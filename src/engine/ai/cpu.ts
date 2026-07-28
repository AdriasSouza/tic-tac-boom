import { getChannel } from '@/engine/rng';
import {
  MARK_BY_COMBATANT,
  findWinner,
  getOldestPieceIndex,
  type Board,
  type Combatant,
  type GameState,
} from '@/engine/rules';

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

  const fresh = getState ? getState() : state;

  // Revalidação pós-atraso. Cada guarda cobre um caso real de corrida:
  if (fresh.status !== 'PLAYING') return null; // rodada acabou nesse meio-tempo
  if (fresh.turn !== CPU) return null; // armadilha ou carta devolveu a vez
  if (fresh.pendingAction !== null) return null; // humano está mirando

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
