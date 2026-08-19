import { fetchRoom, pushAction } from '@/services/multiplayerService';
import {
  loadPersistedOutbox,
  savePersistedOutbox,
  MAX_OUTBOX_ENTRY_ATTEMPTS,
  type OutboxEntry,
} from '@/services/outboxPersistence';
import { useGameStore } from '@/store/gameStore';
import { selectOpponentConnectionStatus, useMultiplayerStore } from '@/store/multiplayerStore';
import type { Combatant, InteractionSelection } from '@/engine/rules';
import type { MultiplayerAction, PlayerSlot, StoredAction } from '@/types/multiplayer';

/**
 * O cordão umbilical entre o motor de jogo e a rede.
 *
 * **Ninguém dos dois lados sabe da existência do outro.** O `gameStore`
 * continua sendo uma máquina de estados determinística que não conhece
 * Firebase; o `multiplayerService` continua movendo bytes sem saber o que é
 * uma peça. Este arquivo é o único lugar que fala as duas línguas — e é de
 * propósito que ele seja o único: qualquer outro ponto do app que traduzisse
 * rede em jogada criaria um segundo caminho de escrita nas regras, e a
 * primeira divergência entre clientes seria impossível de rastrear.
 *
 * O modelo é **event sourcing sobre seed determinística**: os dois clientes
 * partem da mesma seed (ver `createRoom`), aplicam a mesma sequência de
 * inputs, e por construção chegam ao mesmo estado. Só os inputs trafegam.
 */

/* -------------------------------------------------------------------------- */
/*                      O MAPA QUE TUDO AQUI DEPENDE                           */
/* -------------------------------------------------------------------------- */

/**
 * Assento na sala ➜ combatente na engine.
 *
 * **Este é o conceito central da fase, e a fonte de todo bug sutil se
 * invertido.** São dois eixos diferentes:
 *
 * - `Combatant` (`PLAYER`/`MACHINE`) é um papel na SIMULAÇÃO. Como os dois
 *   clientes rodam a mesma simulação com a mesma seed, `turn === 'PLAYER'`
 *   acontece no mesmo instante nos dois aparelhos.
 * - `PlayerSlot` (`player1`/`player2`) é uma pessoa na SALA.
 *
 * O que muda entre os clientes não é a simulação — é quem, dentro dela, sou
 * "eu". Para quem criou a sala, `PLAYER` é ele; para quem entrou, `PLAYER` é
 * o adversário. Comparar `turn` (Combatant) com `playerId` (PlayerSlot)
 * diretamente, como é tentador, compara dois espaços de tipo diferentes e
 * dá sempre `false`.
 */
export const COMBATANT_BY_SLOT: Record<PlayerSlot, Combatant> = {
  player1: 'PLAYER',
  player2: 'MACHINE',
};

/**
 * Qual combatente este cliente controla.
 *
 * `'PLAYER'` fora do modo online — é o que mantém os modos local e CPU
 * funcionando sem nenhum ramo condicional espalhado pela UI.
 */
export function getLocalCombatant(): Combatant {
  const { status, playerId } = useMultiplayerStore.getState();
  if (status !== 'MATCH_STARTED' || playerId === null) return 'PLAYER';
  return COMBATANT_BY_SLOT[playerId];
}

/** Estamos numa partida online em andamento? */
export function isOnlineMatch(): boolean {
  const { status, playerId, roomCode } = useMultiplayerStore.getState();
  return status === 'MATCH_STARTED' && playerId !== null && roomCode !== null;
}

/**
 * É a vez do jogador local?
 *
 * Fora do online devolve `true` sempre — quem decide se dá para jogar é o
 * `canPlaceAt`/`selectCanPlayCards` de sempre. Esta função existe só para
 * acrescentar a trava de rede por cima, nunca para substituir as guardas da
 * engine.
 */
export function isLocalTurn(): boolean {
  if (!isOnlineMatch()) return true;
  return useGameStore.getState().turn === getLocalCombatant();
}

