import { create } from 'zustand';

import {
  MultiplayerError,
  createRoom as createRoomRequest,
  getClientId,
  joinRoom as joinRoomRequest,
  leaveRoom as leaveRoomRequest,
  listenToRoom,
  type Unsubscribe,
} from '@/services/multiplayerService';
import type { PlayerSlot, RoomSnapshot } from '@/types/multiplayer';

/**
 * Estado da REDE. Nada de regras de jogo.
 *
 * Store separado do `gameStore` de propósito, e não um punhado de campos
 * novos lá dentro: o `gameStore` é uma máquina de estados determinística —
 * dada a seed e a sequência de inputs, o resultado é sempre o mesmo. Latência,
 * reconexão e "o oponente saiu" são o oposto disso: assíncronos e não
 * reproduzíveis. Misturar os dois contaminaria o replay e faria cada teste de
 * regra precisar de um mock de Firebase.
 *
 * A fronteira é: este store sabe QUEM está conectado e QUAL a seed; o
 * `gameStore` sabe o que fazer com ela. A ponte que traduz `MultiplayerAction`
 * em chamadas do `gameStore` é a próxima etapa, e vai consumir os dois — sem
 * que nenhum dos dois precise conhecer o outro.
 */

/* -------------------------------------------------------------------------- */
/*                                   ESTADO                                    */
/* -------------------------------------------------------------------------- */

export type MultiplayerStatus = 'DISCONNECTED' | 'IN_LOBBY' | 'MATCH_STARTED';

export interface MultiplayerState {
  /** Código da sala atual, ou `null` fora de uma sala. */
  roomCode: string | null;
  /** Assento deste cliente na sala. */
  playerId: PlayerSlot | null;
  status: MultiplayerStatus;
  /**
   * Seed da partida, vinda do RTDB. É o que a tela de jogo repassa para
   * `startMatch(seed)` — o elo entre a sala e o determinismo da engine.
   */
  seed: number | null;
  /** Último snapshot recebido. Alimenta a UI do lobby (quem já entrou etc.). */
  room: RoomSnapshot | null;
  /** Mensagem de erro pronta para exibir, ou `null`. */
  error: string | null;
  /** Uma requisição de rede está em andamento? Trava os botões do lobby. */
  isBusy: boolean;
}

export interface MultiplayerActions {
  /** Cria a sala, assume `player1` e passa a escutar as mudanças. */
  createRoom: () => Promise<void>;
  /** Entra numa sala existente pelo código e passa a escutar as mudanças. */
  joinRoom: (code: string) => Promise<void>;
  /** Sai da sala, encerra o listener e volta para `DISCONNECTED`. */
  leaveRoom: () => Promise<void>;
  /** Limpa a mensagem de erro (ex: quando o jogador começa a digitar de novo). */
  clearError: () => void;
}

export type MultiplayerStore = MultiplayerState & MultiplayerActions;

const INITIAL_STATE: MultiplayerState = {
  roomCode: null,
  playerId: null,
  status: 'DISCONNECTED',
  seed: null,
  room: null,
  error: null,
  isBusy: false,
};

/* -------------------------------------------------------------------------- */
/*                             LISTENER (fora do store)                        */
/* -------------------------------------------------------------------------- */
/* Mesmo racional do barramento de eventos do `gameStore`: a função de
   cancelamento é maquinário de conexão, não estado de UI. Guardá-la no store
   faria toda tela inscrita re-renderizar quando ela mudasse, sem que nada
   visível tivesse mudado.                                                    */

let roomUnsubscribe: Unsubscribe | null = null;

function stopListening(): void {
  roomUnsubscribe?.();
  roomUnsubscribe = null;
}

/* -------------------------------------------------------------------------- */
/*                                    STORE                                    */
/* -------------------------------------------------------------------------- */

