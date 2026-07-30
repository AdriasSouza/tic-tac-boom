import { memo } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';

import { selectMachineHand, useGameStore } from '@/store/gameStore';
import { colors } from '@/theme/colors';

export interface MachineHandZoneProps {
  style?: StyleProp<ViewStyle>;
}

/**
 * Mostra QUANTAS cartas a CPU tem — nunca quais. Um verso genérico por
 * carta, proporcional a `machineHand.length`.
 *
 * Sem isto o jogador não tinha como saber se a CPU está prestes a armar uma
 * armadilha ou está de mãos vazias — informação que já é visível para o
 * lado do jogador (a própria mão), então escondê-la do lado da CPU deixa a
 * decisão mais opaca do que precisa ser. A IDENTIDADE das cartas continua
 * secreta (é o que ESPIONAGEM/VISÃO ABSOLUTA existem para revelar); só a
 * CONTAGEM fica pública.
 *
 * `pointerEvents="none"`: puramente informativo, nunca arrastável — a carta
 * nem pertence ao jogador para ele jogar.
 */
export function MachineHandZone({ style }: MachineHandZoneProps) {
  const hand = useGameStore(selectMachineHand);

  return (
    <View style={[styles.root, style]} pointerEvents="none">
      <Text style={styles.caption}>MÃO DA CPU · {hand.length}</Text>
      <View style={styles.row}>
        {hand.map(({ uid }) => (
          <HandBackChip key={uid} />
        ))}
      </View>
    </View>
  );
}

export default MachineHandZone;

/* -------------------------------------------------------------------------- */
/*                                VERSO DA CARTA                               */
/* -------------------------------------------------------------------------- */

const HandBackChip = memo(function HandBackChip() {
  return (
    <Animated.View entering={FadeIn.duration(160)} exiting={FadeOut.duration(160)} style={styles.chip}>
      <Text style={styles.chipGlyph}>?</Text>
    </Animated.View>
  );
});

/* -------------------------------------------------------------------------- */
/*                                   ESTILOS                                   */
/* -------------------------------------------------------------------------- */

const CHIP_WIDTH = 20;
const CHIP_HEIGHT = 28;

const styles = StyleSheet.create({
  root: {
    width: '100%',
    alignItems: 'flex-end',
    paddingHorizontal: 16,
    gap: 4,
  },
  caption: {
    color: colors.textDim,
    fontSize: 7,
    letterSpacing: 2,
    fontWeight: '700',
  },
  row: {
    flexDirection: 'row',
    gap: 3,
    minHeight: CHIP_HEIGHT, // reserva altura mesmo com a mão vazia
  },
  chip: {
    width: CHIP_WIDTH,
    height: CHIP_HEIGHT,
    borderWidth: 2,
    borderColor: colors.boardFrameLight,
    backgroundColor: colors.boardFrame,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipGlyph: {
    color: colors.winGlow,
    fontSize: 11,
    fontWeight: '900',
  },
});
