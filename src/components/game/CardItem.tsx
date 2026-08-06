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
import { useLayoutMode } from '@/hooks/useLayoutMode';
import { netPlayCard } from '@/services/syncBridge';
import { RARITY_COLOR } from '@/theme/rarity';
import type { CardId } from '@/store/gameStore';
import { colors } from '@/theme/colors';

/* -------------------------------------------------------------------------- */
/*                                  CONSTANTES                                 */
/* -------------------------------------------------------------------------- */

/**
 * Tamanho de REFERÊNCIA da carta — usado só para derivar as proporções
 * internas (padding, fonte, art slot) a partir do `cardWidth` recebido via
 * prop. O tamanho de fato exibido vem de `<CardHand />` (via
 * `useResponsiveLayout`), nunca daqui: com medidas fixas a carta não encolhia
 * em telas pequenas e a mão terminava escondida fora da área visível, que era
 * exatamente o bug relatado.
 */
const REFERENCE_CARD_WIDTH = 84;

/** Escala aplicada enquanto a carta está sendo arrastada. */
const DRAG_SCALE = 0.1; // 1.0 ➜ 1.1

/** Quanto a carta "descola" do leque ao ser pega, em dp. */
const DRAG_LIFT = 14;

/** Quanto a carta em mira sobe e fica, em dp. */
const SELECTED_LIFT = 26;

/**
 * Destaque de foco da linha inferior: a carta sob o cursor sobe e cresce, e
 * passa por cima das vizinhas (o `zIndex` vem do `<CardHand />`, ver
 * `isHovered`).
 *
 * A carta se move SOZINHA — nada de reflow. Num leque as cartas se sobrepõem
 * de propósito, e empurrar as vizinhas para abrir espaço reorganizaria a
 * fileira inteira a cada passagem do mouse, tornando impossível mirar numa
 * carta específica. É o mesmo motivo pelo qual `translateY`/`scale` (que não
 * participam do cálculo de layout) são preferíveis a margem ou altura aqui.
 *
 * Só dispara com ponteiro de verdade. Em toque não existe estado "sobrevoado":
 * lá o toque já é o próprio gesto de jogar/abrir o foco, e o destaque
 * equivalente é o `SELECTED_LIFT` acima.
 */
