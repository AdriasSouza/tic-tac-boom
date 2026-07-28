import { memo, type ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { colors } from '@/theme/colors';

export interface PixelPanelProps {
  children: ReactNode;
  /** Cor da moldura e dos cantos. */
  accent?: string;
  style?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
}

/**
 * Painel com moldura rústica no estilo nine-slice.
 *
 * Um nine-slice de verdade precisa de sprite; até os assets existirem, o mesmo
 * efeito é obtido com camadas chapadas: borda externa escura, bisel claro em
 * cima, bisel escuro embaixo e quatro quadrados de canto. Tudo com aresta dura
 * — nenhum `borderRadius` ou sombra difusa, que quebrariam a estética.
 *
 * Quando os sprites chegarem, troque o corpo por `<Image resizeMode="stretch">`
 * com as nove fatias; a API (`children`, `accent`) continua a mesma.
 */
function PixelPanelComponent({
  children,
  accent = colors.boardFrameLight,
  style,
  contentStyle,
}: PixelPanelProps) {
  return (
    <View style={[styles.outer, { borderColor: accent }, style]}>
      <View style={[styles.bevelTop, { backgroundColor: accent }]} pointerEvents="none" />
      <View style={styles.bevelBottom} pointerEvents="none" />

      {/* Cantos: o detalhe que faz a moldura parecer desenhada, não estilizada. */}
      <View style={[styles.corner, styles.cornerTL, { backgroundColor: accent }]} />
      <View style={[styles.corner, styles.cornerTR, { backgroundColor: accent }]} />
      <View style={[styles.corner, styles.cornerBL, { backgroundColor: accent }]} />
      <View style={[styles.corner, styles.cornerBR, { backgroundColor: accent }]} />

      <View style={[styles.content, contentStyle]}>{children}</View>
    </View>
  );
}

export const PixelPanel = memo(PixelPanelComponent);
export default PixelPanel;

const CORNER = 8;

const styles = StyleSheet.create({
  outer: {
    backgroundColor: colors.bgPanel,
    borderWidth: 3,
    overflow: 'hidden',
  },
  bevelTop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 3,
    opacity: 0.6,
  },
  bevelBottom: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 3,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  corner: {
    position: 'absolute',
    width: CORNER,
    height: CORNER,
  },
  cornerTL: { top: 0, left: 0 },
  cornerTR: { top: 0, right: 0 },
  cornerBL: { bottom: 0, left: 0 },
  cornerBR: { bottom: 0, right: 0 },
  content: {
    padding: 18,
  },
});
