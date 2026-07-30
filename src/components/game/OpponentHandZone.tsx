import { memo, useMemo } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';

import { useMatchPerspective } from '@/hooks/useMatchPerspective';
import { selectHandOf, useGameStore } from '@/store/gameStore';
import { colors } from '@/theme/colors';

export interface OpponentHandZoneProps {
  style?: StyleProp<ViewStyle>;
}

/**
 * Mão do OPONENTE — quantas cartas ele tem, nunca quais.
 *
 * Um verso genérico por carta, proporcional ao tamanho da mão do combatente
 * remoto. Sem isto o jogador não tinha como saber se o adversário está
 * prestes a armar uma armadilha ou de mãos vazias — informação que já é
 * visível do lado dele (a própria mão), então escondê-la do outro lado
 * deixava a decisão mais opaca do que precisa ser. A IDENTIDADE das cartas
 * continua secreta (é o que ESPIONAGEM/VISÃO ABSOLUTA existem para revelar);
 * só a CONTAGEM fica pública.
 *
 * Lê a mão pelo combatente REMOTO da perspectiva, não por `machineHand` fixo:
 * numa sala online quem entrou controla o `MACHINE`, e a mão inimiga dele é a
 * do `PLAYER`. Com o literal, o convidado veria a contagem da própria mão
 * aqui em cima e a do adversário no leque de baixo — os dois lados trocados.
 *
 * `pointerEvents="none"`: puramente informativo, nunca arrastável — a carta
 * nem pertence ao jogador para ele jogar.
 */
export function OpponentHandZone({ style }: OpponentHandZoneProps) {
  const { remoteCombatant, isOnline } = useMatchPerspective();
  const hand = useGameStore(useMemo(() => selectHandOf(remoteCombatant), [remoteCombatant]));

  return (
    <View style={[styles.root, style]} pointerEvents="none">
      <Text style={styles.caption}>
        {isOnline ? 'MÃO DO OPONENTE' : 'MÃO DA CPU'} · {hand.length}
      </Text>
      <View style={styles.row}>
        {hand.map(({ uid }) => (
          <HandBackChip key={uid} />
        ))}
      </View>
    </View>
  );
}

export default OpponentHandZone;

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
