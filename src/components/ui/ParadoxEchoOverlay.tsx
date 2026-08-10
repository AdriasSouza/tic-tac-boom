import { useEffect } from 'react';
import { StyleSheet } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { selectLastParadoxMirror, useGameStore } from '@/store/gameStore';
import { colors } from '@/theme/colors';

/** Duração total do flash — mesma receita de `<DamageFlashOverlay />`, cor diferente. */
const FLASH_DURATION_MS = 420;

/**
 * Roxo de tela cheia que pisca toda vez que PARADOXO copia uma carta —
 * sem isto, a mão do dono simplesmente muda (curou, comprou, etc.) no meio
 * do turno do ADVERSÁRIO, sem nenhum sinal do porquê. Mesma receita de
 * `<DamageFlashOverlay />` (`useSharedValue`/`withSequence`), cor roxa em vez
 * de vermelha pra não ser confundido com dano de verdade.
 *
 * Assina só `lastParadoxMirror`, `id` monotônico — mesmo racional de todo o
 * resto da família `last*`.
 */
export function ParadoxEchoOverlay() {
  const lastMirror = useGameStore(selectLastParadoxMirror);
  const opacity = useSharedValue(0);

  useEffect(() => {
    if (!lastMirror) return;

    cancelAnimation(opacity);
    opacity.value = withSequence(
      withTiming(0.45, { duration: 60, easing: Easing.out(Easing.quad) }),
      withTiming(0, { duration: FLASH_DURATION_MS - 60, easing: Easing.in(Easing.quad) }),
    );
  }, [lastMirror, opacity]);

  useEffect(() => () => cancelAnimation(opacity), [opacity]);

  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return <Animated.View style={[styles.root, style]} pointerEvents="none" />;
}

export default ParadoxEchoOverlay;

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFill,
    backgroundColor: colors.paradoxEcho,
    zIndex: 998, // mesma camada de `<DamageFlashOverlay />` — os dois nunca disputam o mesmo instante
  },
});
