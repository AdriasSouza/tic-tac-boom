import AsyncStorage from '@react-native-async-storage/async-storage';

import { snapshotRng, type RngSnapshot } from '@/engine/rng';
import type { GameState } from '@/engine/rules';

/**
 * Save/resume de partida LOCAL/CPU através de um remount ou fechamento real
 * do app — investigação da "rotação reinicia o jogo": `gameStore` é 100% em
 * memória (sem `zustand/persist`), e `app/game/[mode].tsx` chama `startMatch()`
 * incondicionalmente a cada montagem, então qualquer remount (rotação sem a
 * trava de orientação realmente aplicada no build instalado, recarregar a
 * página no web, etc.) apagava a partida em andamento.
 *
 * Não é `zustand/middleware persist` de propósito: aquilo rehidrata no
 * instante em que a store é criada, antes de `app/game/[mode].tsx` poder
 * decidir "retomar ou começar do zero", e a sanitização de campos efêmeros
 * (ver `resumeMatch` em `gameStore.ts`) precisa de ações privadas da store —
 * só um fluxo explícito, controlado pela tela, permite isso.
 *
 * Online fica de fora: a sala do Firebase já é a fonte de verdade de uma
 * partida online (ver `resyncFromActionLog` em `syncBridge.ts`); um snapshot
 * local paralelo só criaria uma segunda fonte pra divergir da primeira.
 */

export type PersistableMode = 'local' | 'cpu';

export interface MatchSnapshot {
  mode: PersistableMode;
  gameState: GameState;
  rng: RngSnapshot;
  savedAt: number;
}

/**
 * Sufixo de versão: um `GameState` de formato diferente (campo novo,
 * obrigatório, que um snapshot antigo não tem) deve ser abandonado com
 * segurança, não crashar tentando reidratar um formato que não existe mais.
 * Bump aqui se a forma de `GameState` mudar de um jeito incompatível.
 */
const STORAGE_KEY = '@tic-tac-boom/match-snapshot-v1';

/** Snapshot mais velho que isto é tratado como abandonado, não reoferecido. */
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** Melhor esforço: falha ao salvar não deve derrubar a partida em andamento. */
export async function saveMatchSnapshot(mode: PersistableMode, gameState: GameState): Promise<void> {
  const snapshot: MatchSnapshot = { mode, gameState, rng: snapshotRng(), savedAt: Date.now() };
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    // Silencioso de propósito — mesmo racional de `persistSession` em multiplayerStore.ts.
  }
}

/** `null` sempre que o snapshot não existir, estiver corrompido, for de um formato antigo, ou tiver expirado. */
export async function loadMatchSnapshot(): Promise<MatchSnapshot | null> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as Partial<MatchSnapshot> | null;
    if (!parsed || (parsed.mode !== 'local' && parsed.mode !== 'cpu') || !parsed.gameState || !parsed.rng) {
      return null;
    }

    if (Date.now() - (parsed.savedAt ?? 0) > MAX_AGE_MS) {
      await clearMatchSnapshot();
      return null;
    }

    return parsed as MatchSnapshot;
  } catch {
    // JSON corrompido, ou de uma versão de chave anterior — trata como "sem save".
    return null;
  }
}

export async function clearMatchSnapshot(): Promise<void> {
  try {
    await AsyncStorage.removeItem(STORAGE_KEY);
  } catch {
    // Silencioso de propósito — ver `saveMatchSnapshot`.
  }
}