/**
 * O OPONENTE está com o socket vivo agora?
 *
 * `selectOpponentConnectionStatus` é escrito pelo `onDisconnect` armado em
 * `multiplayerService.attachPresence` — nunca por este cliente sobre si
 * mesmo. Distinto de "é a vez dele": um oponente pode estar conectado e
 * travado esperando a própria vez, ou desconectado bem no meio da própria
 * vez — os dois eixos são independentes.
 *
 * Fora do online devolve `true` pelo mesmo motivo de `isLocalTurn`: não
 * existe "o outro lado" para cair nos modos local/CPU. `null` (ainda sem
 * snapshot) também conta como conectado — não bloqueia por falta de dado.
 */
export function isOpponentConnected(): boolean {
  if (!isOnlineMatch()) return true;
  return selectOpponentConnectionStatus(useMultiplayerStore.getState()) !== 'DISCONNECTED';
}

/* -------------------------------------------------------------------------- */
/*                          ESTADO DA PONTE (por partida)                      */
/* -------------------------------------------------------------------------- */
/* Estado de módulo, fora dos dois stores de propósito: é maquinário de
   sincronização, não estado de jogo nem de UI. Colocá-lo num store faria
   cada ação em trânsito disparar re-render, e — pior — o colocaria dentro do
   snapshot determinístico do jogo, contaminando o replay com dados de rede. */

/**
 * Ids de ação já aplicados (ou deliberadamente ignorados) neste cliente.
 *
 * **A trava anti-loop.** Uma ação publicada volta pelo listener para quem a
 * publicou; sem esta marca, o autor a aplicaria uma segunda vez e — se a
 * facade republicasse — o par entraria em ping-pong infinito. Marcar por
 * `id` (a chave do `push()`) resolve os dois lados: o eco do próprio envio é
 * reconhecido e descartado, e uma reconexão que reentregue o log inteiro não
 * reaplica nada.
 */
let processedActionIds = new Set<string>();

/**
 * Trava de reentrância.
 *
 * Ativa enquanto uma ação VINDA DA REDE está sendo aplicada no `gameStore`.
 * A facade de saída consulta isto e recusa publicar — é a segunda linha de
 * defesa do anti-loop, independente do `processedActionIds`: mesmo que a
 * marcação por id falhasse, uma ação remota jamais seria retransmitida.
 */
let isApplyingNetworkAction = false;

/**
 * Autor da última ação aplicada. **É a autoridade do ACKNOWLEDGE.**
 *
 * Toda pausa de confirmação nasce como consequência síncrona de aplicar
 * alguma ação: uma carta de espionagem (autor = quem jogou a carta) ou uma
 * armadilha disparada (autor = quem posicionou a peça). Guardar o autor da
 * ação em curso resolve os dois casos com uma regra só.
 *
 * A alternativa óbvia — "quem tem o turno confirma" — está ERRADA para
 * armadilhas: `placeMark` troca `turn` para o oponente ANTES de publicar
 * `PIECE_PLACED`, então quando a armadilha enfileira a confirmação o turno já
 * pertence a quem NÃO fez a jogada. A autoridade cairia sistematicamente na
 * pessoa errada.
 */
let lastActionAuthor: PlayerSlot | null = null;

/**
 * Zera a ponte. Chamado ao entrar numa partida — sem isto, ids de uma sala
 * anterior fariam a ponte ignorar ações legítimas da sala nova.
 *
 * **Só o estado EM MEMÓRIA.** Nunca apaga o outbox persistido em disco
 * (`outboxPersistence.ts`) — é exatamente esse persistido que precisa
 * sobreviver a este reset para alimentar `restoreOutbox()` logo em seguida
 * (`useMultiplayerSync.ts` chama os dois em sequência). Apagar o persistido
 * aqui destruiria a própria recuperação que ele existe para viabilizar.
 */
