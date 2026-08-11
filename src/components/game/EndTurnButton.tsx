import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { memo, useCallback, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeOut, ZoomIn } from 'react-native-reanimated';

import { PixelButton } from '@/components/ui/PixelButton';
import { PixelPanel } from '@/components/ui/PixelPanel';
import { playSound } from '@/audio/soundEngine';
import { useCanPlayCardsNow } from '@/hooks/useLocalTurn';
import { netEndTurn } from '@/services/syncBridge';
import {
  selectPendingAcknowledgement,
  selectPendingInteraction,
  selectIsPaused,
  useGameStore,
} from '@/store/gameStore';
import { colors } from '@/theme/colors';

/**
 * Botão "passar a vez" — dá ao humano um consumidor real para `endTurn`
 * (`gameStore.ts`), que até esta fase nunca tinha nenhum (nem CPU, nem UI).
 * Utilidade geral (o comentário original de `endTurn` já dizia "útil para
 * cartas de pular turno"), não uma UI que só aparece com REBOBINAR em jogo —
 * por isso fica sempre montado, habilitado/desabilitado por opacidade nunca
 * por desmontar (mesmo tamanho renderizado nos dois estados).
 *
 * Autocontido de propósito: lê a store direto (mesmo padrão de `HUD`/
 * `TrapZone`/`CardHand`) em vez de subir estado para `[mode].tsx` — passar a
 * vez não tem estado de tela como o pause tem (`pauseVisible`), é ação pura.
 *
 * Passar a vez é IRREVERSÍVEL, e este ícone fica ao lado do pause — que é
 * inofensivo (só abre um menu) — sem exigir confirmação um toque acidental
 * entregaria o turno inteiro. Por isso o toque abre um modal de confirmação
 * (mesmo padrão visual de `PauseModal`/`AcknowledgementModal`: `Modal`
 * transparente + `PixelPanel` + `PixelButton`) em vez de chamar `netEndTurn()`
 * direto.
 */
function EndTurnButtonComponent() {
  const [confirmVisible, setConfirmVisible] = useState(false);

  const canPlayCardsNow = useCanPlayCardsNow();
  const isPaused = useGameStore(selectIsPaused);
  const pendingAcknowledgement = useGameStore(selectPendingAcknowledgement);
  const pendingInteraction = useGameStore(selectPendingInteraction);

  // Mesmas condições de `canPlaceAt`/`endTurn` (turno, pausa, confirmação e
  // interação pendentes) — nunca dispara um toque morto contra a store.
  const canEndTurn =
    canPlayCardsNow && !isPaused && pendingAcknowledgement === null && pendingInteraction === null;

  const openConfirm = useCallback(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    playSound('TAP_LIGHT');
    setConfirmVisible(true);
  }, []);

  const closeConfirm = useCallback(() => {
    setConfirmVisible(false);
  }, []);

  const confirmEndTurn = useCallback(() => {
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    playSound('NOTIFY_WARNING');
    netEndTurn();
    setConfirmVisible(false);
  }, []);

  return (
    <>
      <Pressable
        onPress={openConfirm}
        disabled={!canEndTurn}
        style={({ pressed }) => [
          styles.button,
          pressed && canEndTurn && styles.buttonPressed,
          !canEndTurn && styles.buttonDisabled,
        ]}
        accessibilityRole="button"
        accessibilityLabel="Passar a vez"
        accessibilityState={{ disabled: !canEndTurn }}
        hitSlop={10}
      >
        <Ionicons name="play-skip-forward" size={12} color={colors.text} />
      </Pressable>

      <Modal
        visible={confirmVisible}
        transparent
        animationType="none"
        onRequestClose={closeConfirm}
        statusBarTranslucent
      >
        <Animated.View
          entering={FadeIn.duration(160)}
          exiting={FadeOut.duration(140)}
          style={styles.backdrop}
        >
          <Animated.View entering={ZoomIn.springify().damping(16).mass(0.7)} style={styles.holder}>
            <PixelPanel accent={colors.winGlow} contentStyle={styles.panelContent}>
              <Text style={styles.title}>PASSAR A VEZ?</Text>
              <View style={styles.titleRule} />
              <Text style={styles.description}>
                Você não vai colocar peça neste turno. O resto da jogada (cartas, energia)
                já aconteceu — isto não pode ser desfeito.
              </Text>

              <View style={styles.actions}>
                <PixelButton
                  label="CONFIRMAR"
                  onPress={confirmEndTurn}
                  accent={colors.winGlow}
                  style={styles.action}
                />
                <PixelButton
                  label="CANCELAR"
                  onPress={closeConfirm}
                  variant="ghost"
                  style={styles.action}
                />
              </View>
            </PixelPanel>
          </Animated.View>
        </Animated.View>
      </Modal>
    </>
  );
}

export const EndTurnButton = memo(EndTurnButtonComponent);
export default EndTurnButton;

const styles = StyleSheet.create({
  // Mesmo tamanho do `pauseButton` de `GameHeader.tsx` de propósito: um
  // segundo botão do MESMO tamanho ao lado dele não muda a altura da linha —
  // o máximo entre os filhos não sobe, e é essa altura que consome o
  // orçamento do `<Board />` (AGENTS.md).
  button: {
    width: 22,
    height: 20,
    borderWidth: 2,
    borderColor: colors.textDim,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonPressed: {
    opacity: 0.6,
  },
  buttonDisabled: {
    opacity: 0.3,
  },

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
    color: colors.winGlow,
    fontSize: 16,
    fontWeight: '900',
    letterSpacing: 3,
    textAlign: 'center',
  },
  titleRule: {
    height: 2,
    backgroundColor: colors.winGlow,
    opacity: 0.35,
    marginTop: 8,
    marginBottom: 14,
  },
  description: {
    color: colors.text,
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
    opacity: 0.85,
  },
  actions: {
    gap: 10,
    marginTop: 18,
  },
  action: {
    alignSelf: 'stretch',
  },
});
