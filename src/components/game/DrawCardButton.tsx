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
import { ACTION_BUTTON_SIZE } from '@/theme/layout';

/**
 * Botão "comprar carta" — consumidor humano de `drawCardNatively` (`gameStore.ts`,
 * Fase 8c), mesmo molde de `EndTurnButton.tsx` (opacidade habilitado/pressionado,
 * sempre montado — nunca desmontado). Montado por `[mode].tsx` (Fase 8g), não
 * mais pelo header.
 *
 * Diferença deliberada: SEM modal de confirmação. Passar a vez é irreversível
 * (entrega a vez inteira); comprar carta não é — custa energia e pode encher a
 * mão, mas não decide o turno (`drawCardNatively` nem mexe em `turn`/
 * `turnCount`). Um toque acidental aqui é reversível pelo próprio jogo (a
 * carta comprada senta na mão, sem efeito), então o toque chama
 * `netDrawCardNatively()` direto.
 *
 * Três estados visuais (Fase 8g, achado C.6/direção B da investigação): antes
 * "sem energia" e "genuinamente indisponível" (fora da vez, mão cheia,
 * interação pendente) caíam na MESMA opacidade reduzida — o jogador não tinha
 * como distinguir "espera 1 turno" de "não vai rolar agora". `blockedByEnergy`
 * reaproveita o padrão que `CardItem` já usa pra `canAfford` (borda/selo
 * vermelho `colors.danger`) em vez de inventar um idioma novo.
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
  const otherGuardsOk =
    canPlayCardsNow &&
    !isPaused &&
    pendingAcknowledgement === null &&
    pendingInteraction === null &&
    hand.length < HAND_LIMIT;
  const canDraw = otherGuardsOk && energy >= nextCost;
  // "Vai ficar disponível sozinho" — os outros guards já passam, só falta
  // energia (que regenera a cada turno). Distinto de "genuinamente
  // indisponível agora" (fora da vez, pausado, pendência aberta, mão cheia),
  // que não se resolve esperando.
  const blockedByEnergy = otherGuardsOk && energy < nextCost;

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
        !canDraw && !blockedByEnergy && styles.buttonDisabled,
        blockedByEnergy && styles.buttonEnergyBlocked,
      ]}
      accessibilityRole="button"
      accessibilityLabel="Comprar carta"
      accessibilityState={{ disabled: !canDraw }}
      hitSlop={10}
    >
      <Ionicons name="download-outline" size={18} color={colors.text} />
    </Pressable>
  );
}

export const DrawCardButton = memo(DrawCardButtonComponent);
export default DrawCardButton;

const styles = StyleSheet.create({
  // `ACTION_BUTTON_SIZE` (Fase 8g) — decidido junto de `EndTurnButton` e do
  // slot que os hospeda em `[mode].tsx` (`theme/layout.ts`).
  button: {
    width: ACTION_BUTTON_SIZE,
    height: ACTION_BUTTON_SIZE,
    borderWidth: 2,
    borderColor: colors.textDim,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonPressed: {
    opacity: 0.6,
  },
  // Genuinamente indisponível agora (fora da vez, pausado, pendência aberta,
  // mão cheia) — mesma opacidade reduzida de sempre.
  buttonDisabled: {
    opacity: 0.3,
  },
  // Só falta energia — borda vermelha (mesma cor de `canAfford` em
  // `CardItem`), opacidade mais alta que `buttonDisabled`: comunica "quase
  // dá", não "esqueça".
  buttonEnergyBlocked: {
    borderColor: colors.danger,
    opacity: 0.55,
  },
});
