import { useEffect } from 'react';

import { playCPUTurn, type CpuSignal } from '@/engine/ai/cpu';
import { isOnlineMatch } from '@/services/syncBridge';
import { selectMultiplayerStatus, useMultiplayerStore } from '@/store/multiplayerStore';
import {
  selectHasPendingAcknowledgement,
  selectIsPaused,
  selectStatus,
  selectTurn,
  selectTurnCount,
  useGameStore,
} from '@/store/gameStore';

export interface UseCpuOpponentOptions {
  /** Desligue fora de CPU/Clássico — no online o lado MACHINE é outro humano. */
  enabled?: boolean;
  minDelay?: number;
  maxDelay?: number;
  positionalBias?: boolean;
}

/**
 * Faz a máquina jogar sozinha quando o turno é dela.
 *
 * Mora num hook, e não no store, de propósito: a IA é um **consumidor** da
 * store como qualquer componente. Colocá-la lá dentro criaria uma store que se
 * auto-modifica em resposta ao próprio estado — difícil de testar e impossível
 * de desligar por modo de jogo.
 */
export function useCpuOpponent({
  enabled = true,
  minDelay,
  maxDelay,
  positionalBias,
}: UseCpuOpponentOptions = {}) {
  const turn = useGameStore(selectTurn);
  const status = useGameStore(selectStatus);
  const isPaused = useGameStore(selectIsPaused);
  const hasPendingAcknowledgement = useGameStore(selectHasPendingAcknowledgement);
  // Só o status da rede é assinado (não a sala inteira): é o mínimo para o
  // efeito reavaliar quando a partida vira online, sem re-render a cada ação
  // que chega pelo listener.
  const multiplayerStatus = useMultiplayerStore(selectMultiplayerStatus);

  /**
   * `turnCount` é o gatilho, não `turn`.
   *
   * Com a carta TURNO_EXTRA (ou a MINA detonando), a máquina joga duas vezes
   * seguidas e `turn` permanece `'MACHINE'` — as dependências não mudariam e o
   * efeito não rodaria de novo, travando o jogo. `turnCount` avança a cada
   * jogada e destrava esse caso.
   */
  const turnCount = useGameStore(selectTurnCount);

  useEffect(() => {
    if (!enabled) return;

    /* --- Fantasma desligado no online --------------------------------------
       Numa partida online o lado `MACHINE` é um HUMANO no outro aparelho, não
       a IA. Sem esta guarda os dois clientes rodariam a CPU em paralelo, cada
       um jogando pelo oponente do outro — e como a IA é determinística pela
       seed, ambos produziriam a MESMA jogada fantasma, que então chegaria
       duplicada pela rede. O resultado seria um tabuleiro se preenchendo
       sozinho, sem ninguém tocar em nada.

       Leitura imperativa (e `selectMultiplayerStatus` nas dependências abaixo
       para reavaliar): o hook da CPU não deve assinar o store de rede a ponto
       de re-renderizar a tela de jogo a cada evento de conexão. */
    if (isOnlineMatch()) return;

    if (isPaused) return; // pausado: nem inicia um novo "pensamento"
    if (hasPendingAcknowledgement) return; // confirmação manual pendente: espera o jogador clicar "Entendi"
    if (status !== 'PLAYING' || turn !== 'MACHINE') return;

    // Cancelamento cooperativo: o atraso da CPU dura até 1,5s e o jogador pode
    // sair da tela, pausar ou reiniciar a partida nesse intervalo.
    const signal: CpuSignal = { cancelled: false };

    void playCPUTurn(
      useGameStore.getState(),
      {
        placeMark: (index) => useGameStore.getState().placeMark('MACHINE', index),
        playCard: (uid, targetIndex) => useGameStore.getState().playMachineCard(uid, targetIndex),
        endTurn: () => {
          useGameStore.getState().endTurn('MACHINE');
        },
        resolveInteraction: (selection) => useGameStore.getState().resolveInteraction('MACHINE', selection),
      },
      {
        signal,
        getState: useGameStore.getState,
        minDelay,
        maxDelay,
        positionalBias,
      },
    );
    // A jogada em si já é registrada pelo `placeMark` (evento `MOVE_PLACED`),
    // para os dois combatentes e nos três modos — não há mais nada a logar
    // aqui, e o motivo da escolha da IA era ruído de depuração no terminal.

    // Ao pausar, o cleanup cancela o "pensamento" em andamento. Como
    // `isPaused` está nas dependências, despausar reexecuta o efeito e a CPU
    // recomeça a decisão do zero — mais simples e seguro do que tentar
    // pausar/retomar o mesmo `setTimeout` no meio do caminho.
    return () => {
      signal.cancelled = true;
    };
  }, [
    enabled,
    turn,
    turnCount,
    status,
    isPaused,
    hasPendingAcknowledgement,
    multiplayerStatus,
    minDelay,
    maxDelay,
    positionalBias,
  ]);
}
