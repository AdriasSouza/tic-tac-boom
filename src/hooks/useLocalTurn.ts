import { COMBATANT_BY_SLOT } from '@/services/syncBridge';
import { useMatchPerspective } from '@/hooks/useMatchPerspective';
import { selectStatus, selectTurn, useGameStore } from '@/store/gameStore';
import {
  selectMultiplayerStatus,
  selectOpponentConnectionStatus,
  selectPlayerId,
  useMultiplayerStore,
} from '@/store/multiplayerStore';

/**
 * Versão REATIVA de `isLocalTurn()` do `syncBridge`.
 *
 * A do bridge é imperativa (`getState()`), feita para handlers de toque, onde
 * ler o estado fresco no instante do clique é o certo. Esta existe para o
 * RENDER: componentes precisam re-renderizar quando o turno vira, e leitura
 * imperativa não dispara isso — a UI ficaria travada até algum outro estado
 * mudar por acaso.
 *
 * Fora do modo online, usa `controlledCombatants` (`useMatchPerspective`) em
 * vez de devolver `true` incondicionalmente — hot-seat (`/game/local`)
 * controla os dois lados, então QUALQUER turno é "meu" (`includes` sempre
 * `true`, comportamento inalterado); CPU controla só `PLAYER`, então a vez de
 * `MACHINE` agora corretamente devolve `false`. Antes disto, durante o
 * "pensamento" da CPU a mão continuava brilhando e arrastável, e o botão de
 * passar a vez continuava tocável — a jogada era recusada em silêncio pela
 * guarda do motor (`state.turn !== caster`), mas a UI mentia sobre o que
 * estava disponível.
 */
export function useIsLocalTurn(): boolean {
  const turn = useGameStore(selectTurn);
  const multiplayerStatus = useMultiplayerStore(selectMultiplayerStatus);
  const playerId = useMultiplayerStore(selectPlayerId);
  const { controlledCombatants } = useMatchPerspective();

  if (multiplayerStatus !== 'MATCH_STARTED' || playerId === null) {
    return controlledCombatants.includes(turn);
  }
  return turn === COMBATANT_BY_SLOT[playerId];
}

/**
 * Versão REATIVA de `isOpponentConnected()` do `syncBridge` — mesmo racional
 * de `useIsLocalTurn` acima: handlers de toque leem `getState()` na hora,
 * render precisa assinar para saber quando reagir a uma queda que aconteceu
 * sem nenhum clique local.
 */
export function useIsOpponentConnected(): boolean {
  const multiplayerStatus = useMultiplayerStore(selectMultiplayerStatus);
  const connectionStatus = useMultiplayerStore(selectOpponentConnectionStatus);

  if (multiplayerStatus !== 'MATCH_STARTED') return true;
  return connectionStatus !== 'DISCONNECTED';
}

/**
 * O jogador local pode jogar cartas agora?
 *
 * Substitui `selectCanPlayCards` na UI durante partidas online. O seletor
 * original testa `turn === 'PLAYER'`, o que é correto no modo local (onde o
 * humano É o `PLAYER`) mas trava permanentemente quem entrou como `player2`
 * numa sala — do lado dele o combatente local é `MACHINE`, e ele nunca
 * conseguiria arrastar uma carta.
 *
 * Também exige o oponente conectado: sem isto, uma queda no meio da vez do
 * jogador local não impediria ele de continuar arrastando cartas para dentro
 * de uma partida que o outro lado não está mais recebendo.
 */
export function useCanPlayCardsNow(): boolean {
  const status = useGameStore(selectStatus);
  const isLocalTurn = useIsLocalTurn();
  const isOpponentConnected = useIsOpponentConnected();
  return status === 'PLAYING' && isLocalTurn && isOpponentConnected;
}
