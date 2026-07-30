import { COMBATANT_BY_SLOT } from '@/services/syncBridge';
import { selectStatus, selectTurn, useGameStore } from '@/store/gameStore';
import {
  selectMultiplayerStatus,
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
 * Fora do modo online devolve `true`: os modos local e CPU não têm "vez do
 * outro aparelho", e quem decide o que é jogável continua sendo o
 * `canPlaceAt`/`selectCanPlayCards` de sempre.
 */
export function useIsLocalTurn(): boolean {
  const turn = useGameStore(selectTurn);
  const multiplayerStatus = useMultiplayerStore(selectMultiplayerStatus);
  const playerId = useMultiplayerStore(selectPlayerId);

  if (multiplayerStatus !== 'MATCH_STARTED' || playerId === null) return true;
  return turn === COMBATANT_BY_SLOT[playerId];
}

/**
 * O jogador local pode jogar cartas agora?
 *
 * Substitui `selectCanPlayCards` na UI durante partidas online. O seletor
 * original testa `turn === 'PLAYER'`, o que é correto no modo local (onde o
 * humano É o `PLAYER`) mas trava permanentemente quem entrou como `player2`
 * numa sala — do lado dele o combatente local é `MACHINE`, e ele nunca
 * conseguiria arrastar uma carta.
 */
export function useCanPlayCardsNow(): boolean {
  const status = useGameStore(selectStatus);
  const isLocalTurn = useIsLocalTurn();
  return status === 'PLAYING' && isLocalTurn;
}
