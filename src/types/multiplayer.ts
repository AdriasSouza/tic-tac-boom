import type { InteractionSelection } from '@/engine/rules';

/**
 * Contrato de dados trocado com o Realtime Database.
 *
 * Vive num módulo próprio (e não dentro do serviço) porque tanto o
 * `multiplayerService` quanto o `multiplayerStore` e a UI do lobby precisam
 * destes tipos — importá-los do serviço obrigaria a UI a depender da camada
 * de rede só para tipar uma prop.
 *
 * ⚠️ **Regra do RTDB:** `undefined` é inválido em qualquer valor gravado — o
 * SDK lança `set() called with undefined`. Por isso todo campo opcional aqui é
 * declarado como `T | null`, nunca `T?`. O que "não existe" vira `null`
 * explícito na escrita, e o que o RTDB devolve ausente é normalizado na
 * leitura (ver `toRoomSnapshot` no serviço).
 */

/* -------------------------------------------------------------------------- */
/*                                  JOGADORES                                  */
/* -------------------------------------------------------------------------- */

/**
 * Assento na sala. `player1` é sempre quem criou.
 *
 * Deliberadamente NÃO é o `Combatant` da engine (`'PLAYER' | 'MACHINE'`): são
 * eixos diferentes. `Combatant` diz de quem é a peça *na perspectiva local*
 * — para os dois clientes o humano local é sempre `'PLAYER'`. `PlayerSlot`
 * diz quem é quem *na sala*. Misturar os dois faria cada cliente achar que é
 * o mesmo lado do outro.
 */
export type PlayerSlot = 'player1' | 'player2';

/**
 * Presença de rede, distinta de OCUPAR o assento.
 *
 * `PlayerPresence` existir (não ser `null`) já significa "alguém está sentado
 * aqui". Este campo responde a uma pergunta diferente: "o socket dele está
 * vivo AGORA?" — a resposta muda sozinha, escrita pelo PRÓPRIO servidor via
 * `onDisconnect` (ver `attachPresence` no serviço), nunca pelo cliente que caiu
 * (por definição, ele não está em condições de avisar ninguém).
 */
export type PlayerConnectionStatus = 'CONNECTED' | 'DISCONNECTED';

/** Presença de um jogador no assento. `null` = assento vago. */
export interface PlayerPresence {
  /** Id anônimo gerado no cliente. Persistido localmente — sobrevive a um F5. */
  clientId: string;
  /** `Date.now()` do cliente no momento em que entrou. Só informativo. */
  joinedAt: number;
  status: PlayerConnectionStatus;
}

/* -------------------------------------------------------------------------- */
/*                                    SALA                                     */
/* -------------------------------------------------------------------------- */

/**
 * - `LOBBY`   — criada, esperando o segundo jogador.
 * - `PLAYING` — os dois assentos ocupados; a partida começou.
 * - `FINISHED`— encerrada (abandono ou fim de partida).
 */
export type RoomStatus = 'LOBBY' | 'PLAYING' | 'FINISHED';

/**
 * Formato **exato** do nó `/rooms/[code]` no RTDB.
 *
 * `actions` é um `Record` (e não array) porque é isso que `push()` produz: o
 * RTDB não tem arrays de verdade, e usar índices numéricos criaria condição
 * de corrida entre os dois clientes escrevendo no mesmo índice. As chaves de
 * `push()` são ordenáveis cronologicamente, que é exatamente o que o event
 * sourcing precisa.
 */
export interface RoomRecord {
  code: string;
  status: RoomStatus;
  /**
   * Seed do RNG da partida, sorteada por quem criou a sala.
   *
   * É a peça central do plano de sincronização: como a engine é
   * determinística dada a seed (ver `src/engine/rng.ts`), os dois clientes
   * partem de mãos iniciais e sorteios idênticos. Sem isso seria preciso
   * sincronizar o estado inteiro a cada jogada em vez de só os inputs.
   */
  seed: number;
  createdAt: number;
  players: {
    player1: PlayerPresence | null;
    player2: PlayerPresence | null;
  };
  /** Ausente no RTDB até a primeira ação ser publicada. */
  actions?: Record<string, MultiplayerAction>;
}

/* -------------------------------------------------------------------------- */
/*                             AÇÕES (event sourcing)                          */
/* -------------------------------------------------------------------------- */

