import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  get,
  onDisconnect,
  onValue,
  push,
  ref,
  runTransaction,
  serverTimestamp,
  set,
  update,
} from 'firebase/database';

import { getDb } from '@/config/firebase';
import { generateSeed } from '@/engine/rng';
import type {
  MultiplayerAction,
  PlayerConnectionStatus,
  PlayerPresence,
  PlayerSlot,
  RoomRecord,
  RoomSnapshot,
} from '@/types/multiplayer';

/**
 * Ponte entre o jogo e o Realtime Database.
 *
 * **Não conhece regras de jogo.** Não importa `gameStore`, não sabe o que é
 * uma peça ou uma carta — só move `MultiplayerAction` de um cliente para o
 * outro e administra o ciclo de vida da sala. Quem traduz ação em jogada é a
 * camada acima (próxima etapa); manter essa fronteira é o que impede a rede
 * de virar um segundo caminho de escrita nas regras.
 */

/* -------------------------------------------------------------------------- */
/*                                 CONSTANTES                                  */
/* -------------------------------------------------------------------------- */

const ROOMS_PATH = 'rooms';

/** Tamanho do código de sala. Curto o bastante para ditar por voz. */
const ROOM_CODE_LENGTH = 4;

/**
 * Alfabeto do código, sem caracteres ambíguos.
 *
 * Faltam de propósito `O`/`0`, `I`/`1`/`L` e `S`/`5`: o código existe para ser
 * lido em voz alta ou digitado de um print, e um par confundível transforma
 * "sala não encontrada" num beco sem saída que o jogador não sabe diagnosticar.
 * 30 símbolos ^ 4 = 810 mil combinações — folga de sobra para o volume de
 * salas simultâneas que este jogo vai ter.
 */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRTUVWXYZ23456789';

/** Tentativas de sortear um código livre antes de desistir. */
const CODE_COLLISION_RETRIES = 5;

/* -------------------------------------------------------------------------- */
/*                              IDENTIDADE LOCAL                               */
/* -------------------------------------------------------------------------- */

/**
 * Id anônimo deste cliente — persistido em disco, não gerado a cada boot.
 *
 * Não é autenticação — serve para o cliente reconhecer o PRÓPRIO assento
 * quando relê a sala (ex: reentrar e descobrir se já é `player1`). Quando o
 * projeto ganhar Firebase Auth anônimo, este é o ponto único a trocar pelo
 * `uid` real, e nada além deste arquivo precisa saber.
 *
 * A persistência é o que torna a RECONEXÃO possível. Antes, um `Math.random()`
 * fresco a cada carregamento do módulo significava que um F5 trocava a
 * identidade do jogador no meio da partida: ele reabria o app, tentava entrar
 * na MESMA sala, e `classifyJoin` via um `clientId` que nunca tinha visto —
 * um estranho batendo numa vaga já ocupada (a dele mesmo, `ROOM_FULL`). Ler o
 * id salvo antes de sortear um novo é o que faz o app reconhecer "sou eu de
 * novo" depois do refresh, sem precisar de nenhuma lógica extra em
 * `classifyJoin` — a REJOIN que já existia lá passa a disparar sozinha.
 */
const CLIENT_ID_KEY = '@tic-tac-boom/clientId';

let cachedClientId: string | null = null;

