import * as Haptics from 'expo-haptics';
import { memo, useCallback, useEffect, useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  FadeInDown,
  FadeOutUp,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { getCard } from '@/engine/cards/registry';
import { useGameStore, type CardId } from '@/store/gameStore';
import { colors } from '@/theme/colors';

/* -------------------------------------------------------------------------- */
/*                                  CONSTANTES                                 */
/* -------------------------------------------------------------------------- */

export const CARD_WIDTH = 84;
export const CARD_HEIGHT = 118;

/** Escala aplicada enquanto a carta está sendo arrastada. */
const DRAG_SCALE = 0.1; // 1.0 ➜ 1.1

/** Quanto a carta "descola" do leque ao ser pega, em dp. */
const DRAG_LIFT = 14;

/** Quanto a carta em mira sobe e fica, em dp. */
const SELECTED_LIFT = 26;

/** Mola de retorno à mão. Sem overshoot exagerado: a carta é pesada. */
const RETURN_SPRING = { damping: 16, stiffness: 220, mass: 0.9 } as const;

/** Distância mínima antes do pan ativar — abaixo disso, o toque vira tap. */
const PAN_ACTIVATION = 8;

/* -------------------------------------------------------------------------- */
/*                                    PROPS                                    */
/* -------------------------------------------------------------------------- */

export interface CardItemProps {
  uid: string;
  cardId: CardId;
  /** Posição da carta na mão. Repassada nos callbacks para manter `memo` útil. */
  index: number;
  /** Posição em X no leque, já calculada pelo `<CardHand />`. */
  baseX: number;
  /** Elevação em Y no leque (arco). */
  baseY: number;
  /** Rotação no leque, em graus. */
  baseRotation: number;
  /** Fronteira Y (coordenada absoluta de tela) da zona de jogo. */
  playZoneBottom: number;
  /** Gate reativo: turno do jogador, partida em andamento e sem mira ativa. */
  canDrag: boolean;
  /** Esta é a carta em modo mira? */
  isSelected: boolean;
  /** z-index elevado enquanto arrasta. */
  isDragging: boolean;
  onDragStart: (index: number) => void;
  onDragEnd: () => void;
  /**
   * Toque rápido (sem arrastar) numa carta que NÃO está em mira. Abre o modo
   * foco (`<CardFocusModal />`) — a alternativa amigável ao mouse do fluxo de
   * arrastar, que não é intuitivo fora de touch.
   */
  onFocus: (uid: string) => void;
}

/* -------------------------------------------------------------------------- */
/*                                  COMPONENTE                                 */
/* -------------------------------------------------------------------------- */

/**
 * Carta arrastável.
 *
 * **Todo o gesto vive na UI thread.** Os callbacks do `Gesture.Pan()` são
 * worklets: nenhum frame do arrasto passa pela thread JS. `runOnJS` só é
 * chamado nos momentos discretos que precisam de JS.
 *
 * A árvore tem dois `Animated.View` de propósito:
 * - **externo** — recebe `entering`/`exiting` (layout animations do Reanimated);
 * - **interno** — recebe o `useAnimatedStyle` do gesto.
 *
 * Layout animations e animated styles disputam a mesma prop `transform` se
 * ficarem na mesma view; separar em duas camadas elimina o conflito.
 */
function CardItemComponent({
  uid,
  cardId,
  index,
  baseX,
  baseY,
  baseRotation,
  playZoneBottom,
  canDrag,
  isSelected,
  isDragging,
  onDragStart,
  onDragEnd,
  onFocus,
}: CardItemProps) {
  const card = getCard(cardId);

  /* --- Shared values ------------------------------------------------------ */
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const dragging = useSharedValue(0); // 0..1 — escala, rotação e sombra
  const selected = useSharedValue(0); // 0..1 — destaque do modo mira
  const launching = useSharedValue(0); // trava o reset do onFinalize

  /* --- Destaque de carta em mira ------------------------------------------ */
  useEffect(() => {
    selected.value = withTiming(isSelected ? 1 : 0, {
      duration: 200,
      easing: Easing.out(Easing.quad),
    });
  }, [isSelected, selected]);

  /* --- Ponte para a thread JS --------------------------------------------- */

  const handlePickUp = useCallback(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onDragStart(index);
  }, [onDragStart, index]);

  const handleReject = useCallback(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Soft);
    onDragEnd();
  }, [onDragEnd]);

  /** Devolve a carta à mão. Chamado quando o store recusa a jogada. */
  const springHome = useCallback(() => {
    launching.value = 0;
    translateX.value = withSpring(0, RETURN_SPRING);
    translateY.value = withSpring(0, RETURN_SPRING);
    dragging.value = withTiming(0, { duration: 150 });
  }, [launching, translateX, translateY, dragging]);

  /**
   * Carta **com** mira: não resolve nada. Arma `pendingAction` e volta para a
   * mão em estado selecionado — o tabuleiro assume a escolha do alvo.
   */
  const beginTargeting = useCallback(() => {
    const armed = useGameStore.getState().setPendingAction({ type: 'PLAY_CARD', uid, cardId });

    void Haptics.impactAsync(
      armed ? Haptics.ImpactFeedbackStyle.Rigid : Haptics.ImpactFeedbackStyle.Soft,
    );
    if (!armed) void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);

    springHome();
    onDragEnd();
  }, [uid, cardId, springHome, onDragEnd]);

  /** Carta **sem** mira: resolve na hora. */
  const commitPlay = useCallback(() => {
    const played = useGameStore.getState().playCard(uid, undefined);

    if (played) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      // Sem springHome: a carta sai da mão e o `exiting` anima daqui mesmo.
      onDragEnd();
      return;
    }

    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    springHome();
    onDragEnd();
  }, [uid, springHome, onDragEnd]);

  /** Tocar a carta em mira cancela a seleção. */
  const cancelTargeting = useCallback(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Soft);
    useGameStore.getState().clearPendingAction();
  }, []);

  /**
   * Toque numa carta que NÃO está em mira: abre o modo foco. Alternativa ao
   * arrastar, pensada para mouse/web — clicar é mais natural que "segurar e
   * arrastar" com um cursor.
   */
  const handleFocusTap = useCallback(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onFocus(uid);
  }, [onFocus, uid]);

  /* --- Gestos (100% UI thread) -------------------------------------------- */

  const requiresTarget = card.requiresTarget === true;

  const panGesture = useMemo(
    () =>
      Gesture.Pan()
        .enabled(canDrag)
        // Limiar de ativação: sem isto o pan engole o tap e a carta em mira
        // nunca poderia ser cancelada com um toque.
        .activeOffsetX([-PAN_ACTIVATION, PAN_ACTIVATION])
        .activeOffsetY([-PAN_ACTIVATION, PAN_ACTIVATION])
        .onStart(() => {
          dragging.value = withTiming(1, { duration: 120, easing: Easing.out(Easing.quad) });
          runOnJS(handlePickUp)();
        })
        .onUpdate((event) => {
          // Atribuição direta, sem animação: o dedo é a fonte da verdade.
          translateX.value = event.translationX;
          translateY.value = event.translationY;
        })
        .onEnd((event) => {
          // `absoluteY` é coordenada de tela — comparável com playZoneBottom
          // sem depender do layout do container da mão.
          const droppedInPlayZone = event.absoluteY < playZoneBottom;

          if (!droppedInPlayZone) {
            translateX.value = withSpring(0, RETURN_SPRING);
            translateY.value = withSpring(0, RETURN_SPRING);
            runOnJS(handleReject)();
            return;
          }

          if (requiresTarget) {
            // Volta para a mão; quem resolve agora é o tabuleiro.
            translateX.value = withSpring(0, RETURN_SPRING);
            translateY.value = withSpring(0, RETURN_SPRING);
            runOnJS(beginTargeting)();
            return;
          }

          // Congela onde soltou e resolve. Em caso de sucesso a carta some com
          // `exiting` a partir desta posição; em caso de recusa, `springHome`.
          launching.value = 1;
          runOnJS(commitPlay)();
        })
        .onFinalize(() => {
          if (launching.value === 0) {
            dragging.value = withTiming(0, { duration: 150 });
          }
        }),
    [
      canDrag,
      requiresTarget,
      playZoneBottom,
      handlePickUp,
      handleReject,
      beginTargeting,
      commitPlay,
      dragging,
      translateX,
      translateY,
      launching,
    ],
  );

  // Sempre habilitado (diferente de antes, quando só existia para cancelar a
  // mira): agora um toque simples SEMPRE faz algo — cancela, se a carta já
  // está selecionada; senão abre o foco. Nunca mais um "clique morto".
  const tapGesture = useMemo(
    () =>
      Gesture.Tap().onEnd((_event, success) => {
        if (!success) return;
        if (isSelected) runOnJS(cancelTargeting)();
        else runOnJS(handleFocusTap)();
      }),
    [isSelected, cancelTargeting, handleFocusTap],
  );

  // Race: o primeiro a ativar vence. Com o limiar do pan, um toque parado vira
  // tap e um arrasto real vira pan — sem ambiguidade.
  const gesture = useMemo(
    () => Gesture.Race(panGesture, tapGesture),
    [panGesture, tapGesture],
  );

  /* --- Estilo animado ------------------------------------------------------ */
  const animatedStyle = useAnimatedStyle(() => {
    const drag = dragging.value;
    const sel = selected.value;
    // Enquanto arrasta, o destaque de mira não deve somar elevação.
    const lift = drag * DRAG_LIFT + sel * SELECTED_LIFT * (1 - drag);

    return {
      transform: [
        { translateX: baseX + translateX.value },
        { translateY: baseY + translateY.value - lift },
        // A rotação do leque se desfaz conforme a carta é levantada.
        { rotate: `${baseRotation * (1 - Math.max(drag, sel))}deg` },
        { scale: 1 + drag * DRAG_SCALE + sel * 0.06 },
      ],
      borderColor: sel > 0.5 ? colors.winGlow : colors.boardFrameShadow,
      shadowOpacity: drag * 0.5 + sel * 0.6,
      shadowRadius: drag * 10 + sel * 8,
      elevation: drag * 14 + sel * 10,
    };
  });

  const accent = card.type === 'ACTION' ? colors.markX : colors.markO;

  return (
    <Animated.View
      // Layout animations vivem aqui, isoladas do transform do gesto.
      entering={FadeInDown.springify().damping(15).mass(0.7)}
      exiting={FadeOutUp.duration(220)}
      style={[styles.slot, isDragging && styles.slotDragging, isSelected && styles.slotSelected]}
      pointerEvents="box-none"
    >
      <GestureDetector gesture={gesture}>
        <Animated.View
          style={[styles.card, !canDrag && !isSelected && styles.cardDisabled, animatedStyle]}
          accessibilityRole="button"
          accessibilityState={{ selected: isSelected, disabled: !canDrag && !isSelected }}
          accessibilityLabel={`Carta ${card.name}. ${card.description}`}
          accessibilityHint={
            isSelected
              ? 'Toque numa célula do tabuleiro para usar, ou na carta para cancelar'
              : 'Arraste para cima para jogar'
          }
        >
          {/* Bisel chapado — mesma linguagem do Board e do HUD. */}
          <View style={[styles.bevelLight, { backgroundColor: accent }]} pointerEvents="none" />
          <View style={styles.bevelShadow} pointerEvents="none" />

          <Text style={[styles.type, { color: accent }]} numberOfLines={1}>
            {requiresTarget ? '◎ ' : ''}
            {card.type}
          </Text>

          <View style={[styles.artSlot, { borderColor: accent }]}>
            {/* TODO(fase 5): <Image source={cardSprite(card.id)} /> */}
            <Text style={[styles.artGlyph, { color: accent }]}>{card.name.charAt(0)}</Text>
          </View>

          <Text style={styles.name} numberOfLines={2}>
            {card.name}
          </Text>
        </Animated.View>
      </GestureDetector>
    </Animated.View>
  );
}

