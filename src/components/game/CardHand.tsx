import { useCallback, useMemo, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';

import { CARD_HEIGHT, CardItem } from './CardItem';
import { colors } from '@/theme/colors';
import { getCard } from '@/engine/cards/registry';
import {
  selectCanPlayCards,
  selectPendingAction,
  selectPlayerHand,
  useGameStore,
} from '@/store/gameStore';

/* -------------------------------------------------------------------------- */
/*                             GEOMETRIA DO LEQUE                              */
/* -------------------------------------------------------------------------- */

/** Distância horizontal entre cartas vizinhas (menor que CARD_WIDTH ⇒ sobrepõe). */
const FAN_SPACING = 48;

/** Rotação por passo a partir do centro, em graus. */
const FAN_ANGLE_STEP = 7;

/** Teto da rotação total, para mãos grandes não virarem ventilador. */
const FAN_ANGLE_MAX = 16;

/** Quanto cada passo afunda a carta no arco, em dp. */
const FAN_ARC_LIFT = 7;

/** Fração da altura da tela que conta como "zona de jogo". */
const PLAY_ZONE_RATIO = 0.5;

/* -------------------------------------------------------------------------- */
/*                                    PROPS                                    */
/* -------------------------------------------------------------------------- */

export interface CardHandProps {
  style?: StyleProp<ViewStyle>;
}

/* -------------------------------------------------------------------------- */
/*                                  COMPONENTE                                 */
/* -------------------------------------------------------------------------- */

/**
 * Mão do jogador, disposta em leque na base da tela.
 *
 * Responsabilidades:
 * - calcular a geometria do leque (posição, rotação e arco de cada carta);
 * - resolver o z-index da carta em arrasto;
 * - repassar a fronteira da zona de jogo para os worklets;
 * - exibir a faixa de instrução do modo mira.
 *
 * A física do arrasto mora inteira no `<CardItem />`.
 */
export function CardHand({ style }: CardHandProps) {
  const hand = useGameStore(selectPlayerHand);
  const canPlayCards = useGameStore(selectCanPlayCards);
  const pendingAction = useGameStore(selectPendingAction);
  const clearPendingAction = useGameStore((s) => s.clearPendingAction);
  const { height } = useWindowDimensions();

  /**
   * Metade superior da tela = "jogar no tabuleiro".
   * Calculado aqui e passado como número puro: o worklet do gesto não pode
   * chamar hooks nem ler o store durante o arrasto.
   */
  const playZoneBottom = height * PLAY_ZONE_RATIO;

  /**
   * Índice da carta em arrasto, para levantá-la acima das vizinhas.
   *
   * Estado do React em vez de `zIndex` animado: mudança de z-index dentro de
   * `useAnimatedStyle` é instável no Android. Custa um render por arrasto —
   * irrelevante, já que os frames do movimento nunca tocam a thread JS.
   */
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);

  // Callbacks estáveis: uma arrow inline nas props anularia o `memo` do
  // CardItem e re-renderizaria a mão inteira a cada render do pai.
  const handleDragStart = useCallback((index: number) => setDraggingIndex(index), []);
  const handleDragEnd = useCallback(() => setDraggingIndex(null), []);

  const handleCancelTargeting = useCallback(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Soft);
    clearPendingAction();
  }, [clearPendingAction]);

  /** Geometria pré-calculada: recomputa só quando o tamanho da mão muda. */
  const layout = useMemo(() => {
    const count = hand.length;
    const middle = (count - 1) / 2;
    // Achata o leque conforme a mão cresce, respeitando o teto de ângulo.
    const angleStep = middle > 0 ? Math.min(FAN_ANGLE_STEP, FAN_ANGLE_MAX / middle) : 0;

    return Array.from({ length: count }, (_, index) => {
      const offset = index - middle;
      return {
        baseX: offset * FAN_SPACING,
        baseY: Math.abs(offset) * FAN_ARC_LIFT, // centro mais alto ⇒ arco
        baseRotation: offset * angleStep,
      };
    });
  }, [hand.length]);

  const isTargeting = pendingAction !== null;

  return (
    <View style={[styles.root, style]}>
      {/* Faixa de instrução — sem ela, o modo mira vira um beco sem saída. */}
      {isTargeting && (
        <Animated.View entering={FadeIn.duration(160)} exiting={FadeOut.duration(120)}>
          <Pressable
            onPress={handleCancelTargeting}
            style={styles.targetBanner}
            accessibilityRole="button"
            accessibilityLabel="Cancelar seleção de alvo"
          >
            <Text style={styles.targetBannerText}>
              ◎ ESCOLHA UM ALVO · {getCard(pendingAction.cardId).name}
            </Text>
            <Text style={styles.targetBannerCancel}>TOQUE AQUI PARA CANCELAR</Text>
          </Pressable>
        </Animated.View>
      )}

      <View style={styles.fan}>
        {hand.length === 0 ? (
          <Text style={styles.empty}>MÃO VAZIA</Text>
        ) : (
          hand.map(({ uid, cardId }, index) => {
            const { baseX, baseY, baseRotation } = layout[index];
            const isSelected = pendingAction?.uid === uid;

            return (
              <CardItem
                // `uid` é estável para o tempo de vida da carta: é o que faz
                // `entering`/`exiting` do Reanimated funcionarem ao remover
                // uma carta do meio do leque.
                key={uid}
                uid={uid}
                cardId={cardId}
                index={index}
                baseX={baseX}
                baseY={baseY}
                baseRotation={baseRotation}
                playZoneBottom={playZoneBottom}
                // Durante a mira ninguém arrasta: ou resolve, ou cancela.
                canDrag={canPlayCards && !isTargeting}
                isSelected={isSelected}
                isDragging={draggingIndex === index}
                onDragStart={handleDragStart}
                onDragEnd={handleDragEnd}
              />
            );
          })
        )}
      </View>
    </View>
  );
}

export default CardHand;

/* -------------------------------------------------------------------------- */
/*                                   ESTILOS                                   */
/* -------------------------------------------------------------------------- */

const styles = StyleSheet.create({
  root: {
    width: '100%',
    alignItems: 'center',
  },
  fan: {
    height: CARD_HEIGHT + 40,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  targetBanner: {
    marginBottom: 6,
    paddingHorizontal: 14,
    paddingVertical: 6,
    backgroundColor: colors.bgPanel,
    borderWidth: 2,
    borderColor: colors.winGlow,
    alignItems: 'center',
  },
  targetBannerText: {
    color: colors.winGlow,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 2,
  },
  targetBannerCancel: {
    color: colors.textDim,
    fontSize: 7,
    letterSpacing: 2,
    marginTop: 2,
  },
  empty: {
    color: colors.textDim,
    fontSize: 9,
    letterSpacing: 3,
  },
});
