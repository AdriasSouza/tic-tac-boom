import * as Haptics from 'expo-haptics';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { FadeOut, ZoomIn } from 'react-native-reanimated';

import { useResponsiveLayout } from '@/hooks/useResponsiveLayout';
import {
  CHAOS_ROULETTE_BANNER_HOLD_MS,
  CHAOS_ROULETTE_COLUMN_STOP_MS,
  selectLastChaosRoulette,
  useGameStore,
} from '@/store/gameStore';
import { RARITY_COLOR } from '@/theme/rarity';

const STOPS = [
  { atMs: CHAOS_ROULETTE_COLUMN_STOP_MS[0], text: 'TIC' },
  { atMs: CHAOS_ROULETTE_COLUMN_STOP_MS[1], text: 'TAC' },
  { atMs: CHAOS_ROULETTE_COLUMN_STOP_MS[2], text: 'BOOM!' },
] as const;

/**
 * Letreiro do giro de TIC TAC BOOM! (CHAOS_ROULETTE).
 *
 * Reage ao `id` monotônico de `lastChaosRoulette` (mesmo padrão de
 * `<ExtraTurnBanner />`), não ao valor de controle `chaosRouletteSpinning`
 * diretamente — sobrevive ao double-invoke de efeito do React em dev pela
 * mesma razão documentada lá: um `id` que só avança quando o STORE detecta
 * uma jogada nova não depende de comparar com nada guardado localmente.
 */
export function ChaosRouletteBanner() {
  const lastChaosRoulette = useGameStore(selectLastChaosRoulette);
  const [text, setText] = useState<string | null>(null);
  const { handAreaHeight } = useResponsiveLayout();

  const id = lastChaosRoulette?.id ?? null;
  useEffect(() => {
    // Sem este `else`, um `startMatch` no meio da contagem (zera
    // `lastChaosRoulette` de volta a `null`) deixaria "TAC"/"BOOM!" preso na
    // tela da partida ANTERIOR — mesmo bug já corrigido em <ExtraTurnBanner />.
    if (!lastChaosRoulette) {
      setText(null);
      return;
    }

    const beats = STOPS.map(({ atMs, text: stopText }) => setTimeout(() => setText(stopText), atMs));
    const boom = setTimeout(() => {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    }, CHAOS_ROULETTE_COLUMN_STOP_MS[2]);
    const hide = setTimeout(
      () => setText(null),
      CHAOS_ROULETTE_COLUMN_STOP_MS[2] + CHAOS_ROULETTE_BANNER_HOLD_MS,
    );

    return () => {
      beats.forEach(clearTimeout);
      clearTimeout(boom);
      clearTimeout(hide);
    };
  }, [id, lastChaosRoulette]);

  if (!text) return null;

  return (
    <View style={[styles.layer, { paddingBottom: handAreaHeight + 12 }]} pointerEvents="none">
      <Animated.View
        // Remonta a cada giro novo: garante a entrada animada mesmo quando um
        // segundo TIC TAC BOOM! substitui o banner do primeiro sem passar por
        // "nenhum" texto no meio.
        key={id}
        entering={ZoomIn.springify().damping(12).mass(0.6)}
        exiting={FadeOut.duration(150)}
        style={[styles.banner, { borderColor: RARITY_COLOR.BOOM }]}
      >
        <Text style={[styles.title, { color: RARITY_COLOR.BOOM }]}>{text}</Text>
      </Animated.View>
    </View>
  );
}

export default ChaosRouletteBanner;

const styles = StyleSheet.create({
  layer: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  banner: {
    backgroundColor: 'rgba(2,4,7,0.92)',
    borderWidth: 3,
    paddingHorizontal: 24,
    paddingVertical: 10,
  },
  title: {
    fontSize: 22,
    fontWeight: '900',
    letterSpacing: 4,
  },
});