export const CardItem = memo(CardItemComponent);
export default CardItem;

/* -------------------------------------------------------------------------- */
/*                                   ESTILOS                                   */
/* -------------------------------------------------------------------------- */

const styles = StyleSheet.create({
  /**
   * Slots empilhados no mesmo ponto; o deslocamento do leque vem do
   * `translateX` da carta. Assim a sobreposição não depende de margens
   * negativas, que quebram a área de toque no Android.
   */
  slot: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  slotDragging: {
    zIndex: 100,
    elevation: 100,
  },
  slotSelected: {
    zIndex: 50,
    elevation: 50,
  },
  card: {
    position: 'absolute',
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    backgroundColor: colors.bgPanel,
    borderWidth: 2,
    borderColor: colors.boardFrameShadow,
    paddingHorizontal: 6,
    paddingVertical: 8,
    alignItems: 'center',
    justifyContent: 'space-between',
    overflow: 'hidden',
    // Sombra só aparece durante drag/seleção (shadowOpacity animado de 0).
    shadowColor: colors.winGlow,
    shadowOffset: { width: 0, height: 6 },
  },
  cardDisabled: {
    opacity: 0.55,
  },
  bevelLight: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 3,
  },
  bevelShadow: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 3,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  type: {
    fontSize: 7,
    letterSpacing: 2,
    fontWeight: '700',
  },
  artSlot: {
    width: CARD_WIDTH - 26,
    height: CARD_WIDTH - 26,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bgDeep,
  },
  artGlyph: {
    fontSize: 26,
    fontWeight: '900',
  },
  name: {
    fontSize: 9,
    letterSpacing: 1,
    fontWeight: '700',
    color: colors.text,
    textAlign: 'center',
  },
});
