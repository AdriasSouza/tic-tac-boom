import { TRAP_CARD_IDS, getCard } from '@/engine/cards/registry';
import { getChannel } from '@/engine/rng';
import {
  HAND_LIMIT,
  INITIAL_HP,
  MARK_BY_COMBATANT,
  MAX_PIECES_PER_PLAYER,
  TRAP_LIMIT,
  adjacentIndexes,
  energyKeyFor,
  findWinner,
  getOldestPieceIndex,
  getPieceIndexes,
  handKeyFor,
  hpOf,
  isCellUnavailable,
  opponentOf,
  shieldKeyFor,
  trapsKeyFor,
  WIN_LINES,
  type Board,
  type Combatant,
  type GameState,
  type InteractionSelection,
  type PendingInteraction,
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
  /** Passa a vez sem colocar peça — plano B quando `chooseCpuMove` não decide nada. */
  endTurn: () => void;
  /**
   * Resolve o passo atual de uma `pendingInteraction` da PRÓPRIA CPU (SAQUE/
   * SABOTAGEM, Fase 4 — ver `resolveCpuInteraction`). Nunca chamada para uma
   * interação de outro combatente.
   */
  resolveInteraction: (selection: InteractionSelection) => boolean;
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
  // Cobre o bloqueio do caos E a trava da carta TRAVAR. Simular uma jogada
  // numa casa lacrada faria a CPU "planejar" vitórias impossíveis e, pior,
  // tentar jogar exatamente na casa que o jogador travou — que é o sintoma
  // que a carta existe para produzir do lado certo.
  if (isCellUnavailable(state, index)) return null;

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
    if (isCellUnavailable(state, i)) continue;
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

/**
 * Tabuleiro resultante de deslizar uma peça de `origin` para `destination`
 * (DESLIZAR/`SLIDE_PIECE`) — o objeto inteiro muda de célula, `turnPlaced`
 * incluso: deslizar não altera a idade na fila, só a posição.
 */
function simulateSlide(board: Board, origin: number, destination: number): Board {
  const next = [...board];
  next[destination] = next[origin];
  next[origin] = null;
  return next;
}

/**
 * Peça própria + vizinho ortogonal vazio que fecha uma linha ao deslizar pra
 * lá, se existir — mesma urgência de `findWinningMove`, só que via DESLIZAR
 * em vez de colocação nova. Reaproveitado por `resolveCpuInteraction` (2º
 * passo da carta) pra escolher o MESMO destino, em vez de sortear.
 */
function findWinningSlide(
  state: GameState,
  owner: Combatant,
): { origin: number; destination: number } | null {
  for (const origin of getPieceIndexes(state.board, owner)) {
    for (const destination of adjacentIndexes(origin)) {
      if (state.board[destination] !== null) continue;
      if (isCellUnavailable(state, destination)) continue;
      if (findWinner(simulateSlide(state.board, origin, destination))?.winner === owner) {
        return { origin, destination };
      }
    }
  }
  return null;
}

/**
 * Peça do OPONENTE de `cpu` que faz parte de uma ameaça de vitória iminente
 * dele (2 peças já na linha, 1 célula vazia) e tem para onde tropeçar —
 * TROPEÇAR/`TRIP_PIECE`. Diferente de `findWinningSlide`, a urgência aqui é
 * DEFENSIVA, não ofensiva: TROPEÇAR nunca fecha linha PRA CPU (move a peça
 * do OUTRO lado), então o gatilho certo é desarmar a ameaça do adversário,
 * não perseguir uma vitória própria que a carta não pode entregar. Uma vez a
 * ORIGEM certa escolhida, qualquer destino elegível já desarma a linha —
 * `resolveCpuInteraction` (abaixo) não precisa de tratamento especial pro 2º
 * passo, o sorteio ingênuo de sempre já serve.
 */
function findDisruptiveTrip(state: GameState, cpu: Combatant): { origin: number } | null {
  const human = opponentOf(cpu);

  for (const line of WIN_LINES) {
    const humanCount = line.filter((i) => state.board[i]?.owner === human).length;
    const emptyCount = line.filter((i) => state.board[i] === null).length;
    if (humanCount !== 2 || emptyCount !== 1) continue;

    const origin = line.find(
      (i) =>
        state.board[i]?.owner === human &&
        adjacentIndexes(i).some((n) => state.board[n] === null && !isCellUnavailable(state, n)),
    );
    if (origin !== undefined) return { origin };
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
 * **Pode ser chamada mais de uma vez no MESMO turno.** A jogada de carta da
 * CPU é anunciada num modal que pausa o jogo; quando o jogador confirma, o
 * hook (`useCpuOpponent`) re-invoca `playCPUTurn`, que chama esta função de
 * novo com o estado JÁ atualizado (energia/mão debitadas da carta anterior).
 * Nenhum rastreamento de "já joguei uma carta este turno" é necessário: cada
 * chamada decide com o estado corrente, e `ENERGY_CAP` (3) já limita
 * naturalmente quantas cartas cabem — no máximo 3 de 1⚡, por exemplo. Devolve
 * `null` quando não sobra nenhuma jogada de carta que valha a pena, e é isso
 * que sinaliza a `playCPUTurn` para seguir para a colocação de peça.
 */
export function chooseCpuCardPlay(state: GameState): CpuCardPlay | null {
  const hand = state[handKeyFor(CPU)];
  const energy = state[energyKeyFor(CPU)];
  // Cego a `canPlay`/alvo — só a carta ESTAR na mão e CABER na energia do
  // turno. Sem este filtro a CPU tentaria a carta de maior prioridade, seria
  // recusada em silêncio por falta de ⚡ e não jogaria nada, mesmo tendo uma
  // carta mais barata perfeitamente jogável logo abaixo na lista.
  const find = (id: CardId) => {
    const entry = hand.find((c) => c.cardId === id);
    return entry && getCard(id).cost <= energy ? entry : undefined;
  };
  const rng = getChannel('AI');

  // 1. Cura crítica — sobreviver vem antes de qualquer outra jogada.
  const heal = find('HEAL_SELF');
  if (heal && hpOf(state, CPU) <= 2) return { uid: heal.uid, cardId: heal.cardId };

  // 2. BATERIA RESERVA (carta nova) — machucado e sem escudo ainda: previne
  // o próximo dano em vez de só reagir depois dele.
  const shield = find('BACKUP_BATTERY');
  if (shield && hpOf(state, CPU) <= 3 && !state[shieldKeyFor(CPU)]) {
    return { uid: shield.uid, cardId: shield.cardId };
  }

  // 3. CÁPSULA DO TEMPO (carta nova) — HP crítico e ainda não armada: dá
  // timing de verdade a uma armadilha que, senão, só entraria em jogo por
  // sorte de ordem na mão (regra genérica de armadilha, item 8 abaixo).
  const capsule = find('TIME_CAPSULE');
  if (
    capsule &&
    hpOf(state, CPU) <= 2 &&
    state[trapsKeyFor(CPU)].length < TRAP_LIMIT &&
    !state[trapsKeyFor(CPU)].some((c) => c.cardId === 'TIME_CAPSULE')
  ) {
    return { uid: capsule.uid, cardId: capsule.cardId };
  }

  // 4. Possível abate — se o dano fecha a partida, é sempre a melhor jogada.
  const attack = find('DIRECT_DAMAGE');
  if (attack && hpOf(state, HUMAN) <= 2) return { uid: attack.uid, cardId: attack.cardId };

  // 5. DESLIZAR (carta nova) fecha linha na hora, se alguma peça própria
  // puder deslizar pra isso — mesma urgência do abate: se dá pra vencer
  // AGORA, vence (ver `findWinningSlide`).
  const slide = find('SLIDE_PIECE');
  if (slide) {
    const winningSlide = findWinningSlide(state, CPU);
    if (winningSlide) {
      return { uid: slide.uid, cardId: slide.cardId, targetIndex: winningSlide.origin };
    }
  }

  // 6. TROPEÇAR (carta nova) — desarma uma ameaça de vitória iminente do
  // HUMANO tirando uma das 2 peças da linha quase fechada da posição. Nunca
  // fecha linha PRA CPU (move a peça do outro lado), então a urgência aqui é
  // defensiva, não ofensiva — ver `findDisruptiveTrip`.
  const trip = find('TRIP_PIECE');
  if (trip) {
    const disruptive = findDisruptiveTrip(state, CPU);
    if (disruptive) {
      return { uid: trip.uid, cardId: trip.cardId, targetIndex: disruptive.origin };
    }
  }

  // 7. Remove a própria interdição antes de tentar jogar no tabuleiro. LIMPAR
  // só cobre o bloqueio do caos; PURIFICAR cobre os dois — ambas exigem alvo
  // agora (a própria célula interditada), diferente da antiga CLEANSE global.
  const clearBlock = find('CLEAR_BLOCK');
  if (clearBlock && state.activeRule === 'BLOCKED_CELL' && state.blockedCell !== null) {
    return { uid: clearBlock.uid, cardId: clearBlock.cardId, targetIndex: state.blockedCell };
  }
  const cleanse = find('CLEANSE');
  if (cleanse) {
    const target = state.activeRule === 'BLOCKED_CELL' ? state.blockedCell : state.lockedCell;
    if (target !== null) return { uid: cleanse.uid, cardId: cleanse.cardId, targetIndex: target };
  }

  // 8. TURNO EXTRA é sempre bom e nunca tem alvo — sem desvantagem.
  const extra = find('TURNO_EXTRA');
  if (extra && state.extraTurnPending !== CPU) return { uid: extra.uid, cardId: extra.cardId };

  // 9. Arma a primeira armadilha disponível, se sobrar espaço na mesa —
  // cobre MINA, PROTEÇÃO, ANTIMAGIA, RICOCHETE e as 3 armadilhas novas
  // (TIME_CAPSULE, TRIPWIRE, PARADOX) de graça, por categoria
  // (`TRAP_CARD_IDS`). TIME_CAPSULE já tem prioridade PRÓPRIA acima (item 3)
  // quando o HP está crítico — aqui ela só entra pela ordem da mão, como as
  // outras.
  if (state[trapsKeyFor(CPU)].length < TRAP_LIMIT) {
    const trap = hand.find((c) => TRAP_CARD_IDS.includes(c.cardId) && getCard(c.cardId).cost <= energy);
    if (trap) return { uid: trap.uid, cardId: trap.cardId };
  }

  // 10. Demolir a peça mais velha do HUMANO, só quando ele já tem 3 no
  // tabuleiro (senão a carta só abriria espaço de graça para ele).
  const breakPiece = find('BREAK_PIECE');
  if (breakPiece) {
    const target = getOldestPieceIndex(state.board, HUMAN);
    if (target !== null) return { uid: breakPiece.uid, cardId: breakPiece.cardId, targetIndex: target };
  }

  // 11. RENOVAR (carta nova) — só a partir de 3 peças próprias no tabuleiro
  // (mesma exigência do `canPlay` da carta, `registry.ts`) — a fila do
  // "infinito" só ameaça a partir daí; com menos, renovar não atrasaria
  // sumiço nenhum de verdade.
  const renew = find('RENEW_PIECE');
  if (renew) {
    const ownPieces = getPieceIndexes(state.board, CPU);
    if (ownPieces.length >= MAX_PIECES_PER_PLAYER) {
      return { uid: renew.uid, cardId: renew.cardId, targetIndex: ownPieces[0] };
    }
  }

  // 12. SAQUE e ESPIONAGEM: as duas mexem na mão do humano de verdade agora
  // (SAQUE tem 50% de chance de roubar; ESPIONAGEM sempre descobre E
  // descarta) — prioridade parecida, só incomodam se ele tiver o que perder.
  const raid = find('HAND_RAID');
  if (raid && state[handKeyFor(HUMAN)].length > 0 && rng.chance(0.5)) {
    return { uid: raid.uid, cardId: raid.cardId };
  }
  const spyCard = find('SABOTAGE');
  if (spyCard && state[handKeyFor(HUMAN)].length > 0 && rng.chance(0.5)) {
    return { uid: spyCard.uid, cardId: spyCard.cardId };
  }

  // 13. APAGÃO (carta nova) — só vale a pena drenando energia relevante do
  // humano, senão é 2⚡ desperdiçados numa recarga de +1 que ele nem sentiria.
  const blackout = find('BLACKOUT');
  if (blackout && state[energyKeyFor(HUMAN)] >= 2) {
    return { uid: blackout.uid, cardId: blackout.cardId };
  }

  // 14. Trava uma célula vazia aleatória — disrupção de baixo custo. Nunca a
  // que já está lacrada: o efeito recusaria e a carta voltaria para a mão.
  const lock = find('LOCK_CELL');
  if (lock) {
    const empty = state.board
      .map((cell, i) => (cell === null && state.lockedCell !== i ? i : -1))
      .filter((i) => i !== -1);
    if (empty.length > 0) return { uid: lock.uid, cardId: lock.cardId, targetIndex: rng.pick(empty) };
  }

  // 15. VIDENTE agora DESTRÓI a peça marcada (não só revela) — mirar na mais
  // ANTIGA do humano seria desperdício, ela já sumiria sozinha em breve pelo
  // "infinito"; a mais NOVA é o alvo que rende de verdade, porque não sairia
  // do tabuleiro por conta própria tão cedo.
  const reveal = find('OBSOLESCENCE');
  if (reveal) {
    const humanPieces = getPieceIndexes(state.board, HUMAN); // mais antiga → mais nova
    const newest = humanPieces.at(-1) ?? null;
    if (newest !== null) return { uid: reveal.uid, cardId: reveal.cardId, targetIndex: newest };
  }

  // 16. Cura não-crítica — melhor que deixar a carta parada na mão.
  if (heal) return { uid: heal.uid, cardId: heal.cardId };

  // 17. Compra por último: preenche a mão quando nada mais se aplica.
  // PROCRASTINAR II primeiro — mesma ideia, mais cartas — quando a energia
  // alcançar; `find` já garante que só é escolhida se couber no turno.
  const drawBig = find('STUDY_II');
  if (drawBig && hand.length < HAND_LIMIT) return { uid: drawBig.uid, cardId: drawBig.cardId };
  const draw = find('STUDY');
  if (draw && hand.length < HAND_LIMIT) return { uid: draw.uid, cardId: draw.cardId };

  // 18. Puramente informativas — a CPU já decide com o estado inteiro à
  // vista, então não ganham nada mecânico, mas apodrecer na mão é pior. Do
  // lado do jogador viram um aviso concreto de que foi espiado.
  const fullIntel = find('FULL_INTEL');
  if (fullIntel && state[handKeyFor(HUMAN)].length > 0) {
    return { uid: fullIntel.uid, cardId: fullIntel.cardId };
  }
  const peek = find('PEEK_RANDOM');
  if (peek && state[handKeyFor(HUMAN)].length > 0) return { uid: peek.uid, cardId: peek.cardId };

  // 19. PRESSÁGIO (carta nova) — zero ganho mecânico pra CPU (ela não tem
  // como "lembrar" do que viu, só decide com o `state` inteiro à vista), mas
  // apodrecer na mão é pior — mesmo racional do item 17. Baixa prioridade,
  // só preenche energia que sobraria sem uso.
  const scry = find('SCRY_DECK');
  if (scry && rng.chance(0.2)) return { uid: scry.uid, cardId: scry.cardId };

  // 20. RECICLAR (carta nova) — troca 1 carta parada por outra, quando não
  // há nada melhor a fazer com a energia sobrando. A escolha de QUAL
  // descartar já cai na heurística ingênua existente (`PICK_ONE_FROM_HAND`
  // em `resolveCpuInteraction`).
  const mulligan = find('MULLIGAN');
  if (mulligan && hand.length > 1 && rng.chance(0.2)) {
    return { uid: mulligan.uid, cardId: mulligan.cardId };
  }

  // 21. TROCAR é alto risco (pode devolver uma carta melhor ao oponente) —
  // só ocasionalmente, nunca como prioridade. Mesma cautela da antiga TROCA
  // (mão inteira), agora só entre uma carta de cada lado.
  const trade = find('HAND_SWAP');
  if (trade && rng.chance(0.15)) return { uid: trade.uid, cardId: trade.cardId };

  // 22. DESLIZAR oportunista (carta nova) — sem vitória garantida (item 5 já
  // pegou esse caso), só reposiciona uma peça própria quando não há nada
  // melhor a fazer. `resolveCpuInteraction` decide o destino.
  if (slide) {
    const slidable = getPieceIndexes(state.board, CPU).find((index) =>
      adjacentIndexes(index).some((n) => state.board[n] === null && !isCellUnavailable(state, n)),
    );
    if (slidable !== undefined && rng.chance(0.15)) {
      return { uid: slide.uid, cardId: slide.cardId, targetIndex: slidable };
    }
  }

  // 23. TIC TAC BOOM! é de graça (custo 0) e o resultado é imprevisível para
  // os dois lados — sem leitura estratégica clara, só entra ocasionalmente
  // como uma última cartada em vez de deixar a energia sobrando sem uso.
  const roulette = find('CHAOS_ROULETTE');
  if (roulette && rng.chance(0.2)) return { uid: roulette.uid, cardId: roulette.cardId };

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
  // REBOBINAR: a CPU joga o turno normalmente (já jogou carta/armou armadilha
  // antes de chegar aqui, ver `chooseCpuCardPlay`), só não decide colocação —
  // tratado exatamente como "sem jogada legal", sem precisar simular nada.
  if (state.machinePlacementBlocked) return null;

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
/*                          INTERAÇÃO PENDENTE DA CPU                          */
/* -------------------------------------------------------------------------- */

/**
 * Resolve, com uma heurística INGÊNUA (`rng.pick`/`rng.shuffle`, sem avaliar
 * QUAL opção vale mais — limitação conhecida registrada no README), o passo
 * atual de uma `pendingInteraction` que a PRÓPRIA CPU acabou de abrir (Fase
 * 4, SAQUE/SAQUE II/SABOTAGEM — ver Achado 3 do plano da fase).
 *
 * `BOARD_TARGET` nunca chega aqui: a CPU sempre resolve o alvo sozinha ANTES
 * de jogar a carta (`chooseCpuCardPlay` devolve `targetIndex` de antemão),
 * então essa carta nunca abre uma interação pra CPU resolver depois. Os
 * outros 5 `kind`s ganham um ramo cada — `PICK_BOARD_CELL` (DESLIZAR e
 * TROPEÇAR, as duas cartas novas que movem peça) é a exceção à heurística
 * ingênua do resto da função: quando algum destino elegível fecha uma linha
 * PRA CPU, escolhe ele em vez de sortear (mesma checagem de
 * `findWinningSlide`, reaproveitando `simulateSlide`). Em TROPEÇAR essa
 * checagem nunca bate de verdade — a peça movida é do HUMANO, não da CPU —
 * então cai direto no sorteio ingênuo; a escolha inteligente pra TROPEÇAR já
 * aconteceu antes, na ORIGEM (`findDisruptiveTrip`, `chooseCpuCardPlay`),
 * não no destino: uma vez a peça certa escolhida para tirar da linha,
 * qualquer destino já desarma a ameaça.
 */
function resolveCpuInteraction(pending: PendingInteraction, actions: CpuActions, state: GameState): void {
  const rng = getChannel('AI');

  switch (pending.kind) {
    case 'BOARD_TARGET':
      return;
    case 'PICK_ONE_FROM_HAND':
      actions.resolveInteraction({ kind: 'PICK_ONE_FROM_HAND', uid: rng.pick(pending.optionUids) });
      return;
    case 'PICK_MANY_FROM_HAND': {
      const shuffled = rng.shuffle(pending.optionUids);
      actions.resolveInteraction({ kind: 'PICK_MANY_FROM_HAND', uids: shuffled.slice(0, pending.count) });
      return;
    }
    case 'PICK_ONE_REVEALED':
      actions.resolveInteraction({ kind: 'PICK_ONE_REVEALED', cardId: rng.pick(pending.options) });
      return;
    case 'SACRIFICE_DRAG': {
      if (pending.eligibleUids.length < 2) return;
      const [first, second] = rng.shuffle(pending.eligibleUids);
      actions.resolveInteraction({ kind: 'SACRIFICE_DRAG', uids: [first, second] });
      return;
    }
    case 'PICK_BOARD_CELL': {
      const origin = pending.priorSelections[0];
      const originIndex = origin?.kind === 'BOARD_TARGET' ? origin.index : undefined;
      const winning =
        originIndex !== undefined
          ? pending.eligibleIndexes.find(
              (destination) =>
                findWinner(simulateSlide(state.board, originIndex, destination))?.winner === pending.caster,
            )
          : undefined;

      actions.resolveInteraction({
        kind: 'PICK_BOARD_CELL',
        index: winning ?? rng.pick(pending.eligibleIndexes),
      });
      return;
    }
  }
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

  /* --- Interação pendente ---------------------------------------------------
     Duas leituras possíveis pra `pendingInteraction !== null` aqui: é de um
     HUMANO mirando/escolhendo (espera — `pending.caster` só pode ser CPU
     quando `fresh.turn === CPU`, mas a guarda checa os dois por segurança),
     ou é a PRÓPRIA CPU que acabou de abrir SAQUE/SABOTAGEM (Fase 4, Achado 3)
     e ainda não tem quem resolva — sem tratamento aqui o turno trava pra
     sempre, porque `resolveInteraction` recusa qualquer combatente que não
     seja `pending.caster`. Sequência completa (ver plano da Fase 4): a CPU
     joga a carta → o anúncio ("O OPONENTE JOGOU SAQUE") pausa ANTES da
     interação abrir de verdade → o humano confirma → `pendingAcknowledgement`
     vira `null` → o hook (`useCpuOpponent`) já tem isso nas dependências e
     RE-DISPARA esta função → é NESTA 2ª chamada que a interação já está
     aberta e cai aqui. */
  if (fresh.pendingInteraction !== null) {
    if (fresh.pendingInteraction.caster !== CPU) return null; // humano mirando/escolhendo
    resolveCpuInteraction(fresh.pendingInteraction, actions, fresh);
    fresh = getState ? getState() : fresh;
    if (fresh.status !== 'PLAYING' || fresh.turn !== CPU || fresh.pendingAcknowledgement !== null) {
      return null;
    }
  }

  /* --- Cartas antes do tabuleiro -------------------------------------------
     Uma tentativa por CHAMADA — mas o hook (`useCpuOpponent`) re-invoca esta
     função a cada "Entendi" confirmado (ver o comentário logo abaixo), então
     a CPU pode acabar jogando várias cartas no mesmo turno, uma de cada vez,
     cada uma com o próprio anúncio. `chooseCpuCardPlay` decide cada tentativa
     com o estado FRESCO — energia/mão já refletem qualquer carta anterior. A
     mensagem de log já sai de graça: `playCard`/`playMachineCard` chamam
     `pushLog` com a `message` do efeito, então nenhuma plumbing extra é
     necessária aqui. */
  const cardPlay = chooseCpuCardPlay(fresh);
  if (cardPlay) {
    const played = actions.playCard(cardPlay.uid, cardPlay.targetIndex);

    if (played) {
      // Releitura obrigatória: a carta pode ter mudado HP, mão, regra ou até
      // encerrado a rodada — decidir a jogada de tabuleiro com dados velhos
      // arriscaria jogar num estado que já não existe mais.
      fresh = getState ? getState() : fresh;
      if (fresh.status !== 'PLAYING' || fresh.turn !== CPU || fresh.pendingInteraction !== null) {
        return null;
      }

      /* --- O anúncio da carta pausou o jogo -----------------------------
         A jogada da CPU é mostrada ao jogador ANTES de aplicar, e até ele
         confirmar o efeito nem aconteceu. Seguir para `placeMark` aqui seria
         jogar sobre um tabuleiro cuja carta ainda não resolveu — e o próprio
         `canPlaceAt` recusaria, fazendo a CPU perder a jogada em silêncio.

         Abortar é seguro porque o hook da CPU tem `pendingAcknowledgement`
         nas dependências: quando o jogador confirma, o turno recomeça — esta
         função é chamada de novo do zero, com o estado já refletindo a carta
         que acabou de resolver. Nessa nova chamada `chooseCpuCardPlay` decide
         de novo: pode escolher OUTRA carta (se ainda sobrar energia/mão útil)
         ou devolver `null` e seguir direto para o tabuleiro — sem precisar de
         nenhum rastreamento de "já joguei uma carta este turno". */
      if (fresh.pendingAcknowledgement !== null) return null;
    }
  }

  const decision = chooseCpuMove(fresh, positionalBias);
  if (!decision) {
    // `endTurn` recusa (devolve `false`) se houver `pendingAcknowledgement` —
    // e chamá-lo aqui nesse caso seria um no-op silencioso, o MESMO soft-lock
    // que esta função existe para eliminar, uma camada acima. Hoje isto é
    // INALCANÇÁVEL: o hook (`useCpuOpponent`) já tem `hasPendingAcknowledgement`
    // nas próprias dependências e recusa AGENDAR esta função enquanto uma
    // confirmação está pendente; e a única fonte de confirmação DENTRO desta
    // função (a carta que a CPU acabou de jogar) já foi checada explicitamente
    // acima, antes de chegar aqui. Guarda mesmo assim, defensiva: se uma fonte
    // nova de `pendingAcknowledgement` aparecer no futuro sem passar por
    // nenhum dos dois pontos acima, o turno fica preso até a pendência limpar
    // e o PRÓPRIO hook tenta de novo — nunca desiste em silêncio.
    if (fresh.pendingAcknowledgement !== null) return null;

    actions.endTurn();
    return null;
  }

  actions.placeMark(decision.index);
  return decision;
}
