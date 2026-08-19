import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Duas dependências externas mockadas, nenhuma delas o SDK do Firebase:
 *
 * 1. `AsyncStorage` — mesmo Map em memória de `matchPersistence.test.ts`/
 *    `outboxPersistence.test.ts`. `outboxPersistence.ts` (usado por
 *    `syncBridge.ts`) fala com ele de verdade nestes testes — só o disco é
 *    simulado, a lógica de persistência roda por completo.
 * 2. `@/services/multiplayerService` — a fronteira de rede de verdade
 *    (`pushAction`/`fetchRoom`) vira dublê controlável. `multiplayerStore.ts`
 *    (importado de verdade por `syncBridge.ts`) também importa nomes deste
 *    módulo para as próprias ações (`createRoom`/`joinRoom`/...) — nenhuma
 *    delas é chamada nestes testes, mas o módulo precisa exportar algo em
 *    cada nome pra não quebrar o import. Isto evita precisar mockar
 *    `firebase/database`/`@/config/firebase.ts` (a superfície inteira do
 *    RTDB) só pra testar o outbox — ver a nota de escopo no fim do arquivo.
 */
const { store, mockPushAction, mockFetchRoom } = vi.hoisted(() => ({
  store: new Map<string, string>(),
  mockPushAction: vi.fn(),
  mockFetchRoom: vi.fn(),
}));

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: (key: string) => Promise.resolve(store.get(key) ?? null),
    setItem: (key: string, value: string) => {
      store.set(key, value);
      return Promise.resolve();
    },
    removeItem: (key: string) => {
      store.delete(key);
      return Promise.resolve();
    },
  },
}));

vi.mock('@/services/multiplayerService', () => ({
  MultiplayerError: class MultiplayerError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.name = 'MultiplayerError';
      this.code = code;
    }
  },
  createRoom: vi.fn(),
  detachPresence: vi.fn(),
  getClientId: vi.fn().mockResolvedValue('test-client'),
  joinRoom: vi.fn(),
  leaveRoom: vi.fn(),
  listenToRoom: vi.fn(() => () => {}),
  pushAction: mockPushAction,
  fetchRoom: mockFetchRoom,
}));

import { loadPersistedOutbox, MAX_OUTBOX_ENTRY_ATTEMPTS } from '@/services/outboxPersistence';
import { consumeRemoteActions, resetSyncBridge, restoreOutbox, netEndTurn } from '@/services/syncBridge';
import { useGameStore } from '@/store/gameStore';
import { useMultiplayerStore } from '@/store/multiplayerStore';

const ROOM_CODE = 'ABCD';

