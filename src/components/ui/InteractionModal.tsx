import * as Haptics from 'expo-haptics';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, Modal, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeOut, ZoomIn } from 'react-native-reanimated';

import { FLIP_CARD_HEIGHT, FLIP_CARD_WIDTH, FlipCard } from './FlipCard';
import { PixelButton } from './PixelButton';
import { PixelPanel } from './PixelPanel';
import { playSound } from '@/audio/soundEngine';
import { getCard } from '@/engine/cards/registry';
import { useMatchPerspective } from '@/hooks/useMatchPerspective';
import { netCancelInteraction, netResolveInteraction } from '@/services/syncBridge';
import type { InteractionSelection } from '@/engine/rules';
import { selectHandOf, selectPendingInteraction, useGameStore, type CardId } from '@/store/gameStore';
import { colors } from '@/theme/colors';

/**
 * Modal genérico para os 3 `kind`s de `pendingInteraction` que precisam de
 * grade tocável: `PICK_ONE_FROM_HAND`, `PICK_MANY_FROM_HAND`,
 * `PICK_ONE_REVEALED`. Os outros 3 `kind`s NÃO passam por aqui:
 *
 * - `BOARD_TARGET` — UI própria já existe (overlay do `<Board />`/`<Cell />`
 *   + banner do `<CardHand />`); mira não é modal, é o tabuleiro.
 * - `SACRIFICE_DRAG` — Altar de Sacrifício tem UI própria (`<AltarModal />`,
 *   arrastar/tocar em vez de grade), mesmo já usando `pendingInteraction`
 *   (Fase 6b) por baixo.
 * - `PICK_BOARD_CELL` — mesma UI do `BOARD_TARGET` (DESLIZAR, passo 2:
 *   escolher a célula de destino tocando no tabuleiro, não numa grade de
 *   cartas).
 *
 * Sempre montado no root (como `AcknowledgementModal`/`AltarModal`), decide
 * sozinho se tem algo para mostrar. `controlledCombatants` (`useMatchPerspective`,
 * JSDoc do próprio campo) decide se ESTE aparelho vê a UI de escolha: fora do
 * online mostra sempre (hot-seat controla os dois lados; CPU nunca abre estes
 * `kind`s ainda); no online só quem controla `pending.caster` vê — o outro
 * lado só sabe que está bloqueado (mão/tabuleiro já recusam por conta própria),
 * sem precisar de um segundo modal de "aguardando".
 */