export function resetSyncBridge(): void {
  processedActionIds = new Set<string>();
  isApplyingNetworkAction = false;
  lastActionAuthor = null;
  outbox = [];
  draining = false;
  if (retryTimeoutId !== null) {
    clearTimeout(retryTimeoutId);
    retryTimeoutId = null;
    resolveCurrentWait = null;
  }
  useMultiplayerStore.setState({ outboxStatus: 'idle' });
}

/**
 * Quem tem autoridade para confirmar a pausa atual, ou `null` se não houver
 * pausa/partida online.
 */
export function getAcknowledgementAuthority(): PlayerSlot | null {
  if (!isOnlineMatch()) return null;
  if (useGameStore.getState().pendingAcknowledgement === null) return null;
  return lastActionAuthor;
}

/**
 * O jogador local pode confirmar a pausa atual?
 *
 * Fora do online, sempre. No online, só o autor da ação que criou a pausa —
 * é isso que impede os dois clientes de publicarem `ACKNOWLEDGE` e a fila ser
 * consumida duas vezes, pulando uma revelação inteira sem ninguém ver.
 */
export function canLocalAcknowledge(): boolean {
  if (!isOnlineMatch()) return true;
  const authority = getAcknowledgementAuthority();
  // Sem autor registrado (ex: pausa criada antes de a ponte ver qualquer
  // ação): libera. Travar os dois lados seria um deadlock — melhor arriscar
  // uma confirmação duplicada, que a marcação por id absorve.
  if (authority === null) return true;
  return authority === useMultiplayerStore.getState().playerId;
}

/* -------------------------------------------------------------------------- */
/*                      SAÍDA: LOCAL ➜ REDE (a facade)                         */
/* -------------------------------------------------------------------------- */
/* A UI chama estas funções em vez de `useGameStore.getState().placeMark(...)`
   direto. Fora do online elas são um repasse puro, então os modos local e CPU
   não pagam nada por existirem.                                              */

/**
 * Ações aplicadas localmente mas ainda não confirmadas pelo servidor,
 * processadas em ORDEM ESTRITA — nunca duas em voo ao mesmo tempo.
 *
 * A razão de não paralelizar: a ordem que o OUTRO cliente lê é a ordem de
 * ESCRITA no Firebase (a chave cronológica do `push()`), não a ordem em que
 * este cliente PRETENDIA enviar. Se a ação #1 estivesse retentando enquanto a
 * #2 já tivesse sido publicada com sucesso, a #2 chegaria ao servidor (e ao
 * outro cliente) antes da #1 — corrompendo a sequência que o event sourcing
 * depende para os dois lados chegarem ao mesmo estado.
 */
let outbox: OutboxEntry[] = [];
let draining = false;
let retryTimeoutId: ReturnType<typeof setTimeout> | null = null;
let resolveCurrentWait: (() => void) | null = null;

/** Backoff exponencial, com teto — não cresce sem limite. */
const RETRY_DELAYS_MS = [1000, 2000, 4000, 8000];

/**
 * Depois de quantas tentativas malsucedidas o status reportado à UI vira
 * `'stalled'` em vez de `'retrying'` — só muda o RÓTULO (comunica urgência
 * crescente). **Não é o ponto em que se desiste** — isso só acontece bem
 * mais tarde, em `MAX_OUTBOX_ENTRY_ATTEMPTS` (`outboxPersistence.ts`, muito
 * maior que este número): desistir permanentemente de publicar uma ação já
 * aplicada localmente é uma dessincronia PERMANENTE sem saída, então o
 * padrão aqui continua sendo "nunca desiste sozinho" — a exceção documentada
 * é só depois de dezenas de tentativas, quando insistir deixou de ser
 * otimismo e virou desperdício (ver o `if` de descarte em `drainOutbox`).
 */
const STALLED_AFTER_ATTEMPTS = 5;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    resolveCurrentWait = resolve;
    retryTimeoutId = setTimeout(() => {
      retryTimeoutId = null;
      resolveCurrentWait = null;
      resolve();
    }, ms);
  });
}