/**
 * Um input de jogador, replicado para o outro cliente.
 *
 * Sincronizamos AÇÕES, não estado: cada cliente roda a mesma engine sobre a
 * mesma seed e aplica a mesma sequência de inputs, chegando ao mesmo estado.
 * Isso mantém o tráfego mínimo (um índice por jogada, em vez do tabuleiro,
 * mãos e armadilhas inteiros) e — mais importante — mantém `gameStore.ts`
 * como fonte única da verdade das regras, sem um segundo caminho de escrita
 * vindo da rede.
 *
 * Os campos espelham as assinaturas que já existem no store:
 * - `PLACE_MARK`  ➜ `placeMark(index)`
 * - `PLAY_CARD`   ➜ `playCard(uid, targetIndex)`
 * - `END_TURN`     ➜ `endTurn(combatant)` — `by` é quem passou a vez (REBOBINAR ou o
 *                    botão "passar a vez"), sem payload extra.
 * - `RESOLVE_INTERACTION` ➜ `resolveInteraction(combatant, selection)` — cobre os 5
 *                    `kind`s de `PendingInteraction` com uma ação só; `selection`
 *                    já carrega o próprio `kind` (ver `InteractionSelection`,
 *                    `src/engine/rules.ts`).
 * - `CANCEL_INTERACTION` ➜ `cancelInteraction(combatant)` — sem payload; o
 *                    reembolso (carta + energia) é recalculado em CADA
 *                    aparelho a partir do `pendingInteraction` local, nunca
 *                    transmitido.
 * - `ACKNOWLEDGE` ➜ `acknowledgePending()`
 * - `FORFEIT`     ➜ `forfeitMatch(winner)` — `by` é quem DECLAROU (o vencedor
 *                    conectado), não quem desistiu. Um input como qualquer
 *                    outro: se `by` estiver offline no momento da declaração,
 *                    a ação fica no log e é entregue normalmente quando ele
 *                    reconectar — nenhum mecanismo novo de entrega, o mesmo
 *                    que já resolve `PLACE_MARK`/`PLAY_CARD` atrasados.
 * - `SACRIFICE_CARDS` ➜ `sacrificeCards(caster, uids)` — a escolha de QUAIS
 *                    duas cartas sacrificar acontece inteiramente em estado
 *                    local do `AltarModal` (nunca publicada card a card); só
 *                    a decisão FINAL, no clique de "Confirmar Sacrifício",
 *                    vira uma ação — pelo mesmo motivo de `PLACE_MARK`/
 *                    `PLAY_CARD`: só os inputs trafegam, nunca o estado.
 */
export type MultiplayerAction =
  | MultiplayerActionBase & { type: 'PLACE_MARK'; index: number }
  | MultiplayerActionBase & {
      type: 'PLAY_CARD';
      uid: string;
      /**
       * `null` (nunca `undefined`) quando a carta não exige alvo — ver a nota
       * sobre `undefined` no topo do arquivo. Quem aplica converte de volta
       * para `undefined` antes de chamar `playCard`.
       */
      targetIndex: number | null;
    }
  | MultiplayerActionBase & { type: 'END_TURN' }
  | MultiplayerActionBase & { type: 'RESOLVE_INTERACTION'; selection: InteractionSelection }
  | MultiplayerActionBase & { type: 'CANCEL_INTERACTION' }
  | MultiplayerActionBase & { type: 'ACKNOWLEDGE' }
  | MultiplayerActionBase & { type: 'FORFEIT' }
  | MultiplayerActionBase & { type: 'SACRIFICE_CARDS'; uids: [string, string] };

interface MultiplayerActionBase {
  /** Quem produziu o input. O outro cliente usa isto para ignorar o eco do próprio envio. */
  by: PlayerSlot;
  /** `Date.now()` do cliente. Diagnóstico apenas — a ORDEM vem da chave do `push()`. */
  at: number;
}

/**
 * Ação como o app a enxerga: o payload gravado + a chave que o `push()`
 * gerou.
 *
 * O `id` é o que torna a proteção anti-loop possível — sem uma identidade
 * estável por ação, "já apliquei esta?" viraria comparação de conteúdo, e
 * duas jogadas legítimas idênticas (o mesmo jogador jogando na mesma casa em
 * rodadas diferentes) seriam confundidas uma com a outra. A chave do `push()`
 * é única por definição e a mesma nos dois clientes.
 */
export type StoredAction = MultiplayerAction & { id: string };

/* -------------------------------------------------------------------------- */
/*                            SNAPSHOT NORMALIZADO                             */
/* -------------------------------------------------------------------------- */

/**
 * O que o app consome, já normalizado a partir do `RoomRecord` cru.
 *
 * A diferença que importa: `actions` vira um **array ordenado**. O RTDB
 * devolve o nó ausente quando não há nenhuma ação (não devolve `{}`), e
 * devolve um objeto quando há — obrigar cada consumidor a lidar com os dois
 * casos espalharia a mesma checagem por toda a UI.
 */
export interface RoomSnapshot {
  code: string;
  status: RoomStatus;
  seed: number;
  createdAt: number;
  players: {
    player1: PlayerPresence | null;
    player2: PlayerPresence | null;
  };
  /** Em ordem cronológica de publicação. Vazio quando ninguém agiu ainda. */
  actions: StoredAction[];
}
