import { memo, useCallback } from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';

import { colors } from '@/theme/colors';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/** Deslocamento do bloco de sombra. Também é o quanto a face afunda ao pressionar. */
const DEPTH = 4;

export type PixelButtonVariant = 'primary' | 'secondary' | 'ghost';

export interface PixelButtonProps {
  label: string;
  onPress: () => void;
  variant?: PixelButtonVariant;
  /** Sobrescreve a cor de destaque da variante. */
  accent?: string;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  /** Linha menor abaixo do rótulo. */
  caption?: string;
}

const VARIANT_ACCENT: Record<PixelButtonVariant, string> = {
  primary: colors.markX,
  secondary: colors.markO,
  ghost: colors.textDim,
};

/**
 * Botão retrô com profundidade chapada.
 *
 * O visual "pixel" vem de um bloco sólido deslocado atrás da face — nada de
 * `shadowRadius`/`elevation`, que borram a aresta. Ao pressionar, a face
 * afunda exatamente `DEPTH` px nos dois eixos e ocupa o lugar da sombra,
 * reproduzindo o clique de botão de fliperama.
 */
function PixelButtonComponent({
  label,
  onPress,
  variant = 'primary',
  accent,
  disabled = false,
  style,
  caption,
}: PixelButtonProps) {
  const press = useSharedValue(0);
  const tone = accent ?? VARIANT_ACCENT[variant];

  const faceStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: interpolate(press.value, [0, 1], [0, DEPTH]) },
      { translateY: interpolate(press.value, [0, 1], [0, DEPTH]) },
    ],
  }));

  const handlePressIn = useCallback(() => {
    press.value = withTiming(1, { duration: 60 });
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [press]);

  const handlePressOut = useCallback(() => {
    press.value = withSpring(0, { damping: 18, stiffness: 400 });
  }, [press]);

  const handlePress = useCallback(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onPress();
  }, [onPress]);

  return (
    <View style={[styles.wrapper, disabled && styles.disabled, style]}>
      {/* Bloco de sombra: fica parado enquanto a face afunda sobre ele. */}
      <View style={[styles.shadowBlock, { backgroundColor: tone }]} pointerEvents="none" />

      <AnimatedPressable
        onPress={handlePress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityState={{ disabled }}
        accessibilityLabel={caption ? `${label}. ${caption}` : label}
        style={[styles.face, { borderColor: tone }, faceStyle]}
      >
        {/* Bisel superior chapado. */}
        <View style={[styles.bevel, { backgroundColor: tone }]} pointerEvents="none" />

        <Text style={[styles.label, { color: tone }]} numberOfLines={1}>
          {label}
        </Text>

        {caption && (
          <Text style={styles.caption} numberOfLines={1}>
            {caption}
          </Text>
        )}
      </AnimatedPressable>
    </View>
  );
}

export const PixelButton = memo(PixelButtonComponent);
export default PixelButton;

const styles = StyleSheet.create({
  wrapper: {
    // Reserva o espaço da sombra para o botão não "crescer" ao pressionar.
    paddingRight: DEPTH,
    paddingBottom: DEPTH,
  },
  disabled: {
    opacity: 0.45,
  },
  shadowBlock: {
    position: 'absolute',
    left: DEPTH,
    top: DEPTH,
    right: 0,
    bottom: 0,
    opacity: 0.55,
  },
  face: {
    backgroundColor: colors.bgPanel,
    borderWidth: 2,
    paddingVertical: 14,
    paddingHorizontal: 22,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  bevel: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 3,
    opacity: 0.7,
  },
  label: {
    fontSize: 14,
    fontWeight: '900',
    letterSpacing: 3,
  },
  caption: {
    marginTop: 3,
    fontSize: 8,
    letterSpacing: 2,
    color: colors.textDim,
  },
});