/**
 * Corta a espera de backoff atual (se houver) e libera `drainOutbox` para
 * tentar de novo imediatamente. É o que o botão "TENTAR AGORA" da UI chama —
 * não cancela nem reordena nada, só encurta o tempo até a próxima tentativa.
 */
export function retryOutboxNow(): void {
  if (retryTimeoutId === null || resolveCurrentWait === null) return;
  clearTimeout(retryTimeoutId);
  retryTimeoutId = null;
  const resolve = resolveCurrentWait;
  resolveCurrentWait = null;
  resolve();
}

async function drainOutbox(): Promise<void> {
  if (draining) return;
  draining = true;

  while (outbox.length > 0) {
    const entry = outbox[0];
    try {
      await pushAction(entry.roomCode, entry.action);
      outbox.shift();
      void savePersistedOutbox(outbox);
      if (outbox.length === 0) useMultiplayerStore.setState({ outboxStatus: 'idle' });
    } catch (error) {
      entry.attempts += 1;
      console.warn('[syncBridge] falha ao publicar ação (tentativa', entry.attempts, '):', error);

      // Exceção documentada ao "nunca desiste" (ver `STALLED_AFTER_ATTEMPTS`
      // acima) — depois de MUITAS tentativas, insistir deixou de ser
      // otimismo. Descarta só ESTA entrada (não trava a fila inteira atrás
      // dela) e só acende o aviso pra UI se ainda for a sala ATIVA agora —
      // uma entrada de uma sala antiga/abandonada sendo descartada em
      // segundo plano não deve interromper uma partida diferente em
      // andamento na tela.
      if (entry.attempts >= MAX_OUTBOX_ENTRY_ATTEMPTS) {
        console.error(
          '[syncBridge] desistindo de publicar ação após',
          entry.attempts,
          'tentativas — descartada:',
          entry.action.type,
          'na sala',
          entry.roomCode,
        );
        outbox.shift();
        void savePersistedOutbox(outbox);
        if (entry.roomCode === useMultiplayerStore.getState().roomCode) {
          useMultiplayerStore.setState({ outboxStatus: 'failed' });
        }
        continue; // próxima entrada, sem esperar backoff por uma que já foi descartada
      }

      void savePersistedOutbox(outbox); // `attempts` mudou, mantém o espelho em disco atual
      useMultiplayerStore.setState({
        outboxStatus: entry.attempts >= STALLED_AFTER_ATTEMPTS ? 'stalled' : 'retrying',
      });
      const waitMs = RETRY_DELAYS_MS[Math.min(entry.attempts - 1, RETRY_DELAYS_MS.length - 1)];
      await delay(waitMs);
      // Sem `shift()` aqui — o loop tenta a MESMA entrada de novo, nunca pula
      // para a próxima enquanto esta não for confirmada (ver o porquê acima).
    }
  }

  draining = false;
}

/**
 * Recarrega o outbox persistido em disco e retoma o envio de onde parou.
 *
 * Chamada por `useMultiplayerSync.ts` logo depois de `resetSyncBridge()`, a
 * cada entrada/reentrada numa sala. `if (outbox.length > 0) return;` é a
 * guarda de idempotência — protege contra o double-invoke de efeito do React
 * em dev (mesmo cuidado já usado em outros componentes desta base) e contra
 * chamadas repetidas em geral: uma vez que o outbox em memória já tem algo
 * (seja de uma restauração anterior, seja de uma ação nova que o jogador
 * acabou de disparar), uma segunda restauração seria uma duplicata.
 *
 * **Nunca toca `useGameStore`.** `loadPersistedOutbox()` só devolve ações
 * que ainda faltam ser CONFIRMADAS pelo servidor — elas já foram aplicadas
 * ao motor no instante em que entraram no outbox, antes do processo morrer.
 * Restaurar aqui só retoma o lado de REDE (`pushAction`), nunca o de jogo.
 */