const HOVER_LIFT = 20;
const HOVER_SCALE = 0.1; // 1.0 ➜ 1.1
const HOVER_DURATION = 200;

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
  /** Largura da carta em dp, já resolvida para esta tela. */
  cardWidth: number;
  /** Altura da carta em dp, já resolvida para esta tela. */
  cardHeight: number;
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
  /**
   * Cursor sobre esta carta. Vem do `<CardHand />` (e não de estado local)
   * porque o z-index precisa ser resolvido entre IRMÃS: só o pai sabe qual das
   * cartas deve ficar por cima, e apenas uma pode estar sobrevoada por vez.
   */
  isHovered: boolean;
  onDragStart: (index: number) => void;
  onDragEnd: () => void;
  /** Entrada/saída do ponteiro. Nunca dispara em toque. */
  onHoverChange: (index: number, hovered: boolean) => void;
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
  cardWidth,
  cardHeight,
  baseX,
  baseY,
  baseRotation,
  playZoneBottom,
  canDrag,
  isSelected,
  isDragging,
  isHovered,
  onDragStart,
  onDragEnd,
  onHoverChange,
  onFocus,
}: CardItemProps) {
  const card = getCard(cardId);

  /* --- Shared values ------------------------------------------------------ */
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const dragging = useSharedValue(0); // 0..1 — escala, rotação e sombra
  const selected = useSharedValue(0); // 0..1 — destaque do modo mira
  const hovered = useSharedValue(0); // 0..1 — destaque do cursor
  const launching = useSharedValue(0); // trava o reset do onFinalize

  /* --- Destaque de carta em mira ------------------------------------------ */
  useEffect(() => {
    selected.value = withTiming(isSelected ? 1 : 0, {
      duration: 200,
      easing: Easing.out(Easing.quad),
    });
  }, [isSelected, selected]);

  /* --- Destaque de cursor --------------------------------------------------
     Mesma forma do bloco acima, e de propósito: a transição de 200ms com
     easing de saída é o equivalente Reanimated do `transition: all .2s ease`
     do CSS — só que rodando na UI thread, então o realce continua fluido
     mesmo com o JS ocupado resolvendo uma jogada.                            */
  useEffect(() => {
    hovered.value = withTiming(isHovered ? 1 : 0, {
      duration: HOVER_DURATION,
      easing: Easing.out(Easing.quad),
    });
  }, [isHovered, hovered]);

  const handlePointerEnter = useCallback(() => onHoverChange(index, true), [onHoverChange, index]);
  const handlePointerLeave = useCallback(() => onHoverChange(index, false), [onHoverChange, index]);

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
   * Resolve a carta pela facade — sempre, sem ramo por `requiresTarget`
   * (Fase 3: não existe mais uma ação separada de "armar mira"; `playCard`
   * decide sozinho se resolve na hora ou abre uma interação, `BOARD_TARGET`
   * incluso). Energia e mão comitam ao abrir QUALQUER interação agora (não
   * só ao resolver), então em todos os casos a carta sai do leque — sucesso
   * anima a saída (`exiting`, sem `springHome`); recusa volta pro leque.
   */
  const commitPlay = useCallback(() => {
    // Facade da ponte: replica para o oponente no modo online e escolhe entre
    // `playCard`/`playMachineCard` conforme o combatente local. Fora do
    // online é um repasse puro para o store.
    const played = netPlayCard(uid, undefined);

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
        // Limiar de ativação: sem isto o pan engole o tap e um toque parado
        // nunca abriria o modo foco.
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

          // Congela onde soltou e resolve pela facade — sem ramo por
          // `requiresTarget` (Fase 3: o store decide sozinho se resolve na
          // hora ou abre uma interação). Em caso de sucesso a carta some com
          // `exiting` a partir desta posição; em caso de recusa, `springHome`.
          launching.value = 1;
          runOnJS(commitPlay)();
        })
        .onFinalize(() => {
          if (launching.value === 0) {
            dragging.value = withTiming(0, { duration: 150 });
          }
        }),
    [canDrag, playZoneBottom, handlePickUp, handleReject, commitPlay, dragging, translateX, translateY, launching],
  );

  // Toque simples sempre abre o modo foco — não existe mais um estado
  // "carta em mira" pra tocar de novo e cancelar (Fase 3: abrir QUALQUER
  // interação já tira a carta do leque, então não há como um segundo toque
  // chegar nela; cancelar é sempre pela faixa de instrução ou pelo modal).
  const tapGesture = useMemo(
    () =>
      Gesture.Tap().onEnd((_event, success) => {
        if (!success) return;
        runOnJS(handleFocusTap)();
      }),
    [handleFocusTap],
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
    /* Os três destaques (arrasto, mira, cursor) NÃO se somam: são graus
       diferentes do mesmo gesto de "levantar a carta", e empilhá-los mandaria
       uma carta arrastada com o mouse ainda em cima dela para 60dp acima do
       leque. A precedência é arrasto > mira > cursor, e cada nível anula o
       seguinte na proporção em que está ativo. */
    const hov = hovered.value * (1 - drag) * (1 - sel);
    const lift = drag * DRAG_LIFT + sel * SELECTED_LIFT * (1 - drag) + hov * HOVER_LIFT;

    return {
      transform: [
        { translateX: baseX + translateX.value },
        { translateY: baseY + translateY.value - lift },
        // A rotação do leque se desfaz conforme a carta é levantada — inclusive
        // sob o cursor: uma carta destacada e ainda torta fica mais difícil de
        // ler do que a vizinha em repouso, o que anularia o próprio destaque.
        { rotate: `${baseRotation * (1 - Math.max(drag, sel, hov))}deg` },
        { scale: 1 + drag * DRAG_SCALE + sel * 0.06 + hov * HOVER_SCALE },
      ],
      borderColor: sel > 0.5 ? colors.winGlow : colors.boardFrameShadow,
      shadowOpacity: drag * 0.5 + sel * 0.6 + hov * 0.35,
      shadowRadius: drag * 10 + sel * 8 + hov * 8,
      elevation: drag * 14 + sel * 10 + hov * 6,
    };
  });

  const accent = card.type === 'ACTION' ? colors.markX : colors.markO;
  const rarityColor = RARITY_COLOR[card.rarity];
  const { mode: layoutMode } = useLayoutMode();

  /* --- Métrica interna -----------------------------------------------------
     Tudo escala junto com a carta a partir da MESMA razão. Calcular cada
     medida "no olho" para telas pequenas deixaria o texto do tamanho de
     sempre dentro de uma moldura menor — e ele estouraria a borda.           */
  const s = cardWidth / REFERENCE_CARD_WIDTH;
  const artSize = Math.round(cardWidth - 26 * s);

  return (
    <Animated.View
      // Layout animations vivem aqui, isoladas do transform do gesto.
      entering={FadeInDown.springify().damping(15).mass(0.7)}
      exiting={FadeOutUp.duration(220)}
      style={[
        styles.slot,
        // Precedência de empilhamento, do mais forte ao mais fraco. A carta
        // sob o cursor precisa passar por CIMA das vizinhas — sem isto ela
        // cresce por baixo delas e o destaque some justamente na parte que a
        // sobreposição do leque já escondia.
        isHovered && styles.slotHovered,
        isSelected && styles.slotSelected,
        isDragging && styles.slotDragging,
      ]}
      pointerEvents="box-none"
    >
      <GestureDetector gesture={gesture}>
        <Animated.View
          style={[
            styles.card,
            {
              width: cardWidth,
              height: cardHeight,
              paddingHorizontal: Math.round(6 * s),
              paddingVertical: Math.round(8 * s),
            },
            !canDrag && !isSelected && styles.cardDisabled,
            animatedStyle,
          ]}
          // Ponteiro (mouse/caneta) apenas — em toque nunca dispara, que é o
          // comportamento desejado: lá o toque já resolve na hora.
          onPointerEnter={handlePointerEnter}
          onPointerLeave={handlePointerLeave}
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

          {/* Faixa de raridade: uma barra vertical na borda esquerda. Ocupa
              zero espaço de layout (é absoluta) — numa carta de 60dp de largura
              não sobra área para um rótulo escrito. */}
          <View style={[styles.rarityBar, { backgroundColor: rarityColor }]} pointerEvents="none" />

          {/* Linha de metadados: tipo + custo. EM FLUXO (não mais absoluta) —
              ocupa a MESMA altura que a linha do tipo já reservava sozinha, em
              QUALQUER modo, então não altera `cardHeight`/`handAreaHeight`
              (AGENTS.md). Custo sempre visível, inclusive 0 (Boom): esconder
              faria "sem número" significar duas coisas (Boom de graça vs. erro
              de dado), e com energia acumulável o jogador precisa do número
              pra decidir ENTRE cartas, não só saber se a atual cabe.

              Em `compact` a carta (60-88dp) já não tem folga: o rótulo de tipo
              sozinho já aparecia espremido e o nome já truncava. Espremer os
              dois nessa mesma linha piora os dois — então ali a linha mostra
              SÓ o custo (a informação acionável na hora de decidir: cabe na
              energia agora?); tipo continua legível por extenso no
              `<CardFocusModal />`, e raridade já está codificada na barra da
              borda. Em `regular`/`wide` cabem os dois lado a lado. */}
          <View
            style={[
              styles.metaRow,
              { justifyContent: layoutMode === 'compact' ? 'flex-end' : 'space-between' },
            ]}
          >
            {layoutMode !== 'compact' && (
              <Text
                style={[styles.type, { color: accent, fontSize: Math.max(6, Math.round(7 * s)) }]}
                numberOfLines={1}
              >
                {requiresTarget ? '◎ ' : ''}
                {card.type}
              </Text>
            )}

            <View
              style={[
                styles.costTag,
                {
                  borderColor: colors.winGlow,
                  paddingHorizontal: Math.round(4 * s),
                  paddingVertical: Math.round(1 * s),
                },
              ]}
            >
              <Text
                style={[styles.costTagText, { fontSize: Math.max(6, Math.round(8 * s)) }]}
                numberOfLines={1}
              >
                {card.cost}⚡
              </Text>
            </View>
          </View>

          <View style={[styles.artSlot, { borderColor: accent, width: artSize, height: artSize }]}>
            {/* TODO(fase 5): <Image source={cardSprite(card.id)} /> */}
            <Text style={[styles.artGlyph, { color: accent, fontSize: Math.round(26 * s) }]}>
              {card.name.charAt(0)}
            </Text>
          </View>

          <Text
            style={[styles.name, { fontSize: Math.max(7, Math.round(9 * s)) }]}
            numberOfLines={2}
          >
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
  /**
   * Abaixo de arrasto e mira: os dois são estados DELIBERADOS do jogador e
   * devem vencer o simples passar do mouse. Ainda assim bem acima do repouso,
   * para a carta sobrevoada cobrir todas as vizinhas do leque.
   */
  slotHovered: {
    zIndex: 25,
    elevation: 25,
  },
  card: {
    position: 'absolute',
    // width/height chegam por prop — ver `useResponsiveLayout`.
    backgroundColor: colors.bgPanel,
    borderWidth: 2,
    borderColor: colors.boardFrameShadow,
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
  rarityBar: {
    position: 'absolute',
    top: 3,
    bottom: 3,
    left: 0,
    width: 3,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'stretch',
  },
  // Tag retangular chapada, sem borderRadius (README: pixel art sem borrão)
  // — mesmo idioma visual de rarityTag/type, só a forma do custo mudou (era
  // um círculo flutuante na Fase 2.6).
  costTag: {
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  costTagText: {
    color: colors.winGlow,
    fontWeight: '800',
    letterSpacing: 1,
  },
  type: {
    letterSpacing: 2,
    fontWeight: '700',
  },
  artSlot: {
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bgDeep,
  },
  artGlyph: {
    fontWeight: '900',
  },
  name: {
    letterSpacing: 1,
    fontWeight: '700',
    color: colors.text,
    textAlign: 'center',
  },
});
