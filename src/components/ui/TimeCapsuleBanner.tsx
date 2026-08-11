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
import { selectLastTimeCapsuleSave, useGameStore, type Combatant } from '@/store/gameStore';

/** Quanto tempo o letreiro fica na tela. */
const VISIBLE_MS = 1800;

/** Meio ciclo do pisca-pisca. */
const BLINK_MS = 260;

/**
 * Rótulo por ALIANÇA, não por combatente absoluto — mesmo racional de
 * `<ExtraTurnBanner />`: "quem sobreviveu, eu ou o adversário?" é o que muda
 * a mensagem, não qual `Combatant` bruto está por trás.
 */
function labelFor(isLocal: boolean, isOnline: boolean) {
  if (isLocal) {
    return {
      title: 'CÁPSULA DO TEMPO',
      caption: 'VOCÊ SOBREVIVEU COM 1 HP',
      accent: colors.shield,
    };
  }

  const opponent = isOnline ? 'O RIVAL' : 'A CPU';
  return {
    title: 'CÁPSULA DO TEMPO',
    caption: `${opponent} SOBREVIVEU COM 1 HP`,
    accent: colors.danger,
  };
}

type LastTimeCapsuleSave = { target: Combatant; id: number };

/**
 * Letreiro piscante de CÁPSULA DO TEMPO — mesmo padrão de
 * `<ExtraTurnBanner />` (reage ao `id` monotônico, não ao valor de controle
 * direto): o dano que zeraria o HP já foi interceptado em `takeDamage`
 * (`gameStore.ts`) antes de qualquer flash de dano acontecer sozinho: sem
 * este letreiro, "sobreviver por 1 HP" ficaria indistinguível de um dano
 * normal que por acaso não matou.
 */
export function TimeCapsuleBanner() {
  const lastSave = useGameStore(selectLastTimeCapsuleSave);
  const { localCombatant, isOnline } = useMatchPerspective();
  const [visible, setVisible] = useState<LastTimeCapsuleSave | null>(null);

  const saveId = lastSave?.id ?? null;
  useEffect(() => {
    // Mesma rede de segurança de `<ExtraTurnBanner />`: `startMatch`/
    // `startNextRound` não zeram este campo especificamente (`resumeMatch`
    // sim), mas o reset defensivo aqui evita o letreiro ficar preso caso o
    // campo alguma vez volte a `null` no meio de uma exibição.
    if (!lastSave) {
      setVisible(null);
      return;
    }
    setVisible(lastSave);

    const isLocal = lastSave.target === localCombatant;
    void Haptics.notificationAsync(
      isLocal ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Warning,
    );
    playSound(isLocal ? 'NOTIFY_SUCCESS' : 'NOTIFY_WARNING');

    const timer = setTimeout(() => setVisible(null), VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [saveId, lastSave, localCombatant]);

  const blink = useSharedValue(1);

  useEffect(() => {
    if (!visible) return;
    blink.value = 1;
    blink.value = withRepeat(
      withTiming(0.3, { duration: BLINK_MS, easing: Easing.linear }),
      -1,
      true,
    );
    return () => cancelAnimation(blink);
  }, [visible, blink]);

  const blinkStyle = useAnimatedStyle(() => ({ opacity: blink.value }));

  if (!visible) return null;

  const { title, caption, accent } = labelFor(visible.target === localCombatant, isOnline);

  return (
    <View style={styles.layer} pointerEvents="none">
      <Animated.View
        key={visible.id}
        entering={ZoomIn.springify().damping(12).mass(0.6)}
        exiting={FadeOut.duration(200)}
        style={[styles.banner, { borderColor: accent }]}
      >
        <Animated.Text style={[styles.title, { color: accent }, blinkStyle]}>{title}</Animated.Text>
        <Text style={styles.caption}>{caption}</Text>
      </Animated.View>
    </View>
  );
}

export default TimeCapsuleBanner;

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
    fontSize: 22,
    fontWeight: '900',
    letterSpacing: 3,
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