export const useMultiplayerStore = create<MultiplayerStore>()((set, get) => {
  /**
   * Abre o listener da sala e traduz cada snapshot em estado local.
   *
   * É aqui que a transição para `MATCH_STARTED` acontece — e ela vem do
   * SERVIDOR, não de quem clicou. Quem cria a sala não sabe que o oponente
   * entrou até o RTDB avisar; deixar `createRoom` "adivinhar" o início faria
   * os dois lados começarem em momentos diferentes.
   */
  function startListening(code: string): void {
    stopListening();

    roomUnsubscribe = listenToRoom(
      code,
      (snapshot) => {
        // Sala apagada no servidor: não há mais o que escutar.
        if (snapshot === null) {
          stopListening();
          set({
            ...INITIAL_STATE,
            error: 'A sala foi encerrada.',
          });
          return;
        }

        set({
          room: snapshot,
          seed: snapshot.seed,
          status: snapshot.status === 'PLAYING' ? 'MATCH_STARTED' : 'IN_LOBBY',
        });

        // O oponente abandonou depois de a partida ter começado.
        if (snapshot.status === 'FINISHED') {
          stopListening();
          set({ ...INITIAL_STATE, error: 'O oponente saiu da sala.' });
        }
      },
      (error) => set({ error: error.message, isBusy: false }),
    );
  }

  /**
   * Casca compartilhada de `createRoom`/`joinRoom`.
   *
   * As duas fazem exatamente a mesma coreografia — travar botões, chamar o
   * serviço, gravar assento/seed, abrir o listener, destravar — e diferem só
   * na requisição. Sem isto, o `isBusy` teria que ser zerado em quatro pontos
   * diferentes, e é o tipo de coisa que um dia deixa o lobby travado.
   */
  async function enterRoom(
    request: () => Promise<{ code: string; seed: number; slot: PlayerSlot }>,
  ): Promise<void> {
    if (get().isBusy) return; // duplo-clique no botão não abre duas salas

    set({ isBusy: true, error: null });

    try {
      const { code, seed, slot } = await request();

      set({
        roomCode: code,
        playerId: slot,
        seed,
        // `IN_LOBBY` mesmo para quem entrou e já virou a sala para PLAYING: o
        // listener chega logo em seguida com o status real do servidor, e é
        // ele quem promove para MATCH_STARTED. Um único caminho para essa
        // transição significa que os dois clientes a fazem pelo mesmo motivo.
        status: 'IN_LOBBY',
        isBusy: false,
      });

      startListening(code);
    } catch (error) {
      const message =
        error instanceof MultiplayerError
          ? error.message
          : 'Não foi possível conectar. Verifique sua internet.';

      set({ ...INITIAL_STATE, error: message });
    }
  }

  return {
    ...INITIAL_STATE,

    createRoom: () => enterRoom(createRoomRequest),

    joinRoom: (code: string) => enterRoom(() => joinRoomRequest(code)),

    leaveRoom: async () => {
      const { roomCode } = get();

      // Encerra o listener ANTES de avisar o servidor: a própria escrita de
      // `FINISHED` dispararia o callback, que trataria a saída deliberada do
      // jogador como "o oponente saiu" e mostraria um erro sem sentido para
      // quem acabou de clicar em sair.
      stopListening();
      set({ ...INITIAL_STATE });

      if (roomCode) await leaveRoomRequest(roomCode);
    },

    clearError: () => {
      if (get().error !== null) set({ error: null });
    },
  };
});

/* -------------------------------------------------------------------------- */
/*                                  SELETORES                                  */
/* -------------------------------------------------------------------------- */

export const selectRoomCode = (s: MultiplayerStore) => s.roomCode;
export const selectPlayerId = (s: MultiplayerStore) => s.playerId;
export const selectMultiplayerStatus = (s: MultiplayerStore) => s.status;
export const selectSeed = (s: MultiplayerStore) => s.seed;
export const selectRoom = (s: MultiplayerStore) => s.room;
export const selectError = (s: MultiplayerStore) => s.error;
export const selectIsBusy = (s: MultiplayerStore) => s.isBusy;

/** O oponente já ocupou o outro assento? Alimenta o "aguardando..." do lobby. */
export const selectHasOpponent = (s: MultiplayerStore): boolean => {
  const players = s.room?.players;
  if (!players) return false;
  return players.player1 !== null && players.player2 !== null;
};

/** Id anônimo deste cliente. Reexportado para a UI não importar o serviço. */
export { getClientId };
