import * as Haptics from 'expo-haptics';
import { memo, useCallback } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  interpolate,
  useAnimatedStyle,
  useDerivedValue,
  withTiming,
} from 'react-native-reanimated';

import { playSound } from '@/audio/soundEngine';
import { getCard } from '@/engine/cards/registry';
import { RARITY_LABEL } from '@/engine/cards/definitions';
import { RARITY_COLOR } from '@/theme/rarity';
import { colors } from '@/theme/colors';
import type { CardId } from '@/store/gameStore';

/* -------------------------------------------------------------------------- */
/*                                  CONSTANTES                                 */
/* -------------------------------------------------------------------------- */

const FLIP_DURATION = 380;

/**
 * Distância virtual do observador. Sem perspectiva, um `rotateY` vira um
 * achatamento horizontal em vez de uma carta girando no espaço — o gesto perde
 * completamente a leitura de "virar".
 */
const PERSPECTIVE = 600;

export const FLIP_CARD_WIDTH = 76;
export const FLIP_CARD_HEIGHT = 106;

/* -------------------------------------------------------------------------- */
/*                                    PROPS                                    */
/* -------------------------------------------------------------------------- */

export interface FlipCardProps {
  cardId: CardId;
  /** `true` mostra a face; `false` mostra o verso. Controlado pelo pai. */
  revealed: boolean;
  /** `false` congela a carta virada para baixo (Espionagem, depois da escolha). */
  disabled?: boolean;
  onPress: () => void;
}

/* -------------------------------------------------------------------------- */
/*                                  COMPONENTE                                 */
/* -------------------------------------------------------------------------- */

/**
 * Carta que gira 180° em torno do eixo Y ao ser tocada.
 *
 * As duas faces existem sempre na árvore, empilhadas no mesmo ponto, e o que
 * decide qual aparece é `backfaceVisibility: 'hidden'` + 180° de defasagem
 * entre elas. Trocar o conteúdo no meio da animação (renderizar face OU verso
 * conforme o estado) mostraria a face já no primeiro frame do giro e mataria
 * o suspense — que é a única coisa que a animação existe para produzir.
 *
 * Controlado pelo pai (`revealed`) em vez de guardar o próprio estado: quem
 * usa a Espionagem precisa impor "só uma pode virar", e isso é uma decisão do
 * conjunto, não de cada carta.
 */
function FlipCardComponent({ cardId, revealed, disabled = false, onPress }: FlipCardProps) {
  const card = getCard(cardId);
  const accent = card.type === 'ACTION' ? colors.markX : colors.markO;
  const rarityColor = RARITY_COLOR[card.rarity];

  /**
   * Derivado de `revealed` em vez de um `useEffect` com `useSharedValue`:
   * elimina o frame de atraso entre o toque e o início do giro, porque o
   * valor já nasce animando na UI thread.
   */
  const progress = useDerivedValue(
    () => withTiming(revealed ? 1 : 0, { duration: FLIP_DURATION, easing: Easing.inOut(Easing.cubic) }),
    [revealed],
  );

  const backStyle = useAnimatedStyle(() => ({
    transform: [
      { perspective: PERSPECTIVE },
      { rotateY: `${interpolate(progress.value, [0, 1], [0, 180])}deg` },
    ],
  }));

  const frontStyle = useAnimatedStyle(() => ({
    transform: [
      { perspective: PERSPECTIVE },
      { rotateY: `${interpolate(progress.value, [0, 1], [-180, 0])}deg` },
    ],
  }));

  const handlePress = useCallback(() => {
    if (disabled) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Rigid);
    playSound('TAP_RIGID');
    onPress();
  }, [disabled, onPress]);

  return (
    <Pressable
      onPress={handlePress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled, expanded: revealed }}
      accessibilityLabel={
        revealed ? `${card.name}. ${card.description}` : 'Carta virada para baixo'
      }
      accessibilityHint={revealed ? undefined : 'Toque para revelar'}
      style={[styles.slot, disabled && !revealed && styles.slotDisabled]}
    >
      {/* --- Verso --- */}
      <Animated.View style={[styles.face, styles.back, backStyle]}>
        <View style={styles.backBevel} pointerEvents="none" />
        <View style={styles.backPattern} pointerEvents="none">
          {[0, 1, 2, 3].map((i) => (
            <View key={i} style={styles.backStripe} />
          ))}
        </View>
        <Text style={styles.backGlyph}>?</Text>
      </Animated.View>

      {/* --- Face --- */}
      <Animated.View style={[styles.face, styles.front, frontStyle]}>
        <View style={[styles.frontBevel, { backgroundColor: accent }]} pointerEvents="none" />
        <View style={[styles.rarityBar, { backgroundColor: rarityColor }]} pointerEvents="none" />

        <Text style={[styles.frontGlyph, { color: accent }]}>{card.name.charAt(0)}</Text>
        <Text style={styles.frontName} numberOfLines={2}>
          {card.name}
        </Text>
        <Text style={[styles.frontRarity, { color: rarityColor }]} numberOfLines={1}>
          {RARITY_LABEL[card.rarity]}
        </Text>
      </Animated.View>
    </Pressable>
  );
}

export const FlipCard = memo(FlipCardComponent);
export default FlipCard;

/* -------------------------------------------------------------------------- */
/*                                   ESTILOS                                   */
/* -------------------------------------------------------------------------- */

const styles = StyleSheet.create({
  slot: {
    width: FLIP_CARD_WIDTH,
    height: FLIP_CARD_HEIGHT,
  },
  slotDisabled: {
    opacity: 0.45,
  },
  face: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    overflow: 'hidden',
    // O que faz o truque funcionar: cada face some quando está de costas.
    backfaceVisibility: 'hidden',
  },
  back: {
    backgroundColor: colors.boardFrame,
    borderColor: colors.boardFrameLight,
  },
  backBevel: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 2,
    backgroundColor: 'rgba(255,255,255,0.16)',
  },
  backPattern: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    opacity: 0.35,
  },
  backStripe: {
    width: FLIP_CARD_WIDTH * 1.8,
    height: 5,
    backgroundColor: colors.boardFrameShadow,
    transform: [{ rotate: '-45deg' }],
  },
  backGlyph: {
    color: colors.winGlow,
    fontSize: 26,
    fontWeight: '900',
  },
  front: {
    backgroundColor: colors.bgPanel,
    borderColor: colors.boardFrameShadow,
    paddingHorizontal: 4,
    gap: 2,
  },
  frontBevel: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 3,
  },
  rarityBar: {
    position: 'absolute',
    top: 3,
    bottom: 3,
    left: 0,
    width: 3,
  },
  frontGlyph: {
    fontSize: 28,
    fontWeight: '900',
  },
  frontName: {
    color: colors.text,
    fontSize: 8,
    fontWeight: '800',
    letterSpacing: 0.5,
    textAlign: 'center',
  },
  frontRarity: {
    fontSize: 6,
    fontWeight: '700',
    letterSpacing: 1,
  },
});
