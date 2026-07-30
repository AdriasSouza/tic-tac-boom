import { useEffect } from 'react';

import { consumeRemoteActions, resetSyncBridge } from '@/services/syncBridge';
import { selectRoom, selectRoomCode, useMultiplayerStore } from '@/store/multiplayerStore';

/**
 * Liga o log de ações da sala à ponte de sincronização.
 *
 * Fininho de propósito: o listener do RTDB já vive no `multiplayerStore`, e a
 * tradução de ação em jogada já vive no `syncBridge`. O que faltava era o
 * gatilho React entre os dois — e é só isso que este hook é.
 *
 * Monte-o na tela de jogo (`app/game/[mode].tsx`). Fora do modo online ele é
 * inerte: sem sala, `actions` é sempre vazio e nada acontece.
 */
export function useMultiplayerSync(): void {
  const roomCode = useMultiplayerStore(selectRoomCode);
  const room = useMultiplayerStore(selectRoom);

  /* --- Nova sala ⇒ ponte limpa ---------------------------------------------
     Os ids processados são específicos de uma sala. Sem este reset, entrar
     numa segunda partida com a ponte ainda cheia dos ids da primeira faria
     ela ignorar ações legítimas — e o jogo simplesmente não responderia às
     jogadas do oponente, sem erro nenhum.                                   */
  useEffect(() => {
    resetSyncBridge();
  }, [roomCode]);

  /* --- Consumo do log ------------------------------------------------------
     Depende do array `actions` inteiro, não do tamanho: o `multiplayerStore`
     recria o array a cada snapshot do RTDB, então a identidade muda sempre
     que algo chega. `consumeRemoteActions` é idempotente, então reprocessar a
     lista completa é seguro e barato — e é o que torna a reconexão trivial:
     o log volta inteiro e só o que faltava é aplicado.                      */
  useEffect(() => {
    if (!room) return;
    consumeRemoteActions(room.actions);
  }, [room]);
}

export default useMultiplayerSync;
