import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

/**
 * Preferências do jogador que sobrevivem a fechar o app — hoje só o som.
 * Store dedicado, não um campo a mais no `gameStore`: o `gameStore` é a
 * máquina de estado determinística da partida (seed + inputs ➜ mesmo
 * resultado sempre); "o jogador prefere jogar mudo" não é estado de partida
 * nenhuma, é preferência de cliente — mesma fronteira que já separa
 * `multiplayerStore` do `gameStore`.
 *
 * Persistência manual via `AsyncStorage`, não `zustand/middleware persist`:
 * `matchPersistence.ts` já documenta por que esse middleware foi evitado
 * neste repo (rehidrata antes da tela poder decidir o que fazer com o
 * valor). O motivo não se aplica com a mesma força aqui — não há nada para
 * a UI "decidir" sobre uma preferência simples —, mas manter o mesmo padrão
 * manual usado por `multiplayerStore.ts` evita uma segunda convenção de
 * persistência só para isto.
 */

export interface SettingsState {
  soundEnabled: boolean;
}

export interface SettingsActions {
  toggleSound: () => void;
}

export type SettingsStore = SettingsState & SettingsActions;

const STORAGE_KEY = '@tic-tac-boom/sound-enabled';

async function persistSoundEnabled(value: boolean): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, value ? '1' : '0');
  } catch {
    // Melhor esforço: sem disco (modo privado, quota cheia), só não persiste — mesmo racional de multiplayerStore.ts.
  }
}

export const useSettingsStore = create<SettingsStore>()((set, get) => ({
  soundEnabled: true,

  toggleSound: () => {
    const next = !get().soundEnabled;
    set({ soundEnabled: next });
    void persistSoundEnabled(next);
  },
}));

/** Lê a preferência salva uma vez, ao carregar o módulo — mesmo padrão de `multiplayerStore.ts`. */
void AsyncStorage.getItem(STORAGE_KEY)
  .then((raw) => {
    if (raw !== null) {
      useSettingsStore.setState({ soundEnabled: raw === '1' });
    }
  })
  .catch(() => {});
