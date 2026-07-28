import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { useCallback, useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming
} from 'react-native-reanimated';

import {
  INITIAL_HP,
  selectMachineHp,
  selectMatchSeed,
  selectPlayerHp,
  useGameStore,
} from '@/store/gameStore';
import { colors } from '@/theme/colors';
import { PixelButton } from './PixelButton';
import { PixelPanel } from './PixelPanel';

/* -------------------------------------------------------------------------- */
/*                                    PROPS                                    */
/* -------------------------------------------------------------------------- */

export interface GameOverOverlayProps {
  /** Cartas a comprar ao reiniciar — mantém a mão inicial igual à da tela. */
  openingHand?: number;
  hapticsEnabled?: boolean;
}

/* -------------------------------------------------------------------------- */
/*                                  COMPONENTE                                 */
/* -------------------------------------------------------------------------- */

/**
 * Tela de fim de partida.
 *
 * Renderiza `null` enquanto não há `matchWinner`, então **montar já significa
 * "a partida acabou"** — as animações de entrada disparam no mount, sem
 * precisar de flag de visibilidade nem de `useEffect` observando status.
 *
 * Cobre a tela inteira e captura todos os toques: com HP zerado o tabuleiro
 * atrás não deve mais aceitar jogada nenhuma.
 */
export function GameOverOverlay({
  openingHand = 3,
  hapticsEnabled = true,
}: GameOverOverlayProps) {
  const matchWinner = useGameStore((s) => s.matchWinner);

  if (!matchWinner) return null;

  // `key` força remontagem se a partida acabar de novo com outro vencedor —
  // garante que as animações de entrada rodem do zero.
  return <GameOverContent key={matchWinner} openingHand={openingHand} haptics={hapticsEnabled} />;
}

export default GameOverOverlay;

/* -------------------------------------------------------------------------- */

function GameOverContent({ openingHand, haptics }: { openingHand: number; haptics: boolean }) {
  const router = useRouter();

  const matchWinner = useGameStore((s) => s.matchWinner);
  const playerHp = useGameStore(selectPlayerHp);
  const machineHp = useGameStore(selectMachineHp);
  const matchSeed = useGameStore(selectMatchSeed);
  const startMatch = useGameStore((s) => s.startMatch);
  const drawCard = useGameStore((s) => s.drawCard);

  const playerWon = matchWinner === 'PLAYER';
  const accent = playerWon ? colors.winGlow : colors.danger;

  /* --- Animações ---------------------------------------------------------- */
  const enter = useSharedValue(0); // backdrop + painel
  const pulse = useSharedValue(0); // brilho do título
  const shake = useSharedValue(0); // impacto inicial

  useEffect(() => {
    enter.value = withTiming(1, { duration: 260, easing: Easing.out(Easing.quad) });

    pulse.value = withRepeat(
      withTiming(1, { duration: 900, easing: Easing.inOut(Easing.quad) }),
      -1,
      true,
    );

    // Sacode uma vez na entrada — o momento merece impacto.
    shake.value = withSequence(
      withTiming(-6, { duration: 55 }),
      withTiming(6, { duration: 55 }),
      withTiming(-3, { duration: 55 }),
      withTiming(0, { duration: 55 }),
    );

    if (haptics) {
      void Haptics.notificationAsync(
        playerWon
          ? Haptics.NotificationFeedbackType.Success
          : Haptics.NotificationFeedbackType.Error,
      );
    }

    return () => {
      cancelAnimation(enter);
      cancelAnimation(pulse);
      cancelAnimation(shake);
    };
  }, [enter, pulse, shake, haptics, playerWon]);

  const backdropStyle = useAnimatedStyle(() => ({
    opacity: enter.value,
  }));

  const panelStyle = useAnimatedStyle(() => ({
    opacity: enter.value,
    transform: [
      { translateX: shake.value },
      { translateY: interpolate(enter.value, [0, 1], [40, 0]) },
      { scale: interpolate(enter.value, [0, 1], [0.86, 1]) },
    ],
  }));

  const titleStyle = useAnimatedStyle(() => ({
    opacity: interpolate(pulse.value, [0, 1], [0.72, 1]),
    transform: [{ scale: interpolate(pulse.value, [0, 1], [1, 1.04]) }],
  }));

  /* --- Ações -------------------------------------------------------------- */

  /**
   * `startMatch()` recria o estado inicial inteiro — o que já zera
   * `terminalLog` e reinicia `nextLogId`. O `<ChaosTerminal />` detecta o log
   * vazio e manda `CLEAR` para a WebView, então o monitor limpa sozinho sem
   * precisar de uma action dedicada.
   */
  const handleRestart = useCallback(() => {
    startMatch();
    drawCard(openingHand);
  }, [startMatch, drawCard, openingHand]);

  const handleMenu = useCallback(() => {
    router.replace('/');
  }, [router]);

  return (
    // `pointerEvents="auto"` explícito: o overlay precisa engolir os toques
    // destinados ao tabuleiro que ficou atrás.
    <Animated.View style={[styles.root, backdropStyle]} pointerEvents="auto">
      <Animated.View style={[styles.holder, panelStyle]}>
        <PixelPanel accent={accent} contentStyle={styles.panel}>
          <Text style={styles.eyebrow}>FIM DE PARTIDA</Text>

          <Animated.Text style={[styles.title, { color: accent }, titleStyle]}>
            {playerWon ? 'VOCÊ VENCEU' : 'CPU VENCEU'}
          </Animated.Text>

          <Text style={styles.verdict}>
            {playerWon ? 'o caos não foi suficiente' : 'o caos levou a melhor'}
          </Text>

          <View style={styles.scoreRow}>
            <ScoreColumn label="VOCÊ" hp={playerHp} tone={colors.markX} />
            <Text style={styles.scoreSeparator}>×</Text>
            <ScoreColumn label="CPU" hp={machineHp} tone={colors.markO} />
          </View>

          <View style={styles.actions}>
            <PixelButton
              label="JOGAR NOVAMENTE"
              onPress={handleRestart}
              accent={accent}
              style={styles.action}
            />
            <PixelButton
              label="MENU"
              onPress={handleMenu}
              variant="ghost"
              style={styles.action}
            />
          </View>

          {/* A seed é a prova do determinismo: mesma seed + mesmas jogadas
              reproduzem a partida inteira, caos incluído. */}
          <View style={styles.seedRow}>
            <Text style={styles.seedLabel}>SEED</Text>
            <Text style={styles.seedValue} selectable>
              {matchSeed}
            </Text>
          </View>
          <Text style={styles.seedHint}>startMatch({matchSeed}) reproduz esta partida</Text>
        </PixelPanel>
      </Animated.View>
    </Animated.View>
  );
}

