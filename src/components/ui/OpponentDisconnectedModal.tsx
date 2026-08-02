import * as Haptics from 'expo-haptics';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeOut, ZoomIn } from 'react-native-reanimated';

import { PixelButton } from './PixelButton';
import { PixelPanel } from './PixelPanel';
import { useIsOpponentConnected } from '@/hooks/useLocalTurn';
import { netForfeit } from '@/services/syncBridge';
import { selectStatus, useGameStore } from '@/store/gameStore';
import { colors } from '@/theme/colors';

/**
 * Quanto tempo esperar antes de oferecer o W.O.
 *
 * Curto o bastante para não deixar o jogador conectado refém de uma queda
 * alheia por minutos; longo o bastante para não punir uma oscilação de rede
 * de poucos segundos, que é o caso mais comum de queda numa partida curta.
 */
const FORFEIT_GRACE_MS = 45_000;

/**
 * "O oponente perdeu a conexão. Aguardando reconexão..."
 *
 * Reage a `useIsOpponentConnected()` — um booleano puro, sem transição a
 * detectar como o `<OpponentLeftModal />` precisa: desconexão e reconexão
 * alternam livremente ao longo de uma partida (oscilação de rede), então
 * "mostrar quando falso, esconder quando verdadeiro" já é a resposta certa,
 * sem `ref` nem estado adicional para lembrar "eu já vi isto acontecer".
 *
 * Não usa `pendingAcknowledgement`/`isPaused`: o motor não sabe que existe
 * rede (ver `syncBridge`), então a trava de interação vive na camada de rede
 * (`Cell.handlePress`, `useCanPlayCardsNow`) — este modal só INFORMA e
 * oferece a saída por W.O., não é ele quem impede a jogada.
 */
export function OpponentDisconnectedModal() {
  const isOpponentConnected = useIsOpponentConnected();
  // Uma partida já decidida (inclusive por um W.O. que ESTE cliente acabou de
  // declarar) não deve reabrir este aviso por cima da tela de resultado — sem
  // isto, o `<GameOverOverlay />` (uma `View` comum) e este `<Modal />` nativo
  // disputariam a camada mais alta, e o `Modal` normalmente vence.
  const matchStatus = useGameStore(selectStatus);

  const visible = !isOpponentConnected && matchStatus !== 'MATCH_OVER';

  const [canForfeit, setCanForfeit] = useState(false);

  useEffect(() => {
    if (!visible) {
      setCanForfeit(false); // reconectou (ou a partida acabou) — zera para a PRÓXIMA queda
      return;
    }

    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    const timer = setTimeout(() => setCanForfeit(true), FORFEIT_GRACE_MS);
    return () => clearTimeout(timer);
  }, [visible]);

  const handleForfeit = () => {
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    netForfeit();
  };

  if (!visible) return null;

  return (
    <Modal visible transparent animationType="none" statusBarTranslucent>
      <Animated.View
        entering={FadeIn.duration(160)}
        exiting={FadeOut.duration(140)}
        style={styles.backdrop}
      >
        <Animated.View entering={ZoomIn.springify().damping(13).mass(0.8)} style={styles.holder}>
          <PixelPanel accent={colors.markO} contentStyle={styles.content}>
            <Text style={styles.subtitle}>CONEXÃO INSTÁVEL</Text>

            <View style={styles.glyphBox}>
              {canForfeit ? (
                <Text style={styles.glyph}>!</Text>
              ) : (
                <ActivityIndicator color={colors.markO} size="large" />
              )}
            </View>

            <Text style={styles.title}>O OPONENTE PERDEU A CONEXÃO</Text>
            <Text style={styles.description}>
              {canForfeit
                ? 'Ele ainda não voltou. Você pode esperar mais um pouco ou encerrar a partida agora.'
                : 'Aguardando reconexão... o jogo retoma sozinho assim que ele voltar.'}
            </Text>

            {canForfeit && (
              <PixelButton
                label="DECLARAR VITÓRIA (W.O.)"
                onPress={handleForfeit}
                accent={colors.danger}
                style={styles.button}
              />
            )}
          </PixelPanel>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

export default OpponentDisconnectedModal;

const GLYPH_SIZE = 68;

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(2,4,7,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  holder: {
    width: '100%',
    maxWidth: 340,
  },
  content: {
    padding: 20,
    alignItems: 'center',
  },
  subtitle: {
    color: colors.markO,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 3,
    textAlign: 'center',
  },
  glyphBox: {
    width: GLYPH_SIZE,
    height: GLYPH_SIZE,
    borderWidth: 3,
    borderColor: colors.markO,
    backgroundColor: colors.bgDeep,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
  },
  glyph: {
    color: colors.markO,
    fontSize: 34,
    fontWeight: '900',
  },
  title: {
    marginTop: 12,
    color: colors.text,
    fontSize: 15,
    fontWeight: '900',
    letterSpacing: 2,
    textAlign: 'center',
  },
  description: {
    marginTop: 6,
    color: colors.text,
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
    opacity: 0.85,
  },
  button: {
    alignSelf: 'stretch',
    marginTop: 20,
  },
});
