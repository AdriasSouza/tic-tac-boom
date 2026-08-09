import * as Haptics from 'expo-haptics';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  FadeIn,
  FadeOut,
  ZoomIn,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import { PixelButton } from './PixelButton';
import { PixelPanel } from './PixelPanel';
import { RARITY_LABEL, fuseRarity } from '@/engine/cards/definitions';
import { getCard } from '@/engine/cards/registry';
import { useMatchPerspective } from '@/hooks/useMatchPerspective';
import { netCancelInteraction, netResolveInteraction } from '@/services/syncBridge';
import { selectHandOf, selectPendingInteraction, useGameStore, type HandCard } from '@/store/gameStore';
import { colors } from '@/theme/colors';
import { RARITY_COLOR } from '@/theme/rarity';

/**
 * Modal do ALTAR DE SACRIFÍCIO.
 *
 * **Estado inteiramente local até o clique em "Confirmar".** `selection`
 * (quais uids ocupam os 2 slots) mora em `useState` deste componente — nunca
 * no `gameStore`, nunca na rede — enquanto o jogador arrasta, toca, troca de
 * ideia. A ÚNICA escrita que sai daqui é
 * `netResolveInteraction({ kind: 'SACRIFICE_DRAG', uids })`, e só no clique do
 * botão. É a mesma garantia que já vale para o resto do jogo ("só os inputs
 * trafegam"), aplicada a uma escolha que agora acontece em várias interações
 * de UI em vez de um único toque.
 *
 * Fase 6b: migrado do mecanismo próprio (`lastAltarPrompt`/`sacrificeCards`)
 * para `pendingInteraction` (`kind: 'SACRIFICE_DRAG'`) — mesma UI de
 * arrastar/tocar, só a fonte dos dados e o destino das ações mudaram. Como
 * bônus, "Cancelar" agora devolve a carta de verdade (`netCancelInteraction`
 * já reembolsa), o que o mecanismo antigo nunca fazia.
 *
 * **Duas formas de preencher um slot, sem colidirem:**
 * - **Arrastar**: cada carta da mão tem seu próprio `Gesture.Pan()`, e o
 *   ponto de soltura é comparado contra a caixa delimitadora (medida via
 *   `measureInWindow`) dos dois slots.
 * - **Tocar**: toca um slot (arma), toca uma carta (preenche o slot armado).
 *
 * As duas convivem via `Gesture.Race(pan, tap)` com um limiar de ativação no
 * pan — o MESMO mecanismo que já resolve isto em `<CardItem />` (arrastar vs.
 * abrir o modo foco). Vale registrar por que o risco específico citado no
 * pedido ("onClick disparando depois do onDragEnd") não se aplica aqui do
 * jeito que aconteceria em HTML5 nativo: não estamos usando a API de
 * drag-and-drop do navegador (`draggable`/`ondragstart`), e sim gestos do
 * `react-native-gesture-handler` baseados em ponteiro — não existe um evento
 * de clique do DOM disparando "depois" de um evento de arrasto nativo,
 * porque nenhum dos dois é nativo aqui. O risco ANÁLOGO real neste stack é
 * dois RECONHECEDORES DE GESTO competindo pelo mesmo toque, e é isso que o
 * `Race` + limiar resolve. A outra armadilha específica do React Native é
 * diferente da do pedido, mas do mesmo gênero: aninhar um `Pressable` (que
 * tem responder próprio) DENTRO de um `GestureDetector` pode reintroduzir o
 * mesmo tipo de disputa — por isso as cartas arrastáveis abaixo (`AltarHandChip`)
 * NÃO usam `Pressable`/`FlipCard` (que embute um `Pressable`); só o
 * `GestureDetector` decide.
 */

/* -------------------------------------------------------------------------- */
/*                                  GEOMETRIA                                  */
/* -------------------------------------------------------------------------- */

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const EMPTY_RECT: Rect = { x: 0, y: 0, width: 0, height: 0 };

/** `'worklet'`: precisa rodar na UI thread, dentro do `onEnd` do gesto de arrastar. */
function pointInRect(x: number, y: number, rect: Rect): boolean {
  'worklet';
  return x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height;
}

/** Distância mínima antes do pan ativar — mesmo limiar de `<CardItem />`. */
const DRAG_ACTIVATION = 8;

const CHIP_WIDTH = 68;
const CHIP_HEIGHT = 92;

