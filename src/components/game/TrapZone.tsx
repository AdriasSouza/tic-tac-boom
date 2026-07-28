import * as Haptics from 'expo-haptics';
import { memo, useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { FadeIn, FadeInDown, FadeOut, ZoomOut } from 'react-native-reanimated';

import { getCard } from '@/engine/cards/registry';
import {
  TRAP_LIMIT,
  selectLastRevealedTrap,
  selectTraps,
  useGameStore,
  type Combatant,
} from '@/store/gameStore';
import { colors } from '@/theme/colors';

/* -------------------------------------------------------------------------- */
/*                                  CONSTANTES                                 */
/* -------------------------------------------------------------------------- */

const SLOT_WIDTH = 40;
const SLOT_HEIGHT = 54;

/** Tempo que o anúncio de armadilha revelada fica na tela. */
const REVEAL_NOTICE_MS = 2600;

/* -------------------------------------------------------------------------- */
/*                                    PROPS                                    */
/* -------------------------------------------------------------------------- */

export interface TrapZoneProps {
  /** De quem são as armadilhas exibidas. */
  owner?: Combatant;
  style?: StyleProp<ViewStyle>;
  hapticsEnabled?: boolean;
}

/* -------------------------------------------------------------------------- */
/*                                  COMPONENTE                                 */
/* -------------------------------------------------------------------------- */

/**
 * Zona de armadilhas — fica entre o tabuleiro e a mão.
 *
 * Mostra os `TRAP_LIMIT` espaços, com as cartas armadas viradas para baixo.
 * Slots vazios continuam desenhados: comunicam quantas armadilhas ainda cabem
 * sem precisar de texto.
 *
 * Só assina dois valores do store (as armadilhas do dono e a última revelada),
 * então detonar uma armadilha não re-renderiza tabuleiro nem mão.
 */
export function TrapZone({ owner = 'PLAYER', style, hapticsEnabled = true }: TrapZoneProps) {
  const traps = useGameStore(useMemo(() => selectTraps(owner), [owner]));
  const lastRevealed = useGameStore(selectLastRevealedTrap);

  /* --- Anúncio da revelação ----------------------------------------------
     Sem isto a armadilha detona de forma invisível: o HP cai, o turno muda e
     o jogador não faz ideia do porquê.                                      */
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!lastRevealed || lastRevealed.owner !== owner) return;

    setNotice(getCard(lastRevealed.cardId).name);

    if (hapticsEnabled) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    }

    const timeout = setTimeout(() => setNotice(null), REVEAL_NOTICE_MS);
    return () => clearTimeout(timeout);
    // `uid` como dependência: duas armadilhas iguais em sequência ainda
    // reanunciam, porque o uid difere.
  }, [lastRevealed?.uid, lastRevealed, owner, hapticsEnabled]);

  const emptySlots = Math.max(0, TRAP_LIMIT - traps.length);

  return (
    <View style={[styles.root, style]}>
      <View style={styles.row}>
        <Text style={styles.caption}>ARMADILHAS</Text>

        <View style={styles.slots}>
          {traps.map(({ uid }) => (
            <TrapBack key={uid} />
          ))}

          {Array.from({ length: emptySlots }, (_, i) => (
            <View key={`empty-${i}`} style={styles.emptySlot} />
          ))}
        </View>
      </View>

      {notice && (
        <Animated.View
          entering={FadeIn.duration(140)}
          exiting={FadeOut.duration(200)}
          style={styles.notice}
        >
          <Text style={styles.noticeText}>◆ {notice} DETONOU</Text>
        </Animated.View>
      )}
    </View>
  );
}

export default TrapZone;

/* -------------------------------------------------------------------------- */
/*                              VERSO DA CARTA                                 */
/* -------------------------------------------------------------------------- */

/**
 * Verso pixelado. Deliberadamente sem identidade: o oponente não pode saber
 * qual armadilha está armada, então todas as cartas viradas são idênticas.
 *
 * `exiting={ZoomOut}` marca o consumo — a carta some da mesa ao detonar.
 */
const TrapBack = memo(function TrapBack() {
  return (
    <Animated.View
      entering={FadeInDown.springify().damping(14).mass(0.6)}
      exiting={ZoomOut.duration(240)}
      style={styles.back}
    >
      {/* Bisel chapado, mesma linguagem do resto da UI. */}
      <View style={styles.backBevel} pointerEvents="none" />

      {/* Padrão de hachura: 3 barras diagonais em bloco, sem gradiente. */}
      <View style={styles.backPattern} pointerEvents="none">
        {[0, 1, 2].map((i) => (
          <View key={i} style={styles.backStripe} />
        ))}
      </View>

      <Text style={styles.backGlyph}>?</Text>
    </Animated.View>
  );
});

/* -------------------------------------------------------------------------- */
/*                                   ESTILOS                                   */
/* -------------------------------------------------------------------------- */

const styles = StyleSheet.create({
  root: {
    width: '100%',
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  caption: {
    color: colors.textDim,
    fontSize: 8,
    letterSpacing: 3,
    fontWeight: '700',
  },
  slots: {
    flexDirection: 'row',
    gap: 6,
  },
  emptySlot: {
    width: SLOT_WIDTH,
    height: SLOT_HEIGHT,
    borderWidth: 2,
    borderColor: colors.boardFrameShadow,
    opacity: 0.5,
  },
  back: {
    width: SLOT_WIDTH,
    height: SLOT_HEIGHT,
    backgroundColor: colors.boardFrame,
    borderWidth: 2,
    borderColor: colors.boardFrameLight,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
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
    gap: 7,
    opacity: 0.35,
  },
  backStripe: {
    width: SLOT_WIDTH * 1.6,
    height: 4,
    backgroundColor: colors.boardFrameShadow,
    transform: [{ rotate: '-45deg' }],
  },
  backGlyph: {
    color: colors.winGlow,
    fontSize: 18,
    fontWeight: '900',
  },
  notice: {
    marginTop: 6,
    paddingHorizontal: 12,
    paddingVertical: 4,
    backgroundColor: colors.bgPanel,
    borderWidth: 2,
    borderColor: colors.danger,
  },
  noticeText: {
    color: colors.danger,
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 2,
  },
});