export async function restoreOutbox(): Promise<void> {
  if (outbox.length > 0) return;

  const restored = await loadPersistedOutbox();
  if (restored.length === 0) return;

  outbox = restored;
  void drainOutbox();
}

/** Publica a ação, se estivermos online e ela não tiver vindo da rede. */
function broadcast(build: (by: PlayerSlot) => MultiplayerAction): void {
  if (isApplyingNetworkAction) return; // anti-loop, 2ª linha de defesa
  if (!isOnlineMatch()) return;

  const { roomCode, playerId } = useMultiplayerStore.getState();
  if (roomCode === null || playerId === null) return;

  lastActionAuthor = playerId;

  // A jogada JÁ foi aplicada localmente e o jogo não pode congelar esperando
  // a rede — por isso a fila roda em segundo plano (`drainOutbox`,
  // fire-and-forget aqui) em vez de bloquear o clique. Diferente da versão
  // anterior, uma falha agora RETENTA sozinha (com backoff, ver acima) e
  // reporta o status em `multiplayerStore.outboxStatus` para a UI — não fica
  // mais só um `console.warn` que ninguém vê.
  outbox.push({ roomCode, action: build(playerId), attempts: 0, createdAt: Date.now() });
  void savePersistedOutbox(outbox);
  void drainOutbox();
}

/**
 * Posiciona uma peça e replica.
 *
 * Aplica LOCALMENTE primeiro e publica depois. Isso é seguro **porque o jogo
 * é estritamente por turnos** — não há duas ações concorrentes cuja ordem
 * relativa pudesse divergir entre os aparelhos. Num jogo com ações
 * simultâneas, este desenho estaria errado e seria preciso aplicar só o que
 * volta ordenado do servidor, ao custo de uma ida e volta de latência por
 * jogada.
 *
 * A garantia de "só um lado age por vez" não é mais só a UI (`isLocalTurn`,
 * que nem existe fora do online) — `placeMark` agora exige o combatente e
 * `canPlaceAt` recusa se não bater com `state.turn`. `getLocalCombatant()`
 * aqui é só "quem este cliente É"; a validação de verdade é a do motor.
 */
export function netPlaceMark(index: number): boolean {
  const played = useGameStore.getState().placeMark(getLocalCombatant(), index);
  if (!played) return false;

  broadcast((by) => ({ type: 'PLACE_MARK', by, at: Date.now(), index }));
  return true;
}

/**
 * Joga uma carta e replica.
 *
 * Roteia para `playCard` ou `playMachineCard` conforme o combatente local:
 * as duas são a mesma implementação (`resolveCardPlay`) com o `caster`
 * trocado, e usar a errada faria a engine recusar a jogada por "não é seu
 * turno" — silenciosamente, que é o pior modo de falhar.
 */
export function netPlayCard(uid: string, targetIndex?: number): boolean {
  const game = useGameStore.getState();
  const played =
    getLocalCombatant() === 'PLAYER'
      ? game.playCard(uid, targetIndex)
      : game.playMachineCard(uid, targetIndex);

  if (!played) return false;

  broadcast((by) => ({
    type: 'PLAY_CARD',
    by,
    at: Date.now(),
    uid,
    // `undefined` é inválido no RTDB (o SDK lança) — a normalização para
    // `null` acontece aqui, na fronteira, e a volta para `undefined` na
    // aplicação. Ver a nota no topo de `types/multiplayer.ts`.
    targetIndex: targetIndex ?? null,
  }));

  return true;
}

/**
 * Passa a vez sem colocar peça e replica.
 *
 * Mesmo padrão de `netPlaceMark`/`netPlayCard`: aplica localmente primeiro
 * (`endTurn` já valida turno/status/pausa/confirmação/mira pendente), publica
 * só se aceito.
 */
export function netEndTurn(): boolean {
  const played = useGameStore.getState().endTurn(getLocalCombatant());
  if (!played) return false;

  broadcast((by) => ({ type: 'END_TURN', by, at: Date.now() }));
  return true;
}