/* -------------------------------------------------------------------------- */
/*                                    SLOT                                     */
/* -------------------------------------------------------------------------- */

interface AltarSlotProps {
  index: 0 | 1;
  card: HandCard | null;
  armed: boolean;
  onPress: (index: 0 | 1) => void;
  onMeasured: (index: 0 | 1, rect: Rect) => void;
}

const AltarSlot = memo(function AltarSlot({ index, card, armed, onPress, onMeasured }: AltarSlotProps) {
  const ref = useRef<View>(null);
  const cardDef = card ? getCard(card.cardId) : null;

  // `onLayout` é o gatilho (disparado sempre que a posição/tamanho mudam,
  // inclusive num resize de janela no web); `measureInWindow` é quem de fato
  // devolve coordenadas ABSOLUTAS de tela — as mesmas que `event.absoluteX/Y`
  // do gesto de arrastar usam, então as duas fontes são comparáveis.
  const handleLayout = useCallback(() => {
    ref.current?.measureInWindow((x, y, width, height) => onMeasured(index, { x, y, width, height }));
  }, [index, onMeasured]);

  const handlePress = useCallback(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onPress(index);
  }, [index, onPress]);

  return (
    <Pressable
      ref={ref}
      onLayout={handleLayout}
      onPress={handlePress}
      style={[
        styles.slot,
        armed && styles.slotArmed,
        cardDef ? { borderColor: RARITY_COLOR[cardDef.rarity] } : null,
      ]}
      accessibilityRole="button"
      accessibilityLabel={
        cardDef
          ? `Slot ${index + 1}: ${cardDef.name}. Toque para remover.`
          : `Slot ${index + 1} vazio. Toque para selecionar, depois toque numa carta da mão.`
      }
    >
      {cardDef ? (
        <>
          <View style={[styles.chipRarityBar, { backgroundColor: RARITY_COLOR[cardDef.rarity] }]} />
          <Text style={styles.chipName} numberOfLines={2}>
            {cardDef.name}
          </Text>
          <Text style={styles.chipCost}>{cardDef.cost}⚡</Text>
        </>
      ) : (
        <Text style={[styles.slotPlaceholder, armed && styles.slotPlaceholderArmed]}>
          {armed ? 'TOQUE\nNUMA CARTA' : `SLOT ${index + 1}`}
        </Text>
      )}
    </Pressable>
  );
});

/* -------------------------------------------------------------------------- */
/*                              CARTA DA MÃO (chip)                            */
/* -------------------------------------------------------------------------- */

interface AltarHandChipProps {
  card: HandCard;
  slot0Rect: SharedValue<Rect>;
  slot1Rect: SharedValue<Rect>;
  slot0Filled: boolean;
  slot1Filled: boolean;
  onDrop: (uid: string, index: 0 | 1) => void;
  onTap: (uid: string) => void;
}

/**
 * Sem `<Pressable>`/`<FlipCard>` de propósito — ver o porquê no JSDoc do
 * `<AltarModal />`. Só o `GestureDetector` decide o que este toque significa.
 */
