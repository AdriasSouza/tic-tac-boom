import * as Haptics from 'expo-haptics';
import { useEffect, useState } from 'react';
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

import { playSound } from '@/audio/soundEngine';
import { useMatchPerspective } from '@/hooks/useMatchPerspective';
import { colors } from '@/theme/colors';
import { selectLastExtraTurn, useGameStore, type Combatant } from '@/store/gameStore';

/** Quanto tempo o letreiro fica na tela. */
const VISIBLE_MS = 1600;

/** Meio ciclo do pisca-pisca. */
const BLINK_MS = 220;

/**
 * Rótulo por ALIANÇA, não por combatente absoluto.
 *
 * O que muda a mensagem é "o turno extra é meu ou dele?" — e num jogo online
 * quem entrou na sala controla o `MACHINE`, então mapear pelo combatente
 * anunciaria "TURNO EXTRA DA CPU", em vermelho de ameaça, justamente quando o
 * convidado acabasse de GANHAR a jogada dupla.
 */
function labelFor(isLocal: boolean, isOnline: boolean) {
  if (isLocal) {
    return {
      title: 'TURNO EXTRA',
      caption: 'SUA PRÓXIMA JOGADA NÃO PASSA A VEZ',
      accent: colors.winGlow,
    };
  }

  const opponent = isOnline ? 'O RIVAL' : 'A CPU';
  return {
    title: `TURNO EXTRA D${isOnline ? 'O RIVAL' : 'A CPU'}`,
    caption: `${opponent} JOGA DUAS VEZES SEGUIDAS`,
    accent: colors.danger,
  };
}

type LastExtraTurn = { target: Combatant; id: number };

/**
 * Letreiro piscante de turno extra.
 *
 * Reage ao `id` monotônico de `lastExtraTurn` (mesmo padrão de
 * `<NoticeToast />`/`<DamageFlashOverlay />`), **não** ao valor de controle
 * `extraTurnPending` diretamente.
 *
 * A versão anterior comparava `extraTurnPending` com uma cópia guardada em
 * `useRef` para detectar a transição, e isso travava o banner piscando para
 * sempre sob o double-invoke de efeitos do React em dev: a MESMA transição
 * podia ser "consumida" pela invocação do efeito que o React descarta,
 * fazendo a invocação que sobrevive já ver "sem mudança" — e o timer que
 * esconderia o banner nunca era agendado. Um `id` que só avança quando o
 * STORE detecta uma concessão nova (via `subscribe`, fora de qualquer efeito
 * de componente) não sofre dessa corrida: o efeito aqui só precisa notar que
 * o `id` mudou, e isso é verdade não importa quantas vezes o efeito rode.
 */
export function ExtraTurnBanner() {
  const lastExtraTurn = useGameStore(selectLastExtraTurn);
  const { localCombatant, isOnline } = useMatchPerspective();
  const [visible, setVisible] = useState<LastExtraTurn | null>(null);

  const extraTurnId = lastExtraTurn?.id ?? null;
  useEffect(() => {
    // `startMatch`/`startNextRound` zeram `lastExtraTurn` de volta a `null`
    // (ver `createInitialState`) — sem este `else`, um banner que ainda
    // estivesse na tela no instante do reset ficaria PRESO: o cleanup do
    // efeito anterior cancela o timer antigo, mas como esta invocação
    // simplesmente retornava cedo, nada jamais chamava `setVisible(null)`
    // de novo. Resultado observado: o letreiro de "TURNO EXTRA" da partida
    // ANTERIOR sobrevivia visível no começo da partida nova.
    if (!lastExtraTurn) {
      setVisible(null);
      return;
    }
    setVisible(lastExtraTurn);

    const isLocal = lastExtraTurn.target === localCombatant;
    void Haptics.notificationAsync(
      isLocal ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Warning,
    );
    playSound(isLocal ? 'NOTIFY_SUCCESS' : 'NOTIFY_WARNING');

    // Reagendado a cada `id` novo: se um segundo turno extra for concedido
    // enquanto o primeiro letreiro ainda está na tela, o cronômetro reinicia
    // do zero para o novo em vez de herdar o tempo restante do anterior.
    const timer = setTimeout(() => setVisible(null), VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [extraTurnId, lastExtraTurn, localCombatant]);

  const blink = useSharedValue(1);

  useEffect(() => {
    if (!visible) return;
    blink.value = 1;
    blink.value = withRepeat(
      withTiming(0.25, { duration: BLINK_MS, easing: Easing.linear }),
      -1,
      true, // ping-pong: pisca, não pula
    );
    // Loop infinito: sem o cancelamento explícito ele sobreviveria na UI
    // thread depois do letreiro sair da tela.
    return () => cancelAnimation(blink);
  }, [visible, blink]);

  const blinkStyle = useAnimatedStyle(() => ({ opacity: blink.value }));

  if (!visible) return null;

  const { title, caption, accent } = labelFor(visible.target === localCombatant, isOnline);

  return (
    <View style={styles.layer} pointerEvents="none">
      <Animated.View
        // Remonta a cada concessão: garante a entrada animada mesmo quando
        // um turno extra substitui outro sem passar por "nenhum".
        key={visible.id}
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
