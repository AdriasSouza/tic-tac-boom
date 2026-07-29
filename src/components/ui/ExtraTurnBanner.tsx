import * as Haptics from 'expo-haptics';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  FadeOut,
  ZoomIn,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { colors } from '@/theme/colors';
import { selectExtraTurnTarget, useGameStore, type Combatant } from '@/store/gameStore';

/** Quanto tempo o letreiro fica na tela. */
const VISIBLE_MS = 1600;

/** Meio ciclo do pisca-pisca. */
const BLINK_MS = 220;

const LABEL: Record<Combatant, { title: string; caption: string; accent: string }> = {
  PLAYER: {
    title: 'TURNO EXTRA',
    caption: 'SUA PRÓXIMA JOGADA NÃO PASSA A VEZ',
    accent: colors.winGlow,
  },
  MACHINE: {
    title: 'TURNO EXTRA DA CPU',
    caption: 'A CPU JOGA DUAS VEZES SEGUIDAS',
    accent: colors.danger,
  },
};

/**
 * Letreiro piscante de turno extra.
 *
 * Turno extra é a mecânica mais fácil de não perceber do jogo: nada muda no
 * tabuleiro, só a ordem das jogadas — e quando ele vem de uma MINA detonando,
 * quem foi beneficiado sequer jogou a carta que o concedeu. Sem um anúncio, o
 * jogador só descobre que ganhou (ou perdeu) uma jogada depois que ela
 * aconteceu.
 *
 * O gatilho é a TRANSIÇÃO de `extraTurnPending`, não o valor: a flag é
 * consumida na próxima jogada e pode ser rearmada depois, então comparar com
 * o valor anterior é o que distingue "acabou de ser concedido" de "continua
 * valendo". Fica na UI porque é puramente apresentacional — nenhuma regra
 * depende disto, e um campo de evento na store só para isto seria peso morto
 * no determinismo.
 */
export function ExtraTurnBanner() {
  const target = useGameStore(selectExtraTurnTarget);
  const [shown, setShown] = useState<Combatant | null>(null);

  const previousRef = useRef<Combatant | null>(null);

  useEffect(() => {
    const previous = previousRef.current;
    previousRef.current = target;

    // Só uma concessão NOVA anuncia: null ➜ alguém, ou troca de beneficiado.
    if (target === null || target === previous) return;

    setShown(target);
    void Haptics.notificationAsync(
      target === 'PLAYER'
        ? Haptics.NotificationFeedbackType.Success
        : Haptics.NotificationFeedbackType.Warning,
    );

    const timer = setTimeout(() => setShown(null), VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [target]);

  const blink = useSharedValue(1);

  useEffect(() => {
    if (!shown) return;
    blink.value = 1;
    blink.value = withRepeat(
      withTiming(0.25, { duration: BLINK_MS, easing: Easing.linear }),
      -1,
      true, // ping-pong: pisca, não pula
    );
    // Loop infinito: sem o cancelamento ele continuaria vivo na UI thread
    // depois do letreiro sair da tela, uma vez por turno extra da partida.
    return () => cancelAnimation(blink);
  }, [shown, blink]);

  const blinkStyle = useAnimatedStyle(() => ({ opacity: blink.value }));

  if (!shown) return null;

  const { title, caption, accent } = LABEL[shown];

  return (
    <View style={styles.layer} pointerEvents="none">
      <Animated.View
        entering={ZoomIn.springify().damping(12).mass(0.6)}
        exiting={FadeOut.duration(200)}
        style={[styles.banner, { borderColor: accent }]}
      >
        {/* Só o título pisca. Piscar a legenda junto tornaria a frase
            praticamente ilegível no tempo que ela fica na tela. */}
        <Animated.Text style={[styles.title, { color: accent }, blinkStyle]}>{title}</Animated.Text>
        <Text style={styles.caption}>{caption}</Text>
      </Animated.View>
    </View>
  );
}

export default ExtraTurnBanner;

const styles = StyleSheet.create({
  layer: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  banner: {
    backgroundColor: 'rgba(2,4,7,0.92)',
    borderWidth: 3,
    paddingHorizontal: 24,
    paddingVertical: 18,
    alignItems: 'center',
  },
  title: {
    fontSize: 26,
    fontWeight: '900',
    letterSpacing: 4,
    textAlign: 'center',
  },
  caption: {
    marginTop: 8,
    color: colors.text,
    fontSize: 9,
    letterSpacing: 2,
    fontWeight: '700',
    textAlign: 'center',
    opacity: 0.8,
  },
});
