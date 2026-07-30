import { get, onValue, push, ref, runTransaction, serverTimestamp, update } from 'firebase/database';

import { getDb } from '@/config/firebase';
import { generateSeed } from '@/engine/rng';
import type {
  MultiplayerAction,
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
 * Id anônimo deste cliente, gerado uma vez por execução do app.
 *
 * Não é autenticação — serve para o cliente reconhecer o PRÓPRIO assento
 * quando relê a sala (ex: reentrar e descobrir se já é `player1`). Quando o
 * projeto ganhar Firebase Auth anônimo, este é o ponto único a trocar pelo
 * `uid` real, e nada além deste arquivo precisa saber.
 */
const CLIENT_ID = `c_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;

export function getClientId(): string {
  return CLIENT_ID;
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
        player1: { clientId: CLIENT_ID, joinedAt: Date.now() },
        player2: null,
      },
    };

    try {
      const result = await runTransaction(roomRef(code), (current: RoomRecord | null) =>
        // `undefined` aborta a transação sem gravar — é assim que o SDK
        // sinaliza "desisti", e é o que queremos quando o código já existe.
        current === null ? room : undefined,
      );

      if (result.committed) return { code, seed, slot: 'player1' };
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

/**
 * Ocupa o assento `player2` e vira a sala para `PLAYING`.
 *
 * Também em transação: sem ela, dois jogadores lendo a sala ao mesmo tempo
 * veriam `player2: null` e ambos gravariam por cima, e a sala terminaria com
 * um dos dois silenciosamente expulso — um bug que só aparece em produção,
 * com jogadores reais, e é quase impossível de reproduzir depois.
 *
 * O motivo da recusa é capturado numa variável de fechamento porque o
 * resultado da transação só informa `committed: false`, sem dizer por quê — e
 * "código não existe" e "sala cheia" pedem mensagens diferentes na UI.
 */
/** Veredito sobre o que fazer com uma sala, dado o estado atual dela. */
type JoinDecision =
  | { kind: 'JOIN' }
  | { kind: 'REJOIN'; slot: PlayerSlot }
  | { kind: 'FAIL'; reason: MultiplayerErrorCode };

/**
 * Decide se este cliente pode entrar na sala — **função pura**.
 *
 * Separada do handler da transação para poder ser chamada duas vezes: uma
 * DENTRO dele (para decidir se grava) e outra DEPOIS (para explicar por que
 * não gravou). A alternativa seria o handler comunicar o motivo por variável
 * de fechamento, mas isso é ao mesmo tempo frágil — o handler roda várias
 * vezes sob contenção — e indefensável para o TypeScript, que não consegue
 * rastrear atribuições dentro de callback e trata a variável como se nunca
 * tivesse mudado.
 */
function classifyJoin(current: RoomRecord | null, clientId: string): JoinDecision {
  if (current === null) return { kind: 'FAIL', reason: 'ROOM_NOT_FOUND' };

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

export async function joinRoom(rawCode: string): Promise<JoinRoomResult> {
  const code = normalizeRoomCode(rawCode);

  let settled: RoomRecord | null;
  let committed: boolean;

  try {
    const result = await runTransaction(roomRef(code), (current: RoomRecord | null) => {
      if (current === null) return undefined; // aborta sem gravar
      if (classifyJoin(current, CLIENT_ID).kind !== 'JOIN') return undefined;

      return {
        ...current,
        status: 'PLAYING' as const,
        players: {
          player1: current.players?.player1 ?? null,
          player2: { clientId: CLIENT_ID, joinedAt: Date.now() },
        },
      };
    });

    // `result.snapshot` traz o estado da sala como ficou — o valor gravado se
    // commitou, ou o valor lido do servidor se abortou. É a fonte de verdade
    // tanto para a seed quanto para o diagnóstico da recusa, sem precisar de
    // uma segunda ida à rede.
    settled = result.snapshot.val() as RoomRecord | null;
    committed = result.committed;
  } catch (error) {
    throw toNetworkError(error);
  }

  if (committed && settled !== null) {
    return { code, seed: settled.seed, slot: 'player2' };
  }

  // Reentrada aborta a transação de propósito (não há nada a gravar), então
  // chega aqui com `committed: false` — mas é sucesso, não falha.
  const decision = classifyJoin(settled, CLIENT_ID);
  if (decision.kind === 'REJOIN' && settled !== null) {
    return { code, seed: settled.seed, slot: decision.slot };
  }

  const reason = decision.kind === 'FAIL' ? decision.reason : 'ROOM_NOT_FOUND';
  throw new MultiplayerError(reason, describeJoinFailure(reason, code));
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
