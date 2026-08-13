import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

import {
  MultiplayerError,
  createRoom as createRoomRequest,
  detachPresence,
  getClientId,
  joinRoom as joinRoomRequest,
  leaveRoom as leaveRoomRequest,
  listenToRoom,
  type Unsubscribe,
} from '@/services/multiplayerService';
import type { PlayerConnectionStatus, PlayerSlot, RoomSnapshot } from '@/types/multiplayer';

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

/**
 * Estado da fila de saída de ações (`syncBridge`'s `outbox`) — `'idle'` sem
 * nada pendente, `'retrying'` tentando publicar de novo depois de uma falha,
 * `'stalled'` depois de várias tentativas seguidas (só muda o RÓTULO pra UI
 * comunicar urgência — a fila continua tentando, nunca desiste sozinha).
 * Escrito de fora do corpo da store por `syncBridge.ts` (mesmo padrão que
 * `pendingReconnectCode` já recebe de fora, abaixo) — é estado de REDE, não
 * de partida, por isso mora aqui e não no `gameStore`.
 */
export type OutboxStatus = 'idle' | 'retrying' | 'stalled';

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
  /**
   * Código de uma sala que este dispositivo estava jogando antes do app
   * fechar/recarregar, lido do armazenamento local no boot. `null` quando não
   * há nada a oferecer, ou depois que o jogador reconecta/dispensa a oferta.
   *
   * Só a OFERTA mora aqui — reconectar de fato é chamar `joinRoom(code)`
   * normalmente. A sala já reconhece este cliente pelo `clientId` persistido
   * (ver `multiplayerService`), então o caminho de REJOIN de sempre resolve
   * sozinho, sem nenhuma rota de rede nova.
   */
  pendingReconnectCode: string | null;
  /** Ver `OutboxStatus`. */
  outboxStatus: OutboxStatus;
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
  /** Aceita a oferta de reconexão: entra de volta em `pendingReconnectCode`. */
  reconnect: () => Promise<void>;
  /** Recusa a oferta de reconexão — não pergunta de novo para esta sala. */
  dismissReconnect: () => void;
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
  pendingReconnectCode: null,
  outboxStatus: 'idle',
};

/* -------------------------------------------------------------------------- */
/*                    PERSISTÊNCIA DE SESSÃO (localStorage/disco)              */
/* -------------------------------------------------------------------------- */
/* Responsabilidade DESTE store, não do serviço: o `multiplayerService` só
   fala a língua do Firebase (é onde o `clientId` persistente vive, porque é
   consumido diretamente pelas transações de lá). "Qual foi a última sala que
   ESTE dispositivo jogou" é sessão de cliente, não protocolo de rede — mora
   aqui, ao lado de quem já orquestra entrar/sair.                           */

const SESSION_STORAGE_KEY = '@tic-tac-boom/lastRoom';

/** Melhor esforço: sem disco (modo privado, quota cheia), só perdemos a OFERTA de reconectar. */
async function persistSession(code: string | null): Promise<void> {
  try {
    if (code) await AsyncStorage.setItem(SESSION_STORAGE_KEY, code);
    else await AsyncStorage.removeItem(SESSION_STORAGE_KEY);
  } catch {
    // Silencioso de propósito — ver o comentário acima.
  }
}

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
          void persistSession(null); // nada para oferecer reconectar depois
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

        // O oponente abandonou deliberadamente (não é o caminho do W.O. — ver
        // `syncBridge.netForfeit`, que termina a partida via ação replicada
        // no log, sem tocar `status` da sala, senão o PRÓPRIO declarante veria
        // este ramo disparar em cima da tela de vitória que ele acabou de abrir).
        if (snapshot.status === 'FINISHED') {
          stopListening();
          void persistSession(null);
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
        pendingReconnectCode: null, // sessão ativa de novo — a oferta não faz mais sentido
      });

      void persistSession(code);
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
      detachPresence(); // saída deliberada — não é queda, o onDisconnect não deve mais vigiar
      void persistSession(null);
      set({ ...INITIAL_STATE });

      if (roomCode) await leaveRoomRequest(roomCode);
    },

    clearError: () => {
      if (get().error !== null) set({ error: null });
    },

    reconnect: async () => {
      const code = get().pendingReconnectCode;
      if (!code) return;

      set({ pendingReconnectCode: null });
      await enterRoom(() => joinRoomRequest(code));
    },

    dismissReconnect: () => {
      set({ pendingReconnectCode: null });
      void persistSession(null); // recusou — não oferece esta sala de novo
    },
  };
});

/**
 * Lê a sessão salva UMA VEZ, ao carregar o módulo, e oferece reconexão se
 * encontrar algo. `status === 'DISCONNECTED'` no momento em que a leitura
 * resolve é o que impede uma corrida boba: se o jogador já tiver criado ou
 * entrado numa sala nova enquanto o disco ainda respondia, a oferta chegaria
 * atrasada e sobrescreveria uma sessão que já está em andamento.
 */
void AsyncStorage.getItem(SESSION_STORAGE_KEY)
  .then((code) => {
    if (code && useMultiplayerStore.getState().status === 'DISCONNECTED') {
      useMultiplayerStore.setState({ pendingReconnectCode: code });
    }
  })
  .catch(() => {});

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

/**
 * Status de conexão do OPONENTE — nunca o próprio. `null` fora de uma sala
 * online ou antes do primeiro snapshot chegar (não confundir com
 * `'DISCONNECTED'`: aqui `null` é "não sei ainda", lá é "sei que caiu").
 *
 * Consumido por `syncBridge.isOpponentConnected()` (versão imperativa) e
 * pelos hooks reativos em `useLocalTurn.ts` — a mesma derivação de "qual
 * assento é o do outro" num lugar só, nunca duplicada entre os dois estilos
 * de leitura.
 */
export const selectOpponentConnectionStatus = (s: MultiplayerStore): PlayerConnectionStatus | null => {
  if (s.playerId === null || s.room === null) return null;
  const opponentSlot: PlayerSlot = s.playerId === 'player1' ? 'player2' : 'player1';
  return s.room.players[opponentSlot]?.status ?? null;
};

export const selectPendingReconnectCode = (s: MultiplayerStore) => s.pendingReconnectCode;
export const selectOutboxStatus = (s: MultiplayerStore) => s.outboxStatus;

/** Id anônimo deste cliente. Reexportado para a UI não importar o serviço. */
export { getClientId };
