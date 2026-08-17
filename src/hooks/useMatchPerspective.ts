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
  /**
   * Combatentes que ESTE dispositivo/pessoa controla agora — sempre 1 (o modo hot-seat, que
   * controlava os 2, foi removido). Fonte única para responder "esconder informação secreta
   * de um combatente X faz sentido pra quem está olhando agora?" — quem consome combina isto
   * com `state.turn` quando o segredo é por-lado-atual, ou usa sozinho quando o segredo
   * persiste independente do turno (a própria carta armada, uma vez que o dono a vê,
   * continua vendo até ela resolver).
   *
   * **Reaproveitar na Fase 3:** ESPIADA, ESPIONAGEM e VISÃO ABSOLUTA são todas "informação
   * visível só para um lado" — mesma pergunta que este campo já resolve. Não reinventar lá.
   *
   * VIDENTE (`highlightedOldestFor`, `rules.ts`) não usa este campo — não é informação
   * secreta (só destaca uma peça já visível no tabuleiro pros dois lados), então continua
   * com a regra própria dela (`!isOnline || caster === localCombatant`).
   */
  controlledCombatants: readonly Combatant[];
}

/**
 * Fora do modo online devolve a identidade (`PLAYER` local, `MACHINE`
 * remoto) — comportamento de sempre nos modos CPU/Clássico. Nenhum
 * componente precisa de ramo condicional por modo de jogo: quem consome
 * este hook funciona igual nos dois.
 */
export function useMatchPerspective(): MatchPerspective {
  const multiplayerStatus = useMultiplayerStore(selectMultiplayerStatus);
  const playerId = useMultiplayerStore(selectPlayerId);

  return useMemo(() => {
    if (multiplayerStatus !== 'MATCH_STARTED' || playerId === null) {
      return {
        localCombatant: 'PLAYER',
        remoteCombatant: 'MACHINE',
        isOnline: false,
        controlledCombatants: ['PLAYER'],
      };
    }

    const localCombatant = COMBATANT_BY_SLOT[playerId];
    return {
      localCombatant,
      remoteCombatant: opponentOf(localCombatant),
      isOnline: true,
      controlledCombatants: [localCombatant],
    };
  }, [multiplayerStatus, playerId]);
}

export default useMatchPerspective;