/* -------------------------------------------------------------------------- */

function ScoreColumn({ label, hp, tone }: { label: string; hp: number; tone: string }) {
  return (
    <View style={styles.scoreColumn}>
      <Text style={[styles.scoreLabel, { color: tone }]}>{label}</Text>
      <View style={styles.scoreBlocks}>
        {Array.from({ length: INITIAL_HP }, (_, i) => (
          <View
            key={i}
            style={[
              styles.scoreBlock,
              { borderColor: tone },
              i < hp && { backgroundColor: tone },
            ]}
          />
        ))}
      </View>
    </View>
  );
}

/* -------------------------------------------------------------------------- */
/*                                   ESTILOS                                   */
/* -------------------------------------------------------------------------- */

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(2,4,7,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    zIndex: 999,
  },
  holder: {
    width: '100%',
    maxWidth: 380,
  },
  panel: {
    padding: 20,
    alignItems: 'center',
  },
  eyebrow: {
    color: colors.textDim,
    fontSize: 8,
    letterSpacing: 4,
    fontWeight: '700',
  },
  title: {
    fontSize: 30,
    fontWeight: '900',
    letterSpacing: 3,
    marginTop: 8,
    textAlign: 'center',
  },
  verdict: {
    color: colors.textDim,
    fontSize: 10,
    letterSpacing: 2,
    marginTop: 6,
    textAlign: 'center',
  },

  /* Placar */
  scoreRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 18,
    marginTop: 20,
    marginBottom: 22,
  },
  scoreColumn: {
    alignItems: 'center',
    gap: 6,
  },
  scoreLabel: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 2,
  },
  scoreBlocks: {
    flexDirection: 'row',
    gap: 3,
  },
  scoreBlock: {
    width: 12,
    height: 12,
    borderWidth: 2,
  },
  scoreSeparator: {
    color: colors.textDim,
    fontSize: 14,
    fontWeight: '900',
  },

  /* Ações */
  actions: {
    alignSelf: 'stretch',
    gap: 10,
  },
  action: {
    alignSelf: 'stretch',
  },

  /* Seed */
  seedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 18,
  },
  seedLabel: {
    color: colors.textDim,
    fontSize: 8,
    letterSpacing: 3,
    fontWeight: '700',
  },
  seedValue: {
    color: colors.terminalGreen,
    fontSize: 12,
    fontFamily: 'monospace',
    letterSpacing: 1,
  },
  seedHint: {
    color: colors.textDim,
    fontSize: 7,
    letterSpacing: 1,
    marginTop: 4,
    opacity: 0.6,
    fontFamily: 'monospace',
  },
});
