import AsyncStorage from '@react-native-async-storage/async-storage';

import type { MultiplayerAction } from '@/types/multiplayer';

/**
 * Durabilidade do outbox de `syncBridge.ts` — separado num arquivo próprio
 * (não misturado com o resto da ponte) pra ficar testável sem arrastar
 * `gameStore`/`multiplayerStore`.
 *
 * **O problema que isto resolve:** o outbox de `syncBridge.ts` (ações
 * aplicadas localmente, ainda não confirmadas pelo servidor) hoje vive só em
 * memória. Se o processo morrer entre "aplicado local" e "escrito no
 * Firebase" (app fechado à força, morto pelo SO em segundo plano, reload no
 * web), a ação é perdida pra sempre — o jogador local viu acontecer, o
 * oponente nunca recebe, e `resyncFromActionLog` converge os dois clientes
 * pra um log que já nasceu incompleto, sem `reportDesync` nunca detectar
 * (nada discorda de um log consistente, só incompleto).
 *
 * **O que isto NÃO faz:** nunca toca `useGameStore`. A ação já foi aplicada
 * ao estado local no instante em que entrou no outbox — restaurar daqui só
 * termina de ENVIAR ao Firebase o que ainda faltava, nunca reaplica nada ao
 * jogo.
 */

/** Uma ação aplicada localmente, ainda não confirmada pelo servidor. */
export interface OutboxEntry {
  roomCode: string;
  action: MultiplayerAction;
  attempts: number;
  /** `Date.now()` no instante em que a ação entrou no outbox — base do teto de idade. */
  createdAt: number;
}

/** Sufixo de versão — mesmo racional de `matchPersistence.ts`: um formato incompatível deve ser abandonado com segurança, não travar a leitura. */
const STORAGE_KEY = '@tic-tac-boom/outbox-v1';

/**
 * Teto de IDADE — cobre "o app ficou fechado o tempo todo". Enquanto o
 * processo não roda, `drainOutbox` não tenta nada, então `attempts` não sobe
 * nesse período — só a idade capta quanto tempo uma ação ficou parada. 24h é
 * generoso o bastante pra cobrir "fechei à noite, reabri de manhã", sem
 * guardar pra sempre uma ação de uma partida quase certamente abandonada.
 */
export const MAX_OUTBOX_ENTRY_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * Teto de TENTATIVAS — cobre "o app está aberto e tentando de verdade, mas é
 * inútil" (permissão negada, sala apagada). Bem maior que
 * `STALLED_AFTER_ATTEMPTS` (5, só troca o RÓTULO da UI em `syncBridge.ts`):
 * com o backoff atual (teto 8s entre tentativas), 20 tentativas são vários
 * minutos de retry contínuo antes de desistir — tempo de sobra pra uma falha
 * de rede passageira se resolver sozinha. Depois disso, `syncBridge.ts`
 * descarta a entrada em vez de tentar para sempre (exceção deliberada ao
 * "nunca desiste" do resto do outbox — ver o comentário lá).
 */
export const MAX_OUTBOX_ENTRY_ATTEMPTS = 20;

/** A entrada passou do teto de idade? */
export function isEntryExpired(entry: Pick<OutboxEntry, 'createdAt'>, now: number): boolean {
  return now - entry.createdAt > MAX_OUTBOX_ENTRY_AGE_MS;
}

/**
 * Melhor esforço: falha ao salvar não pode derrubar a partida em andamento
 * (mesmo racional de `persistSession`/`saveMatchSnapshot`).
 */
export async function savePersistedOutbox(entries: readonly OutboxEntry[]): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Silencioso de propósito — ver o comentário acima.
  }
}

/**
 * Lê o outbox persistido e descarta o que já expirou por idade.
 *
 * `null`/JSON corrompido/formato antigo viram lista vazia, nunca lançam
 * (mesmo padrão de `loadMatchSnapshot`). Uma entrada expirada é DESCARTADA,
 * não silenciosamente — `console.error` nomeando sala e tipo de ação, porque
 * uma ação que o jogador viu acontecer sumindo sem rastro nenhum é
 * exatamente o tipo de bug caro de diagnosticar depois.
 */
export async function loadPersistedOutbox(): Promise<OutboxEntry[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return [];

    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];

    const now = Date.now();
    const survivors: OutboxEntry[] = [];

    for (const item of parsed as OutboxEntry[]) {
      if (
        !item ||
        typeof item.roomCode !== 'string' ||
        typeof item.attempts !== 'number' ||
        typeof item.createdAt !== 'number' ||
        !item.action
      ) {
        continue; // entrada malformada — mesmo tratamento de "sem save"
      }

      if (isEntryExpired(item, now)) {
        console.error(
          '[outboxPersistence] ação expirada descartada ao restaurar (sala',
          item.roomCode,
          ', tipo',
          item.action.type,
          ', idade em ms:',
          now - item.createdAt,
          ')',
        );
        continue;
      }

      survivors.push(item);
    }

    return survivors;
  } catch {
    // JSON corrompido, ou de uma versão de chave anterior — trata como "sem save".
    return [];
  }
}