beforeEach(() => {
  store.clear();
  mockPushAction.mockReset();
  mockFetchRoom.mockReset();
  resetSyncBridge();

  useGameStore.getState().startMatch(1, true);
  useMultiplayerStore.setState({
    status: 'MATCH_STARTED',
    playerId: 'player1',
    roomCode: ROOM_CODE,
    outboxStatus: 'idle',
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('broadcast (via netEndTurn) — grava no outbox persistido', () => {
  it('publica no Firebase E espelha a entrada em disco', async () => {
    mockPushAction.mockResolvedValue(undefined);

    const played = netEndTurn();
    expect(played).toBe(true);

    // `drainOutbox` é fire-and-forget dentro de `broadcast` — espera o
    // microtask da promessa resolvida rodar antes de checar o resultado.
    await vi.waitFor(() => expect(mockPushAction).toHaveBeenCalledTimes(1));
    expect(mockPushAction).toHaveBeenCalledWith(
      ROOM_CODE,
      expect.objectContaining({ type: 'END_TURN', by: 'player1' }),
    );

    // Sucesso confirmado ⇒ a entrada some do espelho em disco também, não só
    // da memória.
    await vi.waitFor(async () => expect(await loadPersistedOutbox()).toEqual([]));
  });
});

describe('drainOutbox — desiste depois de MAX_OUTBOX_ENTRY_ATTEMPTS, não tenta para sempre', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('descarta a entrada, marca outboxStatus "failed" (sala ativa), e para de tentar', async () => {
    mockPushAction.mockRejectedValue(new Error('rede fora do ar'));

    netEndTurn();

    // `runAllTimersAsync` intercala avanço de timer com o loop de
    // microtasks — necessário porque `drainOutbox` faz `await pushAction()`
    // (uma promessa real, não só um timer) entre cada backoff.
    await vi.runAllTimersAsync();

    expect(mockPushAction).toHaveBeenCalledTimes(MAX_OUTBOX_ENTRY_ATTEMPTS);
    expect(useMultiplayerStore.getState().outboxStatus).toBe('failed');
    expect(await loadPersistedOutbox()).toEqual([]); // descartada, não fica presa em disco

    // Nenhuma tentativa a mais depois do descarte.
    mockPushAction.mockClear();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(mockPushAction).not.toHaveBeenCalled();
  });

  it('NÃO marca outboxStatus "failed" quando a entrada descartada é de uma sala que não é mais a ativa', async () => {
    mockPushAction.mockRejectedValue(new Error('sala morta'));

    netEndTurn(); // entra no outbox como ROOM_CODE

    // O jogador já saiu dessa sala e entrou numa outra ANTES do outbox
    // terminar de desistir da entrada antiga — cenário de restauração em
    // segundo plano descrito em `useMultiplayerSync.ts`.
    useMultiplayerStore.setState({ roomCode: 'ZZZZ' });

    await vi.runAllTimersAsync();

    expect(mockPushAction).toHaveBeenCalledTimes(MAX_OUTBOX_ENTRY_ATTEMPTS);
    expect(useMultiplayerStore.getState().outboxStatus).not.toBe('failed');
  });
});

describe('restoreOutbox — retoma o envio sem reaplicar nada ao GameState', () => {
  it('reenvia uma entrada persistida e NUNCA toca o motor do jogo', async () => {
    // Simula uma ação que já tinha sido aplicada localmente (o `turn` já
    // reflete a jogada) antes do processo morrer com o outbox ainda cheio —
    // exatamente o estado que `restoreOutbox` deve encontrar ao reabrir.
    await import('@/services/outboxPersistence').then(({ savePersistedOutbox }) =>
      savePersistedOutbox([
        {
          roomCode: ROOM_CODE,
          action: { type: 'END_TURN', by: 'player1', at: Date.now() },
          attempts: 0,
          createdAt: Date.now(),
        },
      ]),
    );

    const turnBefore = useGameStore.getState().turn;
    const turnCountBefore = useGameStore.getState().turnCount;

    mockPushAction.mockResolvedValue(undefined);
    await restoreOutbox();
    await vi.waitFor(() => expect(mockPushAction).toHaveBeenCalledTimes(1));

    // Reenviou pro Firebase...
    expect(mockPushAction).toHaveBeenCalledWith(
      ROOM_CODE,
      expect.objectContaining({ type: 'END_TURN' }),
    );
    // ...mas o estado do JOGO não mudou nem um pouco — `restoreOutbox` só
    // termina de ENVIAR, nunca reaplica ao `useGameStore`.
    expect(useGameStore.getState().turn).toBe(turnBefore);
    expect(useGameStore.getState().turnCount).toBe(turnCountBefore);
  });

  it('idempotente: não restaura de novo se o outbox em memória já tem algo (guarda contra double-invoke)', async () => {
    const { savePersistedOutbox } = await import('@/services/outboxPersistence');
    await savePersistedOutbox([
      {
        roomCode: ROOM_CODE,
        action: { type: 'END_TURN', by: 'player1', at: Date.now() },
        attempts: 0,
        createdAt: Date.now(),
      },
    ]);

    mockPushAction.mockImplementation(() => new Promise(() => {})); // nunca resolve — mantém algo "em voo"
    await restoreOutbox();
    await vi.waitFor(() => expect(mockPushAction).toHaveBeenCalledTimes(1));

    await restoreOutbox(); // 2ª chamada, outbox já não está vazio
    expect(mockPushAction).toHaveBeenCalledTimes(1); // nenhuma tentativa extra
  });
});

describe('consumeRemoteActions — PLACE_MARK replicado herda PLACEMENT_COST automaticamente (Fase 8b)', () => {
  it('ação remota contra um combatente sem energia suficiente é recusada localmente, tabuleiro intacto', () => {
    // `netPlaceMark` e o `case 'PLACE_MARK'` de `applyLoggedAction` chamam o
    // MESMO `placeMark(combatant, index)` — o único lugar onde `canPlaceAt`
    // vive. Não deveria existir nenhum caminho de rede que burle a checagem
    // de energia nova; este teste prova isso ponta a ponta em vez de só
    // assumir pela leitura do código.
    //
    // Numa sessão de verdade, sincronizada, esta ação nunca chegaria ao log:
    // `netPlaceMark` só publica se `placeMark` já tiver aceitado localmente
    // pro autor. Construir a ação à mão aqui é o jeito de testar a guarda
    // em si — e como a recusa é tratada hoje (`applyLoggedAction` não
    // distingue "os dois lados concordam que é ilegal" de "os estados já
    // divergiram por outro motivo": qualquer recusa no replay vira
    // `reportDesync`, comportamento pré-existente, não novo desta fase).
    useGameStore.setState({ turn: 'MACHINE', machineEnergy: 0 });
    const boardBefore = useGameStore.getState().board;

    const hadDesync = consumeRemoteActions([
      { id: 'a1', type: 'PLACE_MARK', by: 'player2', at: Date.now(), index: 0 },
    ]);

    expect(hadDesync).toBe(true);
    expect(useGameStore.getState().board).toBe(boardBefore); // nada mutou
    expect(useGameStore.getState().board[0]).toBeNull();
  });
});

/**
 * Fora de escopo, deliberadamente: o caminho real de `joinRoom`/
 * `attachPresence`/`listenToRoom` contra o RTDB de verdade
 * (`multiplayerService.ts`) — mockar isso exigiria simular a superfície
 * inteira do SDK `firebase/database` (`ref`/`push`/`update`/`runTransaction`/
 * `onValue`/`onDisconnect`), desproporcional a esta correção e fora do
 * padrão de teste já estabelecido no projeto (unidade/store, não integração
 * contra SDK externo). A mecânica de retry em si (`retryAsync`) já está
 * coberta isoladamente em `retry.test.ts`; a fiação dela dentro de
 * `joinRoom` (a auto-cura do REJOIN disparando de verdade) fica pra
 * verificação manual com dois clientes.
 */
