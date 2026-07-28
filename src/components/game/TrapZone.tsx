import { memo, useMemo } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { FadeInDown, ZoomOut } from 'react-native-reanimated';

import { TRAP_LIMIT, selectTraps, useGameStore, type Combatant } from '@/store/gameStore';
import { colors } from '@/theme/colors';

/* -------------------------------------------------------------------------- */
/*                                  CONSTANTES                                 */
/* -------------------------------------------------------------------------- */

const SLOT_WIDTH = 40;
const SLOT_HEIGHT = 54;

/* -------------------------------------------------------------------------- */
/*                                    PROPS                                    */
/* -------------------------------------------------------------------------- */

export interface TrapZoneProps {
  /** De quem são as armadilhas exibidas. */
  owner?: Combatant;
  style?: StyleProp<ViewStyle>;
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
 * O anúncio de detonação (nome da carta + haptic) morou aqui antes; agora vive
 * no `<AcknowledgementModal />`, que mostra a carta ampliada no centro da tela
 * ANTES do efeito mecânico aplicar — mais visível, e sem duplicar aviso.
 *
 * Só assina as armadilhas do dono, então uma detonando não re-renderiza
 * tabuleiro nem mão.
 */
export function TrapZone({ owner = 'PLAYER', style }: TrapZoneProps) {
  const traps = useGameStore(useMemo(() => selectTraps(owner), [owner]));
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
 * `exiting={ZoomOut}` marca o consumo — a carta some da mesa ao ser revelada
 * (o `<AcknowledgementModal />` assume a partir daí).
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
});
