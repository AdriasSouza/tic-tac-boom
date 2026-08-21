import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { memo, useCallback, useMemo } from 'react';
import { Pressable, StyleSheet } from 'react-native';

import { playSound } from '@/audio/soundEngine';
import { useCanPlayCardsNow } from '@/hooks/useLocalTurn';
import { useMatchPerspective } from '@/hooks/useMatchPerspective';
import { netDrawCardNatively } from '@/services/syncBridge';
import {
  HAND_LIMIT,
  nativeDrawsThisTurnKeyFor,
  selectEnergy,
  selectHandOf,
  selectPendingAcknowledgement,
  selectPendingInteraction,
  selectIsPaused,
  useGameStore,
} from '@/store/gameStore';
import { colors } from '@/theme/colors';

/**
 * Botão "comprar carta" — consumidor humano de `drawCardNatively` (`gameStore.ts`,
 * Fase 8c), mesmo molde visual de `EndTurnButton.tsx` (caixa `22×20`, opacidade
 * habilitado/desabilitado/pressionado, sempre montado — nunca desmontado).
 *
 * Diferença deliberada: SEM modal de confirmação. Passar a vez é irreversível
 * (entrega a vez inteira); comprar carta não é — custa energia e pode encher a
 * mão, mas não decide o turno (`drawCardNatively` nem mexe em `turn`/
 * `turnCount`). Um toque acidental aqui é reversível pelo próprio jogo (a
 * carta comprada senta na mão, sem efeito), então o toque chama
 * `netDrawCardNatively()` direto.
 */
function DrawCardButtonComponent() {
  const { localCombatant } = useMatchPerspective();

  const canPlayCardsNow = useCanPlayCardsNow();
  const isPaused = useGameStore(selectIsPaused);
  const pendingAcknowledgement = useGameStore(selectPendingAcknowledgement);
  const pendingInteraction = useGameStore(selectPendingInteraction);
  const hand = useGameStore(useMemo(() => selectHandOf(localCombatant), [localCombatant]));
  const energy = useGameStore(useMemo(() => selectEnergy(localCombatant), [localCombatant]));
  const nativeDrawsThisTurn = useGameStore((s) => s[nativeDrawsThisTurnKeyFor(localCombatant)]);

  // Mesmas condições de `drawCardNatively` — nunca dispara um toque morto
  // contra a store: status/turno/pausa/confirmação/interação pendentes (via
  // `canPlayCardsNow`, mesmo sinal que `EndTurnButton` usa), mais o custo
  // escalonado da PRÓXIMA compra e `HAND_LIMIT`.
  const nextCost = nativeDrawsThisTurn + 1;
  const canDraw =
    canPlayCardsNow &&
    !isPaused &&
    pendingAcknowledgement === null &&
    pendingInteraction === null &&
    hand.length < HAND_LIMIT &&
    energy >= nextCost;

  const handlePress = useCallback(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    playSound('TAP_LIGHT');
    netDrawCardNatively();
  }, []);

  return (
    <Pressable
      onPress={handlePress}
      disabled={!canDraw}
      style={({ pressed }) => [
        styles.button,
        pressed && canDraw && styles.buttonPressed,
        !canDraw && styles.buttonDisabled,
      ]}
      accessibilityRole="button"
      accessibilityLabel="Comprar carta"
      accessibilityState={{ disabled: !canDraw }}
      hitSlop={10}
    >
      <Ionicons name="download-outline" size={12} color={colors.text} />
    </Pressable>
  );
}

export const DrawCardButton = memo(DrawCardButtonComponent);
export default DrawCardButton;

const styles = StyleSheet.create({
  // Mesmo tamanho de `EndTurnButton`/`pauseButton` (`GameHeader.tsx`) de
  // propósito: um terceiro filho do MESMO tamanho na mesma fileira não muda a
  // altura dela — o máximo entre os filhos não sobe (AGENTS.md).
  button: {
    width: 22,
    height: 20,
    borderWidth: 2,
    borderColor: colors.textDim,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonPressed: {
    opacity: 0.6,
  },
  buttonDisabled: {
    opacity: 0.3,
  },
});
