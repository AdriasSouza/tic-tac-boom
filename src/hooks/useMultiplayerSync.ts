import { useEffect, useRef } from 'react';

import {
  consumeRemoteActions,
  resetSyncBridge,
  restoreOutbox,
  resyncFromActionLog,
} from '@/services/syncBridge';
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

  /**
   * Toda entrada/reentrada numa sala pede um resync COMPLETO na próxima vez
   * que `room` chegar (efeito abaixo), não o consumo incremental de sempre —
   * cobre reconexão sem precisar diferenciar "sala nova" (log vazio, o
   * replay não faz nada) de "sala retomada" (log cheio, reconstrói tudo).
   */
  const needsFullResyncRef = useRef(false);

  /* --- Nova sala ⇒ ponte limpa + resync completo pendente ------------------
     Os ids processados são específicos de uma sala. Sem o reset, entrar numa
     segunda partida com a ponte ainda cheia dos ids da primeira faria ela
     ignorar ações legítimas — e o jogo simplesmente não responderia às
     jogadas do oponente, sem erro nenhum.

     `restoreOutbox()` roda logo depois, de propósito: `resetSyncBridge` só
     zera o que é efêmero de SESSÃO (nunca o outbox persistido em disco — ver
     o comentário lá), e é aqui que qualquer ação que não terminou de ser
     confirmada antes do app fechar/cair retoma o envio. Cobre tanto
     reconectar na MESMA sala (o caso principal) quanto entrar numa sala
     nova — uma entrada de uma sala anterior continua tentando em segundo
     plano até expirar por idade/tentativas (`outboxPersistence.ts`), sem
     custo real: `pushAction` é uma escrita crua no Firebase, não depende de
     nenhuma sessão de UI viva pra funcionar.                                */
  useEffect(() => {
    resetSyncBridge();
    needsFullResyncRef.current = true;
    void restoreOutbox();
  }, [roomCode]);

  /* --- Consumo do log ------------------------------------------------------
     Depende do array `actions` inteiro, não do tamanho: o `multiplayerStore`
     recria o array a cada snapshot do RTDB, então a identidade muda sempre
     que algo chega. `consumeRemoteActions` é idempotente, então reprocessar a
     lista completa é seguro e barato — e é o que torna a reconexão trivial:
     o log volta inteiro e só o que faltava é aplicado.

     Duas exceções ao caminho incremental de sempre, as duas via
     `resyncFromActionLog` (reconstrução total, determinística a partir do
     log completo — ver o JSDoc dela): a entrada/reentrada marcada acima, e
     uma dessincronia que o consumo incremental acabou de detectar. Nenhuma
     delas é o caminho do dia a dia — só os dois momentos em que já se sabe
     que o estado local pode não bater com o log. */
  useEffect(() => {
    if (!room) return;

    if (needsFullResyncRef.current) {
      needsFullResyncRef.current = false;
      resyncFromActionLog(room.seed, room.actions);
      return;
    }

    const hadDesync = consumeRemoteActions(room.actions);
    if (hadDesync) {
      console.warn('[useMultiplayerSync] dessincronia detectada — reconstruindo a partir do log completo.');
      resyncFromActionLog(room.seed, room.actions);
    }
  }, [room]);
}

export default useMultiplayerSync;
