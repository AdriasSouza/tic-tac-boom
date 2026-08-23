import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { memo, useCallback } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { playSound } from '@/audio/soundEngine';
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
 *
 * Deliberadamente o mais fino possível: numa tela mobile curta, cada dp que o
 * header economiza aqui é um dp a mais que sobra para o tabuleiro e a mão de
 * cartas mais abaixo na coluna — que são os elementos que o jogador de fato
 * usa a cada jogada.
 */
function GameHeaderComponent({ onPause }: GameHeaderProps) {
  const handlePause = useCallback(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    playSound('TAP_LIGHT');
    onPause();
  }, [onPause]);

  return (
    <View style={styles.root}>
      <Text style={styles.logo} numberOfLines={1}>
        TIC TAC <Text style={styles.logoBoom}>BOOM</Text>
      </Text>

      {/* Só o pause continua aqui — comprar carta/passar a vez saíram pro slot
          de ação dentro da linha de combate (Fase 8g): eram pequenos demais e
          ficavam escondidos ao lado do pause, apesar de terem virado ações
          estratégicas centrais desde a Fase 8b/8c. */}
      <View style={styles.actions}>
        <Pressable
          onPress={handlePause}
          style={({ pressed }) => [styles.pauseButton, pressed && styles.pauseButtonPressed]}
          accessibilityRole="button"
          accessibilityLabel="Pausar partida"
          // A área de toque real é maior que a caixa visual — mantém o alvo
          // fácil de acertar mesmo com o botão desenhado pequeno e discreto.
          hitSlop={10}
        >
          <Ionicons name="pause" size={14} color={colors.text} />
        </Pressable>
      </View>
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
    paddingHorizontal: 12,
    paddingVertical: 2,
  },
  logo: {
    color: colors.text,
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1.5,
  },
  logoBoom: {
    color: colors.markX,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  pauseButton: {
    width: 22,
    height: 20,
    borderWidth: 2,
    borderColor: colors.textDim,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pauseButtonPressed: {
    opacity: 0.6,
  },
});
