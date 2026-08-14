import { useEffect, useRef } from 'react';
import { StyleSheet } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { selectIsChaosRouletteSpinning, selectLastDamageEvent, useGameStore } from '@/store/gameStore';

/** Duração total do flash — sobe rápido, some devagar. */
const FLASH_DURATION_MS = 420;

/**
 * Vermelho de tela cheia que pisca rápido toda vez que `takeDamage` acerta
 * (Player ou Máquina — o impacto é o mesmo para os dois, sem distinção de
 * lado). `pointerEvents="none"`: é puro impacto visual, nunca pode roubar um
 * toque do tabuleiro ou da mão.
 *
 * Assina só `lastDamageEvent`, um objeto efêmero com `id` monotônico — é o
 * `id` (não `target`/`amount`) que garante o flash disparar de novo mesmo
 * quando dois hits seguidos têm exatamente o mesmo alvo e valor.
 */
export function DamageFlashOverlay() {
  const lastDamageEvent = useGameStore(selectLastDamageEvent);
  // O reembaralhar do giro de TIC TAC BOOM! pode fechar uma linha e causar
  // dano no mesmo instante síncrono em que começa (`applyCardEffectResult`,
  // `gameStore.ts`) — sem esperar por `chaosRouletteSpinning`, o flash
  // piscava ANTES do jogador ver qual coluna fechou. O estado (`hp`/
  // `lastDamageEvent`) continua mudando na hora, só a REAÇÃO visual atrasa.
  const chaosRouletteSpinning = useGameStore(selectIsChaosRouletteSpinning);
  const opacity = useSharedValue(0);
  /** Id do último evento já animado — sem isto, um giro SEM dano novo (spin
   * que não fecha linha) re-disparava o flash de um dano antigo só porque
   * `chaosRouletteSpinning` mudou de novo e o efeito rodou de novo. */
  const animatedIdRef = useRef<number | null>(null);

  useEffect(() => {
    if (!lastDamageEvent) return;
    if (lastDamageEvent.id === animatedIdRef.current) return; // já animado
    if (chaosRouletteSpinning) return; // segura até o giro acabar de revelar

    animatedIdRef.current = lastDamageEvent.id;
    cancelAnimation(opacity);
    opacity.value = withSequence(
      withTiming(0.55, { duration: 50, easing: Easing.out(Easing.quad) }),
      withTiming(0, { duration: FLASH_DURATION_MS - 50, easing: Easing.in(Easing.quad) }),
    );
  }, [lastDamageEvent, chaosRouletteSpinning, opacity]);

  useEffect(() => () => cancelAnimation(opacity), [opacity]);

  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return <Animated.View style={[styles.root, style]} pointerEvents="none" />;
}

export default DamageFlashOverlay;

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFill,
    backgroundColor: '#ff0033',
    zIndex: 998, // abaixo do GameOverOverlay (999), acima do resto do jogo
  },
});
