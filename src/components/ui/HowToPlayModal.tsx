import { memo } from 'react';
import { Modal, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeOut, ZoomIn } from 'react-native-reanimated';

import { PixelButton } from './PixelButton';
import { PixelPanel } from './PixelPanel';
import { colors } from '@/theme/colors';
import { INITIAL_HP, MAX_PIECES_PER_PLAYER } from '@/store/gameStore';

export interface HowToPlayModalProps {
  visible: boolean;
  onClose: () => void;
}

interface Step {
  index: string;
  title: string;
  body: string;
  accent: string;
}

/**
 * Os números vêm das constantes de domínio, não escritos à mão.
 * Se `MAX_PIECES_PER_PLAYER` virar 4, o tutorial acompanha sozinho — texto de
 * onboarding desatualizado é pior do que não ter tutorial.
 */
const STEPS: readonly Step[] = [
  {
    index: '01',
    title: 'JOGO DA VELHA INFINITO',
    body: `Máximo de ${MAX_PIECES_PER_PLAYER} peças por jogador. A ${MAX_PIECES_PER_PLAYER + 1}ª jogada apaga a sua peça mais velha! Fique de olho: a peça condenada pisca antes de sumir.`,
    accent: colors.markX,
  },
  {
    index: '02',
    title: 'CAOS TOTAL',
    body: 'O Terminal de Glitch no topo muda as regras da mesa a qualquer momento. Peças somem em ordem aleatória, células são interditadas — e você não é avisado com antecedência.',
    accent: colors.terminalGreen,
  },
  {
    index: '03',
    title: 'CARTAS MUFFIN',
    body: `Arraste cartas para cima para jogar. Armadilhas vão viradas para a mesa e detonam sozinhas quando o oponente pisa nelas. Sobreviva com suas ${INITIAL_HP} vidas.`,
    accent: colors.winGlow,
  },
];

/**
 * Onboarding rápido. Três passos, sem paginação: rolar é mais rápido do que
 * clicar "próximo" três vezes, e o avaliador lê tudo de uma vez.
 */
function HowToPlayModalComponent({ visible, onClose }: HowToPlayModalProps) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="none" // as animações são do Reanimated, na UI thread
      onRequestClose={onClose} // botão físico de voltar no Android
      statusBarTranslucent
    >
      <Animated.View
        entering={FadeIn.duration(160)}
        exiting={FadeOut.duration(140)}
        style={styles.backdrop}
      >
        <Animated.View entering={ZoomIn.springify().damping(16).mass(0.7)} style={styles.holder}>
          <PixelPanel accent={colors.winGlow} contentStyle={styles.panelContent}>
            <Text style={styles.title}>COMO JOGAR</Text>
            <View style={styles.titleRule} />

            <ScrollView
              style={styles.scroll}
              contentContainerStyle={styles.scrollContent}
              showsVerticalScrollIndicator={false}
              bounces={false}
            >
              {STEPS.map((step) => (
                <View key={step.index} style={styles.step}>
                  <View style={styles.stepHeader}>
                    <View style={[styles.stepBadge, { backgroundColor: step.accent }]}>
                      <Text style={styles.stepBadgeText}>{step.index}</Text>
                    </View>
                    <Text style={[styles.stepTitle, { color: step.accent }]}>{step.title}</Text>
                  </View>
                  <Text style={styles.stepBody}>{step.body}</Text>
                </View>
              ))}
            </ScrollView>

            <PixelButton label="ENTENDI" onPress={onClose} accent={colors.winGlow} />
          </PixelPanel>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

export const HowToPlayModal = memo(HowToPlayModalComponent);
export default HowToPlayModal;

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
    maxWidth: 400,
  },
  panelContent: {
    padding: 16,
  },
  title: {
    color: colors.winGlow,
    fontSize: 16,
    fontWeight: '900',
    letterSpacing: 4,
    textAlign: 'center',
  },
  titleRule: {
    height: 2,
    backgroundColor: colors.winGlow,
    opacity: 0.35,
    marginTop: 8,
    marginBottom: 14,
  },
  scroll: {
    maxHeight: 380,
  },
  scrollContent: {
    paddingBottom: 6,
  },
  step: {
    marginBottom: 18,
  },
  stepHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  stepBadge: {
    width: 24,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepBadgeText: {
    color: colors.bgDeep,
    fontSize: 10,
    fontWeight: '900',
  },
  stepTitle: {
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 2,
    flexShrink: 1,
  },
  stepBody: {
    color: colors.text,
    fontSize: 12,
    lineHeight: 18,
    opacity: 0.85,
  },
});
