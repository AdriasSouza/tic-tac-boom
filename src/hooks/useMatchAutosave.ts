import { useEffect } from 'react';

import { useGameStore } from '@/store/gameStore';
import { clearMatchSnapshot, saveMatchSnapshot, type PersistableMode } from '@/store/matchPersistence';

/** Junta rajadas de `set()` de uma única jogada (débito de energia, patch do efeito, dano, log...) num só write. */
const AUTOSAVE_DEBOUNCE_MS = 400;

/**
 * Salva a partida local/CPU automaticamente enquanto ela está em andamento —
 * a metade "escrita" da persistência que sobrevive a um remount/relançamento
 * (ver `src/store/matchPersistence.ts` para o porquê e `resumeMatch` em
 * `gameStore.ts` para a leitura). Inerte em qualquer outro `mode` (online
 * nunca persiste por aqui — a sala do Firebase já é a fonte de verdade).
 */
export function useMatchAutosave(mode: string): void {
  useEffect(() => {
    if (mode !== 'local' && mode !== 'cpu' && mode !== 'classic') return;
    const persistableMode: PersistableMode = mode;

    let timer: ReturnType<typeof setTimeout> | null = null;

    const unsubscribe = useGameStore.subscribe((state) => {
      if (state.status === 'PLAYING' || state.status === 'ROUND_OVER') {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          timer = null;
          void saveMatchSnapshot(persistableMode, useGameStore.getState());
        }, AUTOSAVE_DEBOUNCE_MS);
      } else if (state.status === 'MATCH_OVER') {
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
        void clearMatchSnapshot();
      }
      // status === 'IDLE': no-op — não deveria ocorrer com a tela já montada,
      // e não há nada útil para salvar antes da primeira mão ser distribuída.
    });

    return () => {
      if (timer) clearTimeout(timer);
      unsubscribe();
    };
  }, [mode]);
}

export default useMatchAutosave;