/**
 * Resolve o passo atual da interação pendente e replica.
 *
 * Mesmo padrão de `netPlaceMark`/`netPlayCard`/`netEndTurn`: aplica local
 * primeiro (`resolveInteraction` já valida turno/status/confirmação/se a
 * escolha bate com o passo atual), publica só se aceito. Cobre os 5 `kind`s
 * de `PendingInteraction` com uma função só — `selection` já carrega o
 * próprio `kind`.
 */
export function netResolveInteraction(selection: InteractionSelection): boolean {
  const resolved = useGameStore.getState().resolveInteraction(getLocalCombatant(), selection);
  if (!resolved) return false;

  broadcast((by) => ({ type: 'RESOLVE_INTERACTION', by, at: Date.now(), selection }));
  return true;
}

/**
 * Cancela a interação pendente e replica — devolve carta e energia nos dois
 * clientes (a lógica de reembolso roda em cada aparelho, não é transmitida).
 */
export function netCancelInteraction(): boolean {
  const cancelled = useGameStore.getState().cancelInteraction(getLocalCombatant());
  if (!cancelled) return false;

  broadcast((by) => ({ type: 'CANCEL_INTERACTION', by, at: Date.now() }));
  return true;
}

/**
 * Confirma a pausa e replica.
 *
 * Só publica quem tem autoridade (ver `canLocalAcknowledge`). O outro cliente
 * NÃO chama isto: o modal dele fecha sozinho quando o `ACKNOWLEDGE` chega
 * pela rede e libera `pendingAcknowledgement`.
 */
export function netAcknowledge(): void {
  if (isOnlineMatch() && !canLocalAcknowledge()) return;

  useGameStore.getState().acknowledgePending();
  broadcast((by) => ({ type: 'ACKNOWLEDGE', by, at: Date.now() }));
}

/**
 * Declara vitória por W.O. e replica.
 *
 * `by` é QUEM DECLAROU (o lado ainda conectado) — a UI só libera o botão que
 * chama isto depois de um período de graça vendo `isOpponentConnected()`
 * falso, então não há checagem extra aqui. Publicada como uma ação comum:
 * se o desistente reconectar mais tarde, `consumeRemoteActions` entrega este
 * `FORFEIT` do log como entregaria uma jogada perdida — sem mecanismo novo.
 */
export function netForfeit(): void {
  useGameStore.getState().forfeitMatch(getLocalCombatant());
  broadcast((by) => ({ type: 'FORFEIT', by, at: Date.now() }));
}

/* -------------------------------------------------------------------------- */
/*                      ENTRADA: REDE ➜ LOCAL                                  */
/* -------------------------------------------------------------------------- */

/**
 * Dessincronia detectada nesta chamada de `consumeRemoteActions` — ver
 * `reportDesync`/`resyncFromActionLog` abaixo.
 */
let desyncDetected = false;

/**
 * Loga uma dessincronia E marca a flag que `consumeRemoteActions` devolve.
 *
 * Não há recuperação automática possível AQUI (o histórico local já é
 * outro) — o que muda agora é que quem chama (`useMultiplayerSync`) pode
 * reagir ao valor de retorno reconstruindo o estado inteiro a partir do log
 * (`resyncFromActionLog`), em vez de deixar os dois clientes travados
 * "esperando a jogada um do outro" para sempre. Continua gritando alto no
 * console de qualquer forma: um desync é o bug mais caro de diagnosticar
 * depois, e saber QUE aconteceu (mesmo já corrigido) importa para investigar
 * a causa.
 */
function reportDesync(...args: unknown[]): void {
  console.error('[syncBridge] DESSINCRONIA:', ...args);
  desyncDetected = true;
}

/**
 * Traduz uma ação do log numa chamada do `gameStore`.
 *
 * Usada por dois chamadores com necessidades diferentes: `consumeRemoteActions`
 * (incremental, ignora ações do PRÓPRIO cliente — já rodaram no clique) e
 * `resyncFromActionLog` (reconstrução total, aplica TODAS as ações, inclusive
 * as próprias, contra um estado recém-reseedado). Por isso não assume nada
 * sobre autoria além do que `action.by` já diz — quem filtra é cada chamador.
 */
