import {
  MARK_BY_COMBATANT,
  opponentOf,
  type Board,
  type Combatant,
  type GameState,
  type PendingInteraction,
} from '@/engine/rules';

/**
 * Fase 7a — harness de auto-jogo determinístico (diagnóstico, não muda
 * comportamento de `cpu.ts`).
 *
 * `chooseCpuCardPlay`/`chooseCpuMove`/`playCPUTurn` são HARDCODED pra decidir
 * pelo combatente `MACHINE` (constantes `CPU`/`HUMAN` no topo de `cpu.ts`,
 * sem parâmetro de combatente) — confirmado por leitura, não presumido. Não
 * dá pra fazer o `PLAYER` usar a MESMA heurística passando um parâmetro que
 * não existe, e parametrizar `cpu.ts` seria mudança de comportamento de
 * produção disfarçada de ferramenta de diagnóstico — fora do escopo desta
 * fase.
 *
 * Solução: quando for a vez do `PLAYER`, esta função devolve uma CÓPIA do
 * `GameState` real com os dois lados TROCADOS — a heurística "pensa" que
 * está decidindo pra `MACHINE`, mas os dados que ela lê (`machineHand`,
 * `machineEnergy`, etc.) são na verdade os do `PLAYER` real. O resultado da
 * decisão (`uid`, `cardId`, índice de tabuleiro) nunca precisa de tradução de
 * volta — nenhum dos dois é combatant-específico — só as AÇÕES aplicadas ao
 * estado REAL precisam saber pra quem elas realmente valem (ver
 * `cpuSelfPlay.harness.test.ts`).
 *
 * **Só troca os campos que `chooseCpuCardPlay`/`chooseCpuMove`/
 * `playCPUTurn`/`resolveCpuInteraction` de fato consultam** (rastreado por
 * leitura completa de `cpu.ts`) — não o `GameState` inteiro. Ficam de fora,
 * de propósito: `activeRule`/`blockedCell`/`lockedCell` (globais, não
 * combatant-específicos), `forcedVanish` (a própria `simulate()` de `cpu.ts`
 * usa `getOldestPieceIndex`, não `getVanishingIndex` — não consulta
 * `forcedVanish`), `highlightedOldestFor`/`fullIntelRevealFor` (leitura pura
 * de apresentação, nenhuma das funções de decisão as lê), `pendingAcknowledgement`
 * (o harness só verifica não-nulo, nunca campo a campo), `nextCardUid`,
 * `playerRevealedUids`/`machineRevealedUids`, `status`, vencedores,
 * `turnCount`, `matchSeed`.
 *
 * **`machineCardTurn` também fica de fora, deliberadamente.** É assimétrico
 * no `GameState` real — não existe `playerCardTurn` (a guarda existe só pra
 * `MACHINE` não jogar 2 cartas no mesmo turno depois de um re-entry
 * assíncrono pós-modal; humano nunca teve esse problema). Trocar exigiria
 * inventar um valor sem correspondente real, o que quebraria a propriedade
 * de involução (aplicar a função duas vezes devolve o estado original) que
 * o teste desta função verifica. Deixar como está é seguro: `turnCount`
 * avança pelo menos +1 a cada meio-turno (`TURNS_PER_GLOBAL_ROUND`), então
 * `machineCardTurn` (carimbado no turno em que a MACHINE real jogou por
 * último) nunca coincide com o `turnCount` atual durante o turno do
 * `PLAYER` — e o harness nunca chama `chooseCpuCardPlay`/`playCPUTurn` mais
 * de uma vez por turno por lado, então a guarda nunca precisaria bloquear
 * nada de qualquer forma.
 */
export function mirrorForDecision(state: GameState): GameState {
  return {
    ...state,
    turn: opponentOf(state.turn),
    board: swapBoard(state.board),
    playerHand: state.machineHand,
    machineHand: state.playerHand,
    playerEnergy: state.machineEnergy,
    machineEnergy: state.playerEnergy,
    playerHp: state.machineHp,
    machineHp: state.playerHp,
    playerTraps: state.machineTraps,
    machineTraps: state.playerTraps,
    playerPlacementBlocked: state.machinePlacementBlocked,
    machinePlacementBlocked: state.playerPlacementBlocked,
    extraTurnPending: state.extraTurnPending === null ? null : opponentOf(state.extraTurnPending),
    pendingInteraction: swapPendingInteraction(state.pendingInteraction),
  };
}

function swapBoard(board: Board): Board {
  return board.map((cell) => {
    if (cell === null) return null;
    const owner: Combatant = opponentOf(cell.owner);
    return { ...cell, owner, mark: MARK_BY_COMBATANT[owner] };
  });
}

function swapPendingInteraction(pending: PendingInteraction | null): PendingInteraction | null {
  if (pending === null) return null;

  const caster = opponentOf(pending.caster);

  if (pending.kind === 'PICK_ONE_FROM_HAND' || pending.kind === 'PICK_MANY_FROM_HAND') {
    return { ...pending, caster, source: opponentOf(pending.source) };
  }

  return { ...pending, caster };
}
