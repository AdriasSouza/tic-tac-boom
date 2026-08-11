import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { memo, useCallback } from 'react';
import { Modal, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeOut, ZoomIn } from 'react-native-reanimated';

import { PixelButton } from './PixelButton';
import { PixelPanel } from './PixelPanel';
import { playSound } from '@/audio/soundEngine';
import { clearMatchSnapshot } from '@/store/matchPersistence';
import { useGameStore } from '@/store/gameStore';
import { useSettingsStore } from '@/store/settingsStore';
import { colors } from '@/theme/colors';

export interface PauseModalProps {
  visible: boolean;
  onClose: () => void;
}

/**
 * Menu de pause. Fecha bloqueando o tabuleiro (via `isPaused` no store — ver
 * `[mode].tsx`, que chama `setPaused(true)` ao abrir e `setPaused(false)` ao
 * fechar) e oferece três saídas: retomar, reiniciar do zero ou voltar ao menu.
 */
function PauseModalComponent({ visible, onClose }: PauseModalProps) {
  const router = useRouter();
  const startMatch = useGameStore((s) => s.startMatch);
  const soundEnabled = useSettingsStore((s) => s.soundEnabled);
  const toggleSound = useSettingsStore((s) => s.toggleSound);

  const handleResume = useCallback(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    playSound('TAP_LIGHT');
    onClose();
  }, [onClose]);

  const handleRestart = useCallback(() => {
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    playSound('NOTIFY_WARNING');
    // `startMatch()` já cuida de tudo — reseeda o RNG, zera o log do
    // terminal e distribui a mão inicial dos dois lados sozinha.
    startMatch();
    onClose();
  }, [startMatch, onClose]);

  const handleQuit = useCallback(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    playSound('TAP_MEDIUM');
    onClose();
    // Saída deliberada pro menu: o snapshot desta partida (se houver — online
    // nunca escreve um, então isto é um no-op inofensivo lá) não deve
    // reaparecer como "Continuar Partida" depois que o jogador já saiu por
    // conta própria. `status` ainda não chegou a MATCH_OVER aqui, então o
    // listener do `useMatchAutosave` sozinho não teria limpado.
    void clearMatchSnapshot();
    router.replace('/');
  }, [onClose, router]);

  const handleToggleSound = useCallback(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    playSound('TAP_LIGHT'); // toca ANTES do toggle — senão desligar nunca soa nada
    toggleSound();
  }, [toggleSound]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={handleResume} // botão físico de voltar no Android = retomar
      statusBarTranslucent
    >
      <Animated.View
        entering={FadeIn.duration(160)}
        exiting={FadeOut.duration(140)}
        style={styles.backdrop}
      >
        <Animated.View entering={ZoomIn.springify().damping(16).mass(0.7)} style={styles.holder}>
          <PixelPanel accent={colors.terminalGreen} contentStyle={styles.panelContent}>
            <Text style={styles.title}>PAUSADO</Text>
            <View style={styles.titleRule} />

            <View style={styles.actions}>
              <PixelButton
                label={soundEnabled ? 'SOM: LIGADO' : 'SOM: DESLIGADO'}
                onPress={handleToggleSound}
                variant="ghost"
                accent={soundEnabled ? colors.terminalGreen : colors.textDim}
                style={styles.action}
              />
              <PixelButton
                label="RETOMAR"
                onPress={handleResume}
                accent={colors.terminalGreen}
                style={styles.action}
              />
              <PixelButton
                label="REINICIAR PARTIDA"
                onPress={handleRestart}
                accent={colors.winGlow}
                style={styles.action}
              />
              <PixelButton
                label="SAIR PARA O MENU"
                onPress={handleQuit}
                variant="ghost"
                accent={colors.danger}
                style={styles.action}
              />
            </View>
          </PixelPanel>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

export const PauseModal = memo(PauseModalComponent);
export default PauseModal;

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(2,4,7,0.88)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  holder: {
    width: '100%',
    maxWidth: 340,
  },
  panelContent: {
    padding: 18,
  },
  title: {
    color: colors.terminalGreen,
    fontSize: 16,
    fontWeight: '900',
    letterSpacing: 4,
    textAlign: 'center',
  },
  titleRule: {
    height: 2,
    backgroundColor: colors.terminalGreen,
    opacity: 0.35,
    marginTop: 8,
    marginBottom: 16,
  },
  actions: {
    gap: 10,
  },
  action: {
    alignSelf: 'stretch',
  },
});
