import { useMemo } from 'react';

import { opponentOf, type Combatant } from '@/store/gameStore';
import { COMBATANT_BY_SLOT } from '@/services/syncBridge';
import {
  selectMultiplayerStatus,
  selectPlayerId,
  useMultiplayerStore,
} from '@/store/multiplayerStore';

/**
 * De quem é o ponto de vista desta tela.
 *
 * O motor opera em coordenadas ABSOLUTAS: existe um `PLAYER` e um `MACHINE`,
 * e os dois clientes de uma partida online rodam exatamente a mesma
 * simulação, com os mesmos valores, ao mesmo tempo. O que muda entre eles não
 * é o estado — é quem, dentro dele, é "eu".
 *
 * Este hook é a tradução de absoluto para relativo, e existe para que
 * NENHUM componente precise escrever `'PLAYER'` querendo dizer "eu". Escrever
 * o literal funciona no modo local por coincidência (lá o humano É o
 * `PLAYER`) e quebra em silêncio no online, onde quem entra na sala controla
 * o `MACHINE` — foi assim que a mão do adversário quase apareceu como se
 * fosse a do convidado.
 */
export interface MatchPerspective {
  /** O combatente que ESTE aparelho controla. */
  localCombatant: Combatant;
  /** O combatente do outro lado (IA no modo CPU, humano no online). */
  remoteCombatant: Combatant;
  /** `true` quando há um humano do outro lado da rede. */
  isOnline: boolean;
}

/**
 * Fora do modo online devolve a identidade (`PLAYER` local, `MACHINE`
 * remoto) — que é exatamente o comportamento que os modos local e CPU sempre
 * tiveram. Nenhum componente precisa de ramo condicional por modo de jogo:
 * quem consome este hook funciona igual nos três.
 */
export function useMatchPerspective(): MatchPerspective {
  const multiplayerStatus = useMultiplayerStore(selectMultiplayerStatus);
  const playerId = useMultiplayerStore(selectPlayerId);

  return useMemo(() => {
    if (multiplayerStatus !== 'MATCH_STARTED' || playerId === null) {
      return { localCombatant: 'PLAYER', remoteCombatant: 'MACHINE', isOnline: false };
    }

    const localCombatant = COMBATANT_BY_SLOT[playerId];
    return {
      localCombatant,
      remoteCombatant: opponentOf(localCombatant),
      isOnline: true,
    };
  }, [multiplayerStatus, playerId]);
}

export default useMatchPerspective;