function applyLoggedAction(action: StoredAction): void {
  const game = useGameStore.getState();
  const combatant = COMBATANT_BY_SLOT[action.by];

  switch (action.type) {
    case 'PLACE_MARK': {
      const played = game.placeMark(combatant, action.index);

      // A engine recusou uma jogada que o outro cliente aceitou ⇒ os dois
      // estados divergiram.
      if (!played) {
        reportDesync(
          'a jogada remota em',
          action.index,
          'foi recusada localmente. Turno local:',
          useGameStore.getState().turn,
          '| esperado:',
          combatant,
        );
      }
      break;
    }

    case 'PLAY_CARD': {
      const target = action.targetIndex ?? undefined;
      const played =
        combatant === 'PLAYER'
          ? game.playCard(action.uid, target)
          : game.playMachineCard(action.uid, target);

      if (!played) {
        reportDesync('a carta remota', action.uid, 'foi recusada localmente.');
      }
      break;
    }

    case 'END_TURN': {
      const passed = game.endTurn(combatant);
      if (!passed) {
        reportDesync(
          'o "passar a vez" remoto de',
          combatant,
          'foi recusado localmente. Turno local:',
          useGameStore.getState().turn,
        );
      }
      break;
    }

    case 'RESOLVE_INTERACTION': {
      const resolved = game.resolveInteraction(combatant, action.selection);
      if (!resolved) {
        reportDesync('a resolução remota de interação de', combatant, 'foi recusada localmente.');
      }
      break;
    }

    case 'CANCEL_INTERACTION': {
      const cancelled = game.cancelInteraction(combatant);
      if (!cancelled) {
        reportDesync('o cancelamento remoto de interação de', combatant, 'foi recusado localmente.');
      }
      break;
    }

    case 'ACKNOWLEDGE':
      game.acknowledgePending();
      break;

    // `combatant` aqui é quem DECLAROU o W.O. (ver `netForfeit`) — vencedor,
    // não desistente. `forfeitMatch` já é o mesmo no-op em ambos os clientes
    // se a partida tiver acabado por HP antes deste log chegar.
    case 'FORFEIT':
      game.forfeitMatch(combatant);
      break;
  }
}

/**
 * Consome o log de ações da sala.
 *
 * Idempotente por construção: cada `id` é processado uma vez só, então
 * chamar isto de novo com a lista inteira (reconexão, re-render, double
 * invoke de efeito do React em dev) não reaplica nada.
 *
 * Ações do PRÓPRIO jogador são marcadas como processadas mas **não
 * aplicadas** — elas já rodaram localmente no momento do clique. É o outro
 * lado da moeda do desenho "aplica local, publica depois".
 *
 * @returns `true` se alguma ação desta chamada foi recusada localmente
 * (dessincronia) — quem chama pode reagir com `resyncFromActionLog`.
 */
export function consumeRemoteActions(actions: StoredAction[]): boolean {
  desyncDetected = false;

  for (const action of actions) {
    if (processedActionIds.has(action.id)) continue;
    processedActionIds.add(action.id);

    // Toda ação — inclusive a própria — atualiza a autoridade do
    // ACKNOWLEDGE. Os dois clientes precisam concordar sobre quem confirma, e
    // só concordam se derivarem isso do mesmo log, na mesma ordem.
    lastActionAuthor = action.by;

    if (action.by === useMultiplayerStore.getState().playerId) continue;

    isApplyingNetworkAction = true;
    try {
      applyLoggedAction(action);
    } finally {
      // `finally` e não uma atribuição no fim: se `applyLoggedAction` lançar,
      // a trava ficaria presa em `true` e o cliente pararia de publicar
      // qualquer jogada pelo resto da partida, sem nenhum sintoma óbvio.
      isApplyingNetworkAction = false;
    }
  }

  return desyncDetected;
}