async function resolveClientId(): Promise<string> {
  if (cachedClientId) return cachedClientId;

  const stored = await AsyncStorage.getItem(CLIENT_ID_KEY).catch(() => null);
  if (stored) {
    cachedClientId = stored;
    return stored;
  }

  const fresh = `c_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
  cachedClientId = fresh;
  await AsyncStorage.setItem(CLIENT_ID_KEY, fresh).catch(() => {
    // Sem disco (modo privado, quota cheia): segue só com a cópia em memória.
    // Pior caso é perder a reconexão pós-F5 — não a partida em andamento.
  });
  return fresh;
}

export async function getClientId(): Promise<string> {
  return resolveClientId();
}

/* -------------------------------------------------------------------------- */
/*                          PRESENÇA (onDisconnect)                            */
/* -------------------------------------------------------------------------- */

/**
 * Gatilho nativo do servidor: se ESTE cliente cair sem avisar (rede caiu, aba
 * fechada, app morto), o próprio RTDB escreve `DISCONNECTED` no lugar dele.
 *
 * O padrão é o recomendado pela documentação do RTDB, e a razão de escutar
 * `.info/connected` em vez de armar o `onDisconnect` uma vez só é sutil: um
 * `onDisconnect` é consumido pelo servidor na hora em que a queda acontece —
 * ele não "continua vigiando" para a PRÓXIMA queda depois que o cliente
 * reconecta. `.info/connected` dispara `true` a cada nova conexão (a
 * primeira E qualquer reconexão depois de uma queda), e é isso que garante
 * o gatilho estar sempre armado de novo antes de escrever `CONNECTED`.
 *
 * Chamado depois de garantir o assento (`createRoom`/`joinRoom`, inclusive no
 * caminho de REJOIN) — nunca antes, porque só faz sentido vigiar um caminho
 * que já sabemos que existe.
 */
function attachPresence(code: string, slot: PlayerSlot): void {
  detachPresence(); // nunca dois gatilhos vivos ao mesmo tempo neste cliente

  const statusRef = ref(getDb(), `${ROOMS_PATH}/${code}/players/${slot}/status`);
  const connectedRef = ref(getDb(), '.info/connected');

  const stopWatchingConnection = onValue(connectedRef, (snapshot) => {
    if (snapshot.val() !== true) return;

    // Ordem importa: arma o gatilho de queda ANTES de anunciar presença. Uma
    // queda entre as duas escritas com a ordem invertida deixaria o status
    // preso em CONNECTED para sempre — o pior tipo de falha aqui, porque é
    // silenciosa.
    onDisconnect(statusRef)
      .set('DISCONNECTED' satisfies PlayerConnectionStatus)
      .then(() => set(statusRef, 'CONNECTED' satisfies PlayerConnectionStatus))
      .catch((error: unknown) => {
        console.warn('[multiplayerService] falha ao armar presença:', error);
      });
  });

  activePresence = {
    detach: () => {
      stopWatchingConnection();
      void onDisconnect(statusRef).cancel();
    },
  };
}

let activePresence: { detach: () => void } | null = null;

/**
 * Desarma a presença deste cliente. Chamado ao sair deliberadamente da sala —
 * sem isto, o `onDisconnect` continuaria armado apontando para uma sala que o
 * jogador já decidiu abandonar por vontade própria, não por queda.
 */
export function detachPresence(): void {
  activePresence?.detach();
  activePresence = null;
}

/* -------------------------------------------------------------------------- */
/*                                   ERROS                                     */
/* -------------------------------------------------------------------------- */

/** Motivos previsíveis de falha — a UI decide a mensagem a partir do `code`. */
export type MultiplayerErrorCode =
  | 'ROOM_NOT_FOUND'
  | 'ROOM_FULL'
  | 'ROOM_ALREADY_STARTED'
  | 'CODE_COLLISION'
  | 'NETWORK';

/**
 * Erro tipado.
 *
 * Existe para a UI distinguir "código errado" (o jogador corrige e tenta de
 * novo) de "sem internet" (não adianta tentar de novo) sem comparar strings
 * de mensagem, que quebram na primeira vez que alguém reescreve o texto.
 */
export class MultiplayerError extends Error {
  constructor(
    readonly code: MultiplayerErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'MultiplayerError';
  }
}

/* -------------------------------------------------------------------------- */
/*                                  HELPERS                                    */
/* -------------------------------------------------------------------------- */

function randomRoomCode(): string {
  let code = '';
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
    code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return code;
}

/**
 * Normaliza o código digitado pelo jogador.
 *
 * Maiúsculas e sem espaços: o teclado do celular capitaliza de forma
 * inconsistente e o jogador cola o código com espaço no fim. Sem isto, uma
 * sala existente responde "não encontrada" por causa de um espaço invisível.
 */
export function normalizeRoomCode(input: string): string {
  return input.trim().toUpperCase().replace(/\s+/g, '');
}

/**
 * `RoomRecord` cru ➜ `RoomSnapshot` consumível.
 *
 * Converte `actions` de `Record` para array ordenado. A ordem vem das chaves
 * do `push()`, que são cronologicamente ordenáveis por construção — é isso
 * que dá ao event sourcing uma sequência estável sem precisar de um contador
 * compartilhado (que teria corrida entre os dois clientes).
 */
function toRoomSnapshot(record: RoomRecord): RoomSnapshot {
  const actionsRecord = record.actions ?? {};

  // A chave do `push()` acompanha o payload como `id`: é ela que identifica a
  // ação de forma única e idêntica nos dois clientes, e é sobre ela que a
  // ponte decide "esta eu já apliquei".
  const actions = Object.keys(actionsRecord)
    .sort()
    .map((key) => ({ ...actionsRecord[key], id: key }));

  return {
    code: record.code,
    status: record.status,
    seed: record.seed,
    createdAt: record.createdAt,
    // O RTDB omite nós nulos: uma sala em LOBBY não tem `players.player2`, e
    // `players` inteiro pode faltar. Reconstruímos a forma completa aqui para
    // ninguém acima precisar de optional chaining a cada acesso.
    players: {
      player1: record.players?.player1 ?? null,
      player2: record.players?.player2 ?? null,
    },
    actions,
  };
}

function roomRef(code: string) {
  return ref(getDb(), `${ROOMS_PATH}/${code}`);
}

/**
 * Referência CIRÚRGICA a um assento — não à sala inteira.
 *
 * É o que faz a transação de `joinRoom` ser segura mesmo com o cache local
 * frio (cliente que acabou de abrir o app, nunca leu este caminho). O SDK do
 * RTDB, sem valor em cache, chuta `null` na primeira passada do callback de
 * `runTransaction` — e se o callback ABORTA justamente quando vê `null`
 * (como uma transação na sala inteira checando "ela existe?"), a transação
 * desiste ali mesmo, sem nunca perguntar ao servidor se o chute estava certo.
 *
 * Escopar no assento inverte a polaridade: o palpite otimista (`null` = vago)
 * agora é o caminho que ESCREVE, nunca o que aborta. Na pior hipótese (a vaga
 * já estava ocupada e o cache frio não sabia), o SDK tenta gravar, o servidor
 * rejeita por divergência, e só ENTÃO o callback roda de novo com o valor
 * real — processo transparente do próprio `runTransaction`, até 25 vezes.
 * Abortar por engano deixou de ser possível.
 */
function playerRef(code: string, slot: PlayerSlot) {
  return ref(getDb(), `${ROOMS_PATH}/${code}/players/${slot}`);
}

/* -------------------------------------------------------------------------- */
/*                                CRIAR SALA                                   */
/* -------------------------------------------------------------------------- */

export interface CreateRoomResult {
  code: string;
  seed: number;
  slot: PlayerSlot;
}

/**
 * Cria uma sala e assume o assento `player1`.
 *
 * A seed é sorteada AQUI, uma vez, e passa a ser a fonte da verdade do
 * determinismo: quem entra depois recebe a mesma seed e reproduz exatamente
 * as mesmas mãos iniciais e sorteios. Usa `generateSeed()` da engine — a
 * única fonte de entropia do projeto — em vez de um `Math.random` novo, para
 * manter esse invariante num lugar só.
 *
 * `runTransaction` (e não `set`) porque dois jogadores podem sortear o mesmo
 * código no mesmo instante: a transação só grava se o nó ainda estiver vazio,
 * e quem perder a corrida sorteia outro código.
 */
export async function createRoom(): Promise<CreateRoomResult> {
  const seed = generateSeed();
  const clientId = await getClientId();

  for (let attempt = 0; attempt < CODE_COLLISION_RETRIES; attempt++) {
    const code = randomRoomCode();

    const room: RoomRecord = {
      code,
      status: 'LOBBY',
      seed,
      // `serverTimestamp()` é um placeholder que o servidor resolve na
      // gravação — o relógio do cliente pode estar errado, e `createdAt` é o
      // que uma futura limpeza de salas abandonadas vai usar. O cast existe
      // porque o SDK tipa o placeholder como `object`, mas o que fica gravado
      // (e o que lemos de volta) é um número.
      createdAt: serverTimestamp() as unknown as number,
      players: {
        player1: { clientId, joinedAt: Date.now(), status: 'CONNECTED' },
        player2: null,
      },
    };

    try {
      const result = await runTransaction(roomRef(code), (current: RoomRecord | null) =>
        // `undefined` aborta a transação sem gravar — é assim que o SDK
        // sinaliza "desisti", e é o que queremos quando o código já existe.
        current === null ? room : undefined,
      );

      if (result.committed) {
        attachPresence(code, 'player1');
        return { code, seed, slot: 'player1' };
      }
    } catch (error) {
      throw toNetworkError(error);
    }
  }

  throw new MultiplayerError(
    'CODE_COLLISION',
    'Não foi possível gerar um código livre. Tente de novo.',
  );
}

/* -------------------------------------------------------------------------- */
/*                                ENTRAR NA SALA                               */
/* -------------------------------------------------------------------------- */

export interface JoinRoomResult {
  code: string;
  /** A seed da sala — é ela que o `startMatch` do jogo precisa receber. */
  seed: number;
  slot: PlayerSlot;
}

/** Veredito do pré-check, dado o snapshot atual da sala. */
type JoinDecision =
  | { kind: 'JOIN' }
  | { kind: 'REJOIN'; slot: PlayerSlot }
  | { kind: 'FAIL'; reason: MultiplayerErrorCode };

/**
 * Pré-check rápido — **função pura**, não decide nada sob concorrência.
 *
 * Só distingue, a partir do snapshot que acabou de chegar, "este cliente já
 * tem assento aqui" (REJOIN — reentrada depois de recarregar o app) de "sala
 * cheia ou já começou, nem tente" (FAIL) de "prossiga" (JOIN). Quem decide de
 * fato se a vaga está livre, sob concorrência de dois clientes entrando ao
 * mesmo tempo, é a transação cirúrgica em `playerRef` logo abaixo — isto aqui
 * só evita a viagem de rede óbvia quando a resposta já dá para saber sem ela.
 */
function classifyJoin(current: RoomRecord, clientId: string): JoinDecision {
  // Reentrada: este cliente JÁ ocupa um assento (voltou da tela de jogo,
  // recarregou o app). Não é entrada nova — devolve o assento que ele já
  // tinha, em vez de recusar por "sala cheia" e deixá-lo de fora da própria
  // partida.
  if (current.players?.player1?.clientId === clientId) return { kind: 'REJOIN', slot: 'player1' };
  if (current.players?.player2?.clientId === clientId) return { kind: 'REJOIN', slot: 'player2' };

  if (current.status !== 'LOBBY') return { kind: 'FAIL', reason: 'ROOM_ALREADY_STARTED' };
  if (current.players?.player2) return { kind: 'FAIL', reason: 'ROOM_FULL' };

  return { kind: 'JOIN' };
}

/**
 * Ocupa o assento `player2`.
 *
 * Dois passos deliberadamente separados:
 *
 * 1. `get()` na sala inteira — só para EXISTÊNCIA, seed e o pré-check de
 *    `classifyJoin` (reentrada / sala já encerrada). Rápido de descartar sem
 *    gastar uma transação.
 * 2. Transação CIRÚRGICA em `players/player2` — a única fonte de verdade
 *    sobre a vaga estar livre. Ver `playerRef` para o porquê de o escopo
 *    importar: uma transação na sala inteira (a versão anterior desta função)
 *    aborta em silêncio contra um cache frio, porque o palpite otimista do
 *    SDK (`null`) coincide com a condição de abort ("sala não existe"). Aqui
 *    o palpite otimista coincide com a condição de ESCREVER ("vaga livre"),
 *    então o cache frio nunca impede a transação de perguntar ao servidor.
 *
 * Depois de garantir a vaga, vira a sala para `PLAYING` — sinal que acorda o
 * listener do outro cliente (`multiplayerStore`) para a partida ter começado.
 * Ninguém além do dono da vaga faz essa escrita, então não há corrida aqui.
 */
export async function joinRoom(rawCode: string): Promise<JoinRoomResult> {
  const code = normalizeRoomCode(rawCode);

  const probe = await get(roomRef(code)).catch((error: unknown) => {
    throw toNetworkError(error);
  });

  if (!probe.exists()) {
    throw new MultiplayerError('ROOM_NOT_FOUND', describeJoinFailure('ROOM_NOT_FOUND', code));
  }

  const room = probe.val() as RoomRecord;
  const clientId = await getClientId();
  const decision = classifyJoin(room, clientId);

  if (decision.kind === 'REJOIN') {
    // Reconexão (F5, app reaberto): a vaga já é dele, só falta rearmar a
    // presença — o `onDisconnect` da sessão anterior morreu junto com a
    // conexão antiga e não vigia mais a PRÓXIMA queda sozinho.
    attachPresence(code, decision.slot);
    return { code, seed: room.seed, slot: decision.slot };
  }
  if (decision.kind === 'FAIL') {
    throw new MultiplayerError(decision.reason, describeJoinFailure(decision.reason, code));
  }

  let committed: boolean;
  try {
    const txResult = await runTransaction(
      playerRef(code, 'player2'),
      (currentP2: PlayerPresence | null) => {
        if (currentP2 !== null) return undefined; // vaga ocupada, aborta
        return { clientId, joinedAt: Date.now(), status: 'CONNECTED' } satisfies PlayerPresence;
      },
    );
    committed = txResult.committed;
  } catch (error) {
    throw toNetworkError(error);
  }

  // A vaga foi ocupada por outra pessoa entre o pré-check e agora — a mesma
  // corrida que o comentário de `playerRef` descreve, só que desta vez real.
  if (!committed) {
    throw new MultiplayerError('ROOM_FULL', describeJoinFailure('ROOM_FULL', code));
  }

  try {
    await update(roomRef(code), { status: 'PLAYING' satisfies RoomRecord['status'] });
  } catch (error) {
    throw toNetworkError(error);
  }

  attachPresence(code, 'player2');
  return { code, seed: room.seed, slot: 'player2' };
}

function describeJoinFailure(code: MultiplayerErrorCode, roomCode: string): string {
  switch (code) {
    case 'ROOM_NOT_FOUND':
      return `Sala ${roomCode} não existe. Confira o código.`;
    case 'ROOM_FULL':
      return `A sala ${roomCode} já tem dois jogadores.`;
    case 'ROOM_ALREADY_STARTED':
      return `A partida da sala ${roomCode} já começou.`;
    default:
      return 'Não foi possível entrar na sala.';
  }
}

/* -------------------------------------------------------------------------- */
/*                                  ESCUTAR                                    */
/* -------------------------------------------------------------------------- */

/** Cancela a inscrição. Chame sempre no cleanup do efeito/ao sair da sala. */
export type Unsubscribe = () => void;

/**
 * Escuta o nó da sala inteiro e dispara `callback` a cada mudança.
 *
 * Um listener em `/rooms/[code]` (e não dois, um em `status` e outro em
 * `actions`) de propósito: o RTDB entrega o nó completo a cada mudança de
 * qualquer descendente, então um listener só já cobre os dois casos que
 * importam — status virando `PLAYING` e ação nova publicada — e o consumidor
 * recebe um snapshot sempre coerente, nunca `status` novo com `actions`
 * velho.
 *
 * `callback` recebe `null` se a sala for apagada (host desistiu), para a UI
 * poder voltar ao menu em vez de esperar para sempre.
 */
export function listenToRoom(
  code: string,
  callback: (snapshot: RoomSnapshot | null) => void,
  onError?: (error: MultiplayerError) => void,
): Unsubscribe {
  return onValue(
    roomRef(code),
    (snapshot) => {
      const value = snapshot.val() as RoomRecord | null;
      callback(value === null ? null : toRoomSnapshot(value));
    },
    (error) => onError?.(toNetworkError(error)),
  );
}

/** Leitura pontual da sala. Útil para checar antes de entrar, sem abrir listener. */
export async function fetchRoom(code: string): Promise<RoomSnapshot | null> {
  try {
    const snapshot = await get(roomRef(normalizeRoomCode(code)));
    const value = snapshot.val() as RoomRecord | null;
    return value === null ? null : toRoomSnapshot(value);
  } catch (error) {
    throw toNetworkError(error);
  }
}

/* -------------------------------------------------------------------------- */
/*                             PUBLICAR AÇÕES                                  */
/* -------------------------------------------------------------------------- */

/**
 * Publica um input em `/rooms/[code]/actions`.
 *
 * `push()` (e não `set` com índice) porque a chave gerada é única por cliente
 * e ordenável no tempo: dois clientes publicando ao mesmo tempo nunca
 * sobrescrevem um ao outro, e a ordem de leitura é a mesma nos dois lados —
 * os dois pré-requisitos para o event sourcing convergir.
 *
 * A ponte que consome estas ações e as aplica no `gameStore` é a PRÓXIMA
 * etapa; esta função existe para o contrato ficar fechado desde já.
 */
export async function pushAction(code: string, action: MultiplayerAction): Promise<void> {
  try {
    await push(ref(getDb(), `${ROOMS_PATH}/${code}/actions`), action);
  } catch (error) {
    throw toNetworkError(error);
  }
}

/* -------------------------------------------------------------------------- */
/*                                   SAIR                                      */
/* -------------------------------------------------------------------------- */

/**
 * Marca a sala como encerrada ao sair.
 *
 * Não apaga o nó: o outro jogador precisa RECEBER a mudança de status para
 * saber que ficou sozinho. Apagar direto faria o listener dele disparar com
 * `null` sem distinguir "o host saiu" de "erro de rede", e a limpeza do nó
 * fica para uma rotina de manutenção que use `createdAt`.
 */
export async function leaveRoom(code: string): Promise<void> {
  try {
    await update(roomRef(code), { status: 'FINISHED' satisfies RoomRecord['status'] });
  } catch {
    // Silencioso de propósito: sair da sala é um caminho de saída do jogador.
    // Falhar aqui (offline, sala já apagada) não pode impedi-lo de voltar ao
    // menu nem virar um alerta sobre algo que ele já decidiu abandonar.
  }
}

/* -------------------------------------------------------------------------- */
/*                                                                             */
/* -------------------------------------------------------------------------- */

/** Envelopa qualquer falha do SDK como erro de rede tipado. */
function toNetworkError(error: unknown): MultiplayerError {
  if (error instanceof MultiplayerError) return error;
  const detail = error instanceof Error ? error.message : String(error);
  return new MultiplayerError('NETWORK', `Falha de conexão com o servidor. ${detail}`);
}