export function InteractionModal() {
  const pending = useGameStore(selectPendingInteraction);
  const { controlledCombatants } = useMatchPerspective();

  // Hooks sempre chamados, mesmo sem `pending` — mesmo padrão de
  // `AcknowledgementModal` (early-return só depois de todos os hooks).
  const caster = pending?.caster ?? 'PLAYER';
  const casterHand = useGameStore(useMemo(() => selectHandOf(caster), [caster]));

  /** Seleção acumulada de `PICK_MANY_FROM_HAND`. Zera a cada interação nova. */
  const [picked, setPicked] = useState<readonly string[]>([]);
  const pendingUid = pending?.cardUid ?? null;
  useEffect(() => {
    setPicked([]);
  }, [pendingUid]);

  if (!pending) return null;
  if (
    pending.kind === 'BOARD_TARGET' ||
    pending.kind === 'SACRIFICE_DRAG' ||
    pending.kind === 'PICK_BOARD_CELL'
  )
    return null;
  if (!controlledCombatants.includes(pending.caster)) return null;

  const card = getCard(pending.cardId);
  const accent = card.type === 'ACTION' ? colors.markX : colors.markO;

  const cancel = () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    playSound('TAP_LIGHT');
    netCancelInteraction();
  };

  const resolve = (selection: InteractionSelection) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    playSound('TAP_MEDIUM');
    netResolveInteraction(selection);
  };

  const cardIdOf = (uid: string): CardId | null =>
    casterHand.find((entry) => entry.uid === uid)?.cardId ?? null;

  let caption: string;
  let confirmButton: { label: string; disabled: boolean; onPress: () => void } | null = null;
  let grid: React.ReactNode;

  if (pending.kind === 'PICK_ONE_FROM_HAND') {
    const isOwn = pending.source === pending.caster;
    caption = isOwn
      ? 'Escolha 1 carta da sua mão.'
      : 'Escolha 1 carta da mão oculta do oponente.';
    grid = (
      <View style={styles.grid}>
        {pending.optionUids.map((uid) =>
          isOwn ? (
            <View key={uid} style={styles.slotWrap}>
              <FlipCard
                cardId={cardIdOf(uid) ?? pending.cardId}
                revealed
                onPress={() => resolve({ kind: 'PICK_ONE_FROM_HAND', uid })}
              />
            </View>
          ) : (
            <HiddenSlot key={uid} onPress={() => resolve({ kind: 'PICK_ONE_FROM_HAND', uid })} />
          ),
        )}
      </View>
    );
  } else if (pending.kind === 'PICK_MANY_FROM_HAND') {
    const isOwn = pending.source === pending.caster;
    caption = isOwn
      ? `Escolha ${pending.count} carta${pending.count === 1 ? '' : 's'} da sua mão.`
      : `Escolha ${pending.count} carta${pending.count === 1 ? '' : 's'} da mão oculta do oponente.`;

    const toggle = (uid: string) => {
      setPicked((current) => {
        if (current.includes(uid)) return current.filter((u) => u !== uid);
        if (current.length >= pending.count) return current; // teto já atingido
        return [...current, uid];
      });
    };

    grid = (
      <View style={styles.grid}>
        {pending.optionUids.map((uid) => {
          const selected = picked.includes(uid);
          return isOwn ? (
            <View key={uid} style={[styles.slotWrap, selected && { borderColor: accent }]}>
              <FlipCard cardId={cardIdOf(uid) ?? pending.cardId} revealed onPress={() => toggle(uid)} />
            </View>
          ) : (
            <HiddenSlot key={uid} selected={selected} onPress={() => toggle(uid)} />
          );
        })}
      </View>
    );

    confirmButton = {
      label: `CONFIRMAR (${picked.length}/${pending.count})`,
      disabled: picked.length !== pending.count,
      onPress: () => resolve({ kind: 'PICK_MANY_FROM_HAND', uids: picked }),
    };
  } else {
    // PICK_ONE_REVEALED — hoje só PROCRASTINAR/PROCRASTINAR II usam este
    // `kind`. Apesar do nome ("reveladas"), o pedido do patch pós-Fase 7a é
    // justamente ESCONDER a identidade até a escolha: o barato da carta é
    // apostar às cegas, não ler os 3 nomes antes de decidir. `pending.options`
    // continua carregando os `CardId` reais (a rede/UI já sabem a identidade,
    // ver `rules.ts`) — só a APRESENTAÇÃO some, `revealed={false}` mostra
    // apenas o verso/posição de cada slot.
    caption = 'Escolha 1 carta às cegas.';
    grid = (
      <View style={styles.grid}>
        {pending.options.map((optionCardId, index) => (
          <View key={`${optionCardId}-${index}`} style={styles.slotWrap}>
            <FlipCard
              cardId={optionCardId}
              revealed={false}
              onPress={() => resolve({ kind: 'PICK_ONE_REVEALED', cardId: optionCardId })}
            />
          </View>
        ))}
      </View>
    );
  }

  return (
    <Modal visible transparent animationType="none" onRequestClose={cancel} statusBarTranslucent>
      <Animated.View
        key={pending.cardUid}
        entering={FadeIn.duration(160)}
        exiting={FadeOut.duration(140)}
        style={styles.backdrop}
      >
        <Animated.View entering={ZoomIn.springify().damping(13).mass(0.8)} style={styles.holder}>
          <PixelPanel accent={accent} contentStyle={styles.panelContent}>
            <Text style={[styles.subtitle, { color: accent }]}>{card.name}</Text>
            <Text style={styles.caption}>{caption}</Text>

            <ScrollView
              style={styles.gridScroll}
              contentContainerStyle={styles.gridContent}
              showsVerticalScrollIndicator={false}
            >
              {grid}
            </ScrollView>

            <View style={styles.actions}>
              <PixelButton label="CANCELAR" onPress={cancel} variant="ghost" style={styles.action} />
              {confirmButton && (
                <PixelButton
                  label={confirmButton.label}
                  onPress={confirmButton.onPress}
                  disabled={confirmButton.disabled}
                  accent={accent}
                  style={styles.action}
                />
              )}
            </View>
          </PixelPanel>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

export default InteractionModal;

/* -------------------------------------------------------------------------- */
/*                                HIDDEN SLOT                                  */
/* -------------------------------------------------------------------------- */

/**
 * Slot de carta oculta — mesma família visual do verso de `<FlipCard />`, mas
 * sem exigir `cardId`: a mão do oponente é secreta, então este componente
 * nunca sabe (nem pode saber) qual carta está por trás de cada `uid`.
 */
function HiddenSlot({
  onPress,
  selected = false,
}: {
  onPress: () => void;
  selected?: boolean;
}) {
  const handlePress = () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Rigid);
    playSound('TAP_RIGID');
    onPress();
  };
  return (
    <Pressable
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityLabel="Carta virada para baixo"
      style={[styles.hiddenSlot, selected && { borderColor: colors.winGlow }]}
    >
      <View style={styles.hiddenBevel} pointerEvents="none" />
      <Text style={styles.hiddenGlyph}>?</Text>
    </Pressable>
  );
}

/* -------------------------------------------------------------------------- */
/*                                   ESTILOS                                   */
/* -------------------------------------------------------------------------- */

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(2,4,7,0.88)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  holder: {
    width: '100%',
    maxWidth: 360,
    maxHeight: '90%',
  },
  panelContent: {
    padding: 18,
    alignItems: 'center',
  },
  subtitle: {
    fontSize: 14,
    fontWeight: '900',
    letterSpacing: 2,
    textAlign: 'center',
  },
  caption: {
    marginTop: 6,
    color: colors.text,
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
    opacity: 0.85,
  },
  gridScroll: {
    alignSelf: 'stretch',
    marginTop: 14,
    flexShrink: 1,
  },
  gridContent: {
    alignItems: 'center',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 8,
  },
  slotWrap: {
    borderWidth: 3,
    borderColor: 'transparent',
  },
  hiddenSlot: {
    width: FLIP_CARD_WIDTH,
    height: FLIP_CARD_HEIGHT,
    borderWidth: 2,
    borderColor: colors.boardFrameLight,
    backgroundColor: colors.boardFrame,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  hiddenBevel: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 2,
    backgroundColor: 'rgba(255,255,255,0.16)',
  },
  hiddenGlyph: {
    color: colors.winGlow,
    fontSize: 26,
    fontWeight: '900',
  },
  actions: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    gap: 10,
    marginTop: 18,
  },
  action: {
    flex: 1,
  },
});
