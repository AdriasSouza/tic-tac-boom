import { useEffect } from 'react';

import { describeCpuMove, playCPUTurn, type CpuSignal } from '@/engine/ai/cpu';
import { selectStatus, selectTurn, selectTurnCount, useGameStore } from '@/store/gameStore';

export interface UseCpuOpponentOptions {
  /** Desligue no modo hot-seat, onde o lado MACHINE é outro humano. */
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

  /**
   * `turnCount` é o gatilho, não `turn`.
   *
   * Com a carta REBOBINAR (ou a MINA detonando), a máquina joga duas vezes
   * seguidas e `turn` permanece `'MACHINE'` — as dependências não mudariam e o
   * efeito não rodaria de novo, travando o jogo. `turnCount` avança a cada
   * jogada e destrava esse caso.
   */
  const turnCount = useGameStore(selectTurnCount);

  useEffect(() => {
    if (!enabled) return;
    if (status !== 'PLAYING' || turn !== 'MACHINE') return;

    // Cancelamento cooperativo: o atraso da CPU dura até 1,5s e o jogador pode
    // sair da tela ou reiniciar a partida nesse intervalo.
    const signal: CpuSignal = { cancelled: false };

    void playCPUTurn(
      useGameStore.getState(),
      { placeMark: (index) => useGameStore.getState().placeMark(index) },
      {
        signal,
        getState: useGameStore.getState,
        minDelay,
        maxDelay,
        positionalBias,
      },
    ).then((decision) => {
      if (!decision || signal.cancelled) return;
      useGameStore.getState().pushLog(describeCpuMove(decision));
    });

    return () => {
      signal.cancelled = true;
    };
  }, [enabled, turn, turnCount, status, minDelay, maxDelay, positionalBias]);
}