/**
 * Reconstrói o estado do zero a partir do log COMPLETO da sala.
 *
 * Ao contrário de `consumeRemoteActions` (incremental, ignora as próprias
 * ações porque elas já rodaram local no clique), aqui NINGUÉM rodou nada
 * ainda: acabou de reseedar via `startMatch`, então o replay cobre TODAS as
 * ações do log, inclusive as do próprio cliente, na mesma ordem em que
 * aconteceram. Determinístico por construção (event sourcing sobre seed) —
 * os dois lados que rodarem isto a partir do MESMO log chegam no MESMO
 * estado, o que é exatamente a garantia que falta hoje quando uma
 * dessincronia acontece.
 *
 * Chamada em dois momentos, de `useMultiplayerSync.ts`: ao entrar/reentrar
 * numa sala (cobre reconexão sem precisar distinguir "sala nova" de "sala
 * retomada" — uma sala nova tem `actions` vazio, então o replay não faz
 * nada), e quando `consumeRemoteActions` sinaliza uma dessincronia. NÃO é o
 * caminho do dia a dia: repetir isto a cada ação nova reabriria banners/
 * flashes de eventos antigos (`lastDamageEvent`, `lastChaosRoulette`, etc.)
 * toda vez que o oponente jogasse — regressão visual real, não só ineficiência.
 */
export function resyncFromActionLog(seed: number, actions: StoredAction[]): void {
  useGameStore.getState().startMatch(seed, true);

  processedActionIds = new Set<string>();
  lastActionAuthor = null;
  desyncDetected = false;

  isApplyingNetworkAction = true;
  try {
    for (const action of actions) {
      processedActionIds.add(action.id);
      lastActionAuthor = action.by;
      applyLoggedAction(action);
    }
  } finally {
    isApplyingNetworkAction = false;
  }
}

/**
 * Sincronização manual, sob demanda — botão "SINCRONIZAR" da UI
 * (`ConnectionSyncBanner`), para o lado que está PRESO ESPERANDO, não o que
 * está falhando ao enviar (esse é o `retryOutboxNow` acima).
 *
 * Busca o log mais recente direto do servidor via `fetchRoom` — contorna um
 * listener do RTDB que porventura tenha parado de entregar atualizações (o
 * `onValue` de `listenToRoom` deveria reagir sozinho a qualquer mudança, mas
 * não há garantia absoluta contra uma falha silenciosa do socket) — e
 * reconstrói o estado local a partir dele com `resyncFromActionLog`, o mesmo
 * caminho que já roda automaticamente ao entrar/reentrar numa sala. Nenhum
 * mecanismo novo: só um gatilho manual para infraestrutura que já existia.
 *
 * Devolve `false` (sem lançar) se não houver sala ativa ou a busca falhar —
 * a UI decide a mensagem, não precisa de um `try/catch` próprio.
 */
export async function manualResync(): Promise<boolean> {
  const { roomCode } = useMultiplayerStore.getState();
  if (roomCode === null) return false;

  try {
    const snapshot = await fetchRoom(roomCode);
    if (snapshot === null) return false;

    resyncFromActionLog(snapshot.seed, snapshot.actions);

    // `'failed'` (uma entrada do outbox foi descartada depois de esgotar as
    // tentativas, ver `drainOutbox`) é o único status que este resync
    // resolve por si só — ele busca a verdade do servidor, que é
    // exatamente o remédio pra uma ação que nunca chegou lá. Só limpa se a
    // fila já estiver vazia: se ainda sobrar algo tentando, o status
    // daquilo continua valendo.
    if (useMultiplayerStore.getState().outboxStatus === 'failed' && outbox.length === 0) {
      useMultiplayerStore.setState({ outboxStatus: 'idle' });
    }

    return true;
  } catch (error) {
    console.warn('[syncBridge] falha ao sincronizar manualmente:', error);
    return false;
  }
}
