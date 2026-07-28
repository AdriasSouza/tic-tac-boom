import * as Haptics from 'expo-haptics';
import { memo, useCallback } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors } from '@/theme/colors';

export interface GameHeaderProps {
  onPause: () => void;
}

/**
 * Cabeçalho fixo no topo da tela de jogo: logo compacta + botão de pause.
 *
 * Fica ACIMA do `<ChaosTerminal />` — o terminal já ocupa a leitura central
 * do topo da tela, então o header precisa ser baixo (uma linha) para não
 * empurrar o tabuleiro para fora da área confortável de toque.
 */
function GameHeaderComponent({ onPause }: GameHeaderProps) {
  const handlePause = useCallback(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onPause();
  }, [onPause]);

  return (
    <View style={styles.root}>
      <Text style={styles.logo}>
        TIC TAC <Text style={styles.logoBoom}>BOOM</Text>
      </Text>

      <Pressable
        onPress={handlePause}
        style={styles.pauseButton}
        accessibilityRole="button"
        accessibilityLabel="Pausar partida"
        hitSlop={8}
      >
        <View style={styles.pauseBar} />
        <View style={styles.pauseBar} />
      </Pressable>
    </View>
  );
}

export const GameHeader = memo(GameHeaderComponent);
export default GameHeader;

const styles = StyleSheet.create({
  root: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 6,
  },
  logo: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: 2,
  },
  logoBoom: {
    color: colors.markX,
  },
  pauseButton: {
    width: 30,
    height: 26,
    borderWidth: 2,
    borderColor: colors.textDim,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  pauseBar: {
    width: 3,
    height: 12,
    backgroundColor: colors.text,
  },
});