const AltarHandChip = memo(function AltarHandChip({
  card,
  slot0Rect,
  slot1Rect,
  slot0Filled,
  slot1Filled,
  onDrop,
  onTap,
}: AltarHandChipProps) {
  const cardDef = getCard(card.cardId);

  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const dragging = useSharedValue(0);

  const handleDrop = useCallback(
    (index: 0 | 1) => {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      onDrop(card.uid, index);
    },
    [card.uid, onDrop],
  );

  const handleTap = useCallback(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onTap(card.uid);
  }, [card.uid, onTap]);

  const panGesture = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetX([-DRAG_ACTIVATION, DRAG_ACTIVATION])
        .activeOffsetY([-DRAG_ACTIVATION, DRAG_ACTIVATION])
        .onStart(() => {
          dragging.value = withTiming(1, { duration: 100 });
        })
        .onUpdate((event) => {
          translateX.value = event.translationX;
          translateY.value = event.translationY;
        })
        .onEnd((event) => {
          // Slot cheio não é alvo válido de soltura — precisa passar pelo
          // toque (que limpa o slot) antes de aceitar outra carta ali.
          const droppedOnSlot0 =
            !slot0Filled && pointInRect(event.absoluteX, event.absoluteY, slot0Rect.value);
          const droppedOnSlot1 =
            !slot1Filled && pointInRect(event.absoluteX, event.absoluteY, slot1Rect.value);

          if (droppedOnSlot0) runOnJS(handleDrop)(0);
          else if (droppedOnSlot1) runOnJS(handleDrop)(1);

          translateX.value = withSpring(0, { damping: 16, stiffness: 220, mass: 0.9 });
          translateY.value = withSpring(0, { damping: 16, stiffness: 220, mass: 0.9 });
        })
        .onFinalize(() => {
          dragging.value = withTiming(0, { duration: 120 });
        }),
    [slot0Filled, slot1Filled, slot0Rect, slot1Rect, handleDrop, dragging, translateX, translateY],
  );

  const tapGesture = useMemo(
    () =>
      Gesture.Tap().onEnd((_event, success) => {
        if (success) runOnJS(handleTap)();
      }),
    [handleTap],
  );

  // Mesma race de `<CardItem />`: o limiar do pan garante que um toque parado
  // sempre resolve como tap, e um arrasto real sempre resolve como pan.
  const gesture = useMemo(() => Gesture.Race(panGesture, tapGesture), [panGesture, tapGesture]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: 1 + dragging.value * 0.08 },
    ],
    zIndex: dragging.value > 0.5 ? 10 : 0,
    elevation: dragging.value * 8,
    shadowOpacity: dragging.value * 0.5,
  }));

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View style={[styles.chip, animatedStyle]}>
        <View style={[styles.chipRarityBar, { backgroundColor: RARITY_COLOR[cardDef.rarity] }]} />
        <Text style={styles.chipName} numberOfLines={2}>
          {cardDef.name}
        </Text>
        <Text style={styles.chipCost}>{cardDef.cost}⚡</Text>
      </Animated.View>
    </GestureDetector>
  );
});

/* -------------------------------------------------------------------------- */
/*                                  COMPONENTE                                 */
/* -------------------------------------------------------------------------- */

interface AltarSelection {
  slots: [string | null, string | null];
  armed: 0 | 1 | null;
}

const EMPTY_SELECTION: AltarSelection = { slots: [null, null], armed: null };

