import { memo } from 'react';
import { Modal, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeOut, ZoomIn } from 'react-native-reanimated';

import { PixelButton } from './PixelButton';
import { PixelPanel } from './PixelPanel';
import { colors } from '@/theme/colors';

export interface CreditsModalProps {
  visible: boolean;
  onClose: () => void;
}

/** Onboarding não é o único texto institucional — créditos merecem o mesmo cuidado visual. */
function CreditsModalComponent({ visible, onClose }: CreditsModalProps) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <Animated.View
        entering={FadeIn.duration(160)}
        exiting={FadeOut.duration(140)}
        style={styles.backdrop}
      >
        <Animated.View entering={ZoomIn.springify().damping(16).mass(0.7)} style={styles.holder}>
          <PixelPanel accent={colors.markO} contentStyle={styles.panelContent}>
            <Text style={styles.title}>CRÉDITOS</Text>
            <View style={styles.titleRule} />

            <Text style={styles.name}>ADRIAS SOARES DE SOUZA</Text>
            <Text style={styles.role}>Versão 1.0.0</Text>
            <Text style={styles.role}>Feito em: 28/07/2026</Text>
            <Text style={styles.role}>Desenvolvedor Full-Stack e Analista de Dados</Text>

            <View style={styles.divider} />

            <Text style={styles.body}>
              Bacharel em Sistemas de Informação e cursando mestrado em ciências da computação na
              UFAC.
            </Text>

            <PixelButton
              label="FECHAR"
              onPress={onClose}
              accent={colors.markO}
              style={styles.button}
            />
          </PixelPanel>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

export const CreditsModal = memo(CreditsModalComponent);
export default CreditsModal;

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
    maxWidth: 380,
  },
  panelContent: {
    padding: 18,
    alignItems: 'center',
  },
  title: {
    color: colors.markO,
    fontSize: 16,
    fontWeight: '900',
    letterSpacing: 4,
    textAlign: 'center',
  },
  titleRule: {
    height: 2,
    width: '100%',
    backgroundColor: colors.markO,
    opacity: 0.35,
    marginTop: 8,
    marginBottom: 16,
  },
  name: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: 2,
    textAlign: 'center',
  },
  role: {
    color: colors.textDim,
    fontSize: 10,
    letterSpacing: 1,
    marginTop: 4,
    textAlign: 'center',
  },
  divider: {
    height: 1,
    width: '60%',
    backgroundColor: colors.textDim,
    opacity: 0.25,
    marginVertical: 14,
  },
  body: {
    color: colors.text,
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
    opacity: 0.85,
    marginBottom: 18,
  },
  button: {
    alignSelf: 'stretch',
  },
});
