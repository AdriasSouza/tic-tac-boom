import { pushAction } from '@/services/multiplayerService';
import { useGameStore } from '@/store/gameStore';
import { selectOpponentConnectionStatus, useMultiplayerStore } from '@/store/multiplayerStore';
import type { Combatant } from '@/engine/rules';
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
 */
export function resetSyncBridge(): void {
  processedActionIds = new Set<string>();
  isApplyingNetworkAction = false;
  lastActionAuthor = null;
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

/** Publica a ação, se estivermos online e ela não tiver vindo da rede. */
function broadcast(build: (by: PlayerSlot) => MultiplayerAction): void {
  if (isApplyingNetworkAction) return; // anti-loop, 2ª linha de defesa
  if (!isOnlineMatch()) return;

  const { roomCode, playerId } = useMultiplayerStore.getState();
  if (roomCode === null || playerId === null) return;

  lastActionAuthor = playerId;

  // Sem `await`: a jogada JÁ foi aplicada localmente e o jogo não pode
  // congelar esperando a rede. Uma falha de publicação é registrada e não
  // derruba a partida — o oponente vai perceber a dessincronia, e é melhor
  // isso do que a UI travar no meio de um turno.
  void pushAction(roomCode, build(playerId)).catch((error: unknown) => {
    console.warn('[syncBridge] falha ao publicar ação:', error);
  });
}

/**
 * Posiciona uma peça e replica.
 *
 * Aplica LOCALMENTE primeiro e publica depois. Isso é seguro **porque o jogo
 * é estritamente por turnos e a trava de turno da UI garante que só um
 * cliente pode agir legalmente por vez** — não há duas ações concorrentes
 * cuja ordem relativa pudesse divergir entre os aparelhos. Num jogo com ações
 * simultâneas, este desenho estaria errado e seria preciso aplicar só o que
 * volta ordenado do servidor, ao custo de uma ida e volta de latência por
 * jogada.
 */
export function netPlaceMark(index: number): void {
  const before = useGameStore.getState().turnCount;
  useGameStore.getState().placeMark(index);

  // `placeMark` é um no-op silencioso em jogada inválida. Comparar `turnCount`
  // é como sabemos se ela de fato aconteceu — publicar uma jogada que a
  // própria engine recusou colocaria o oponente num estado que este cliente
  // nunca teve.
  if (useGameStore.getState().turnCount === before) return;

  broadcast((by) => ({ type: 'PLACE_MARK', by, at: Date.now(), index }));
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

/**
 * Confirma o sacrifício do Altar e replica.
 *
 * Único ponto de contato do `<AltarModal />` com a rede — tudo antes disto
 * (arrastar cartas para os slots, tocar para trocar a seleção) é estado local
 * do modal, que este arquivo nunca vê. Só o clique em "Confirmar Sacrifício"
 * vira uma ação, exatamente como uma jogada de tabuleiro ou de carta.
 */
export function netSacrificeCards(uid1: string, uid2: string): void {
  const caster = getLocalCombatant();
  useGameStore.getState().sacrificeCards(caster, [uid1, uid2]);
  broadcast((by) => ({ type: 'SACRIFICE_CARDS', by, at: Date.now(), uids: [uid1, uid2] }));
}

/* -------------------------------------------------------------------------- */
/*                      ENTRADA: REDE ➜ LOCAL                                  */
/* -------------------------------------------------------------------------- */

/** Traduz uma ação da rede numa chamada do `gameStore`. */
function applyRemoteAction(action: StoredAction): void {
  const game = useGameStore.getState();
  const combatant = COMBATANT_BY_SLOT[action.by];

  switch (action.type) {
    case 'PLACE_MARK': {
      const before = game.turnCount;
      game.placeMark(action.index);

      // A engine recusou uma jogada que o outro cliente aceitou ⇒ os dois
      // estados divergiram. Não há recuperação automática possível aqui (o
      // histórico local já é outro), então o que resta é gritar alto: um
      // desync silencioso é o bug mais caro de diagnosticar depois.
      if (useGameStore.getState().turnCount === before) {
        console.error(
          '[syncBridge] DESSINCRONIA: a jogada remota em',
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
        console.error(
          '[syncBridge] DESSINCRONIA: a carta remota',
          action.uid,
          'foi recusada localmente.',
        );
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

    case 'SACRIFICE_CARDS': {
      const removed = game.sacrificeCards(combatant, action.uids);
      if (removed !== action.uids.length) {
        console.error(
          '[syncBridge] DESSINCRONIA: o sacrifício remoto removeu',
          removed,
          'de',
          action.uids.length,
          'cartas esperadas.',
        );
      }
      break;
    }
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
 */
export function consumeRemoteActions(actions: StoredAction[]): void {
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
      applyRemoteAction(action);
    } finally {
      // `finally` e não uma atribuição no fim: se `applyRemoteAction` lançar,
      // a trava ficaria presa em `true` e o cliente pararia de publicar
      // qualquer jogada pelo resto da partida, sem nenhum sintoma óbvio.
      isApplyingNetworkAction = false;
    }
  }
}