export function AltarModal() {
  const pending = useGameStore(selectPendingInteraction);
  const { localCombatant } = useMatchPerspective();
  const hand = useGameStore(useMemo(() => selectHandOf(localCombatant), [localCombatant]));

  const [visible, setVisible] = useState(false);
  const [selection, setSelection] = useState<AltarSelection>(EMPTY_SELECTION);

  const slot0Rect = useSharedValue<Rect>(EMPTY_RECT);
  const slot1Rect = useSharedValue<Rect>(EMPTY_RECT);

  const isAltarPrompt = pending?.kind === 'SACRIFICE_DRAG';

  /* Abre só para quem JOGOU a carta — ver o campo `caster` de `pending`. Do
     outro lado (ou no offline, ninguém) o fato só passa pelo anúncio
     genérico "carta jogada" que qualquer carta já dispara.
     Reage a `pending?.cardUid` (identidade da interação, não o objeto
     inteiro): jogar a carta duas vezes seguidas com o mesmo `caster` ainda
     reabre o modal, porque é o `cardUid` da nova interação que muda. */
  const cardUid = isAltarPrompt ? pending.cardUid : null;
  useEffect(() => {
    if (!isAltarPrompt || pending.caster !== localCombatant) return;
    setSelection(EMPTY_SELECTION);
    setVisible(true);
  }, [cardUid, isAltarPrompt, pending, localCombatant]);

  const handleMeasured = useCallback(
    (index: 0 | 1, rect: Rect) => {
      if (index === 0) slot0Rect.value = rect;
      else slot1Rect.value = rect;
    },
    [slot0Rect, slot1Rect],
  );

  /** Toca um slot VAZIO: arma (ou desarma, se já estava armado). Toca um slot CHEIO: limpa. */
  const handleSlotPress = useCallback((index: 0 | 1) => {
    setSelection((current) => {
      if (current.slots[index] !== null) {
        const slots: [string | null, string | null] = [...current.slots];
        slots[index] = null;
        return { slots, armed: null };
      }
      return { ...current, armed: current.armed === index ? null : index };
    });
  }, []);

  /** Toca uma carta da mão: só faz algo se algum slot estiver armado. */
  const handleHandCardTap = useCallback((uid: string) => {
    setSelection((current) => {
      if (current.armed === null) return current;
      const slots: [string | null, string | null] = [...current.slots];
      slots[current.armed] = uid;
      return { slots, armed: null };
    });
  }, []);

  /** Solta uma carta arrastada num slot vazio. Slot cheio recusa (não substitui). */
  const handleDrop = useCallback((uid: string, index: 0 | 1) => {
    setSelection((current) => {
      if (current.slots[index] !== null) return current;
      const slots: [string | null, string | null] = [...current.slots];
      slots[index] = uid;
      return { slots, armed: null };
    });
  }, []);

  // Cartas já num slot saem da fileira "disponível" — a mesma carta não pode
  // ocupar dois lugares ao mesmo tempo.
  const availableCards = useMemo(
    () => hand.filter((c) => !selection.slots.includes(c.uid)),
    [hand, selection.slots],
  );

  const slotCards = useMemo((): [HandCard | null, HandCard | null] => {
    const resolve = (uid: string | null) => (uid ? (hand.find((c) => c.uid === uid) ?? null) : null);
    return [resolve(selection.slots[0]), resolve(selection.slots[1])];
  }, [selection.slots, hand]);

  const canConfirm = selection.slots[0] !== null && selection.slots[1] !== null;

  /**
   * Piso de raridade da fusão, assim que os 2 slots preenchem — `fuseRarity`
   * é pura e barata (`definitions.ts`), só nunca tinha sido chamada antes do
   * `effect()` da carta resolver de verdade. Mostrar isto não estraga a
   * surpresa que o design documentado protege (a carta ESPECÍFICA sorteada
   * dentro da raridade continua oculta até confirmar) — só antecipa algo já
   * determinístico que o jogador poderia calcular sozinho olhando as duas
   * raridades nos slots.
   */
  const resultRarity = useMemo(() => {
    const [cardA, cardB] = slotCards;
    if (!cardA || !cardB) return null;
    return fuseRarity(getCard(cardA.cardId).rarity, getCard(cardB.cardId).rarity);
  }, [slotCards]);

  const handleConfirm = useCallback(() => {
    const [uidA, uidB] = selection.slots;
    if (uidA === null || uidB === null) return;
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    // Único ponto de contato com a rede — ver o JSDoc do componente.
    netResolveInteraction({ kind: 'SACRIFICE_DRAG', uids: [uidA, uidB] });
    setVisible(false);
  }, [selection.slots]);

  const handleCancel = useCallback(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Soft);
    // `netCancelInteraction` devolve o Altar para a mão e a energia gasta —
    // diferente do mecanismo antigo, que perdia a carta pra sempre ao cancelar.
    netCancelInteraction();
    setVisible(false);
  }, []);

  if (!visible) return null;

  return (
    <Modal visible transparent animationType="none" statusBarTranslucent onRequestClose={handleCancel}>
      <Animated.View
        entering={FadeIn.duration(160)}
        exiting={FadeOut.duration(140)}
        style={styles.backdrop}
      >
        <Animated.View entering={ZoomIn.springify().damping(13).mass(0.8)} style={styles.holder}>
          <PixelPanel accent={colors.markO} contentStyle={styles.panelContent}>
            <Text style={styles.subtitle}>ALTAR DE SACRIFÍCIO</Text>
            <Text style={styles.description}>
              Arraste 2 cartas até os slots — ou toque num slot e depois numa carta da mão.
            </Text>

            <View style={styles.slotsRow}>
              <AltarSlot
                index={0}
                card={slotCards[0]}
                armed={selection.armed === 0}
                onPress={handleSlotPress}
                onMeasured={handleMeasured}
              />
              <View style={styles.slotsDivider}>
                <Text style={styles.slotsDividerText}>+</Text>
              </View>
              <AltarSlot
                index={1}
                card={slotCards[1]}
                armed={selection.armed === 1}
                onPress={handleSlotPress}
                onMeasured={handleMeasured}
              />
            </View>

            <Text style={styles.handLabel}>SUA MÃO</Text>
            <View style={styles.handRow}>
              {availableCards.length === 0 ? (
                <Text style={styles.handEmpty}>NENHUMA CARTA DISPONÍVEL</Text>
              ) : (
                availableCards.map((card) => (
                  <AltarHandChip
                    key={card.uid}
                    card={card}
                    slot0Rect={slot0Rect}
                    slot1Rect={slot1Rect}
                    slot0Filled={selection.slots[0] !== null}
                    slot1Filled={selection.slots[1] !== null}
                    onDrop={handleDrop}
                    onTap={handleHandCardTap}
                  />
                ))
              )}
            </View>

            {resultRarity && (
              <View style={[styles.resultTag, { borderColor: RARITY_COLOR[resultRarity] }]}>
                <Text style={[styles.resultTagText, { color: RARITY_COLOR[resultRarity] }]}>
                  RESULTADO: {RARITY_LABEL[resultRarity]}
                </Text>
              </View>
            )}

            <PixelButton
              label="CONFIRMAR SACRIFÍCIO"
              onPress={handleConfirm}
              disabled={!canConfirm}
              accent={colors.markO}
              style={styles.action}
            />
            <PixelButton
              label="CANCELAR"
              variant="ghost"
              onPress={handleCancel}
              style={styles.action}
            />
          </PixelPanel>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

export default AltarModal;

/* -------------------------------------------------------------------------- */
/*                                   ESTILOS                                   */
/* -------------------------------------------------------------------------- */

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(2,4,7,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  holder: {
    width: '100%',
    maxWidth: 380,
    maxHeight: '90%',
  },
  panelContent: {
    padding: 18,
    alignItems: 'center',
  },
  subtitle: {
    color: colors.markO,
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: 2,
    textAlign: 'center',
  },
  description: {
    marginTop: 6,
    color: colors.text,
    fontSize: 11,
    lineHeight: 16,
    textAlign: 'center',
    opacity: 0.85,
  },
  slotsRow: {
    marginTop: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  slotsDivider: {
    width: 18,
    alignItems: 'center',
  },
  slotsDividerText: {
    color: colors.textDim,
    fontSize: 16,
    fontWeight: '900',
  },
  slot: {
    width: CHIP_WIDTH,
    height: CHIP_HEIGHT,
    borderWidth: 2,
    borderColor: colors.boardFrameShadow,
    borderStyle: 'dashed',
    backgroundColor: colors.bgDeep,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 4,
    gap: 4,
    overflow: 'hidden',
  },
  slotArmed: {
    borderStyle: 'solid',
    borderColor: colors.winGlow,
  },
  slotPlaceholder: {
    color: colors.textDim,
    fontSize: 8,
    fontWeight: '800',
    letterSpacing: 1,
    textAlign: 'center',
  },
  slotPlaceholderArmed: {
    color: colors.winGlow,
  },
  handLabel: {
    marginTop: 18,
    color: colors.textDim,
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 3,
  },
  handRow: {
    marginTop: 8,
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 8,
    // `flexWrap` (não `ScrollView`) de propósito: no máximo 4 cartas sobram
    // depois do Altar (HAND_LIMIT 5 menos ele mesmo), cabem sem rolar. Uma
    // `ScrollView` aqui competiria pelo MESMO gesto de arrastar das cartas —
    // risco de conflito real, evitado por não precisar dela.
    minHeight: CHIP_HEIGHT,
    alignItems: 'center',
  },
  handEmpty: {
    color: colors.textDim,
    fontSize: 9,
    letterSpacing: 2,
  },
  chip: {
    width: CHIP_WIDTH,
    height: CHIP_HEIGHT,
    borderWidth: 2,
    borderColor: colors.boardFrameShadow,
    backgroundColor: colors.bgPanel,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 4,
    gap: 4,
    overflow: 'hidden',
    shadowColor: colors.winGlow,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 8,
  },
  chipRarityBar: {
    position: 'absolute',
    top: 3,
    bottom: 3,
    left: 0,
    width: 3,
  },
  chipName: {
    color: colors.text,
    fontSize: 8,
    fontWeight: '800',
    letterSpacing: 0.5,
    textAlign: 'center',
  },
  chipCost: {
    color: colors.winGlow,
    fontSize: 9,
    fontWeight: '900',
  },
  resultTag: {
    marginTop: 16,
    borderWidth: 2,
    paddingHorizontal: 12,
    paddingVertical: 5,
    alignSelf: 'stretch',
    alignItems: 'center',
  },
  resultTagText: {
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 2,
  },
  action: {
    alignSelf: 'stretch',
    marginTop: 10,
  },
});
