import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeOut, ZoomIn } from 'react-native-reanimated';

import { PixelButton } from './PixelButton';
import { PixelPanel } from './PixelPanel';
import { playSound } from '@/audio/soundEngine';
import {
  selectMultiplayerStatus,
  selectRoomCode,
  useMultiplayerStore,
} from '@/store/multiplayerStore';
import { colors } from '@/theme/colors';

/**
 * "O oponente desconectou."
 *
 * O `multiplayerStore` já derruba a sala para `DISCONNECTED` quando o
 * listener vê o nó apagado ou o status virar `FINISHED` (ver `startListening`)
 * — mas isso, sozinho, apenas fazia a tela parar de responder: o jogo
 * continuava desenhado, o tabuleiro travado pela vez do oponente, e nada
 * dizia ao jogador que não havia mais ninguém do outro lado. Este modal é a
 * peça que faltava entre "a conexão caiu" e "o jogador entende o que houve".
 *
 * Detecta a TRANSIÇÃO `MATCH_STARTED ➜ qualquer outra coisa`, não o estado
 * final: entrar na tela de jogo já desconectado (modo local, CPU) não pode
 * disparar nada, e é justamente o que uma checagem de estado puro faria.
 */
export function OpponentLeftModal() {
  const router = useRouter();
  const status = useMultiplayerStore(selectMultiplayerStatus);
  const roomCode = useMultiplayerStore(selectRoomCode);
  const leaveRoom = useMultiplayerStore((s) => s.leaveRoom);

  const [visible, setVisible] = useState(false);
  const wasPlayingRef = useRef(false);

  useEffect(() => {
    if (status === 'MATCH_STARTED') {
      wasPlayingRef.current = true;
      return;
    }

    // Só alerta quem ESTAVA numa partida online. Sem esta marca, abrir o modo
    // CPU (onde `status` é `DISCONNECTED` desde sempre) mostraria "o oponente
    // desconectou" na cara de quem nunca teve oponente.
    if (!wasPlayingRef.current) return;

    wasPlayingRef.current = false;
    setVisible(true);
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    playSound('NOTIFY_WARNING');
  }, [status]);

  const handleBackToLobby = useCallback(() => {
    setVisible(false);
    // Garante que nenhum resto de sala sobreviva para a próxima partida —
    // `leaveRoom` encerra o listener e zera o store de rede.
    void leaveRoom();
    router.replace('/lobby');
  }, [leaveRoom, router]);

  if (!visible) return null;

  return (
    <Modal visible transparent animationType="none" statusBarTranslucent onRequestClose={handleBackToLobby}>
      <Animated.View
        entering={FadeIn.duration(160)}
        exiting={FadeOut.duration(140)}
        style={styles.backdrop}
      >
        <Animated.View entering={ZoomIn.springify().damping(13).mass(0.8)} style={styles.holder}>
          <PixelPanel accent={colors.danger} contentStyle={styles.content}>
            <Text style={styles.subtitle}>CONEXÃO PERDIDA</Text>

            <View style={styles.glyphBox}>
              <Text style={styles.glyph}>!</Text>
            </View>

            <Text style={styles.title}>O OPONENTE DESCONECTOU</Text>
            <Text style={styles.description}>
              A partida não pode continuar sem os dois jogadores.
              {roomCode ? ` A sala ${roomCode} foi encerrada.` : ''}
            </Text>

            <PixelButton
              label="VOLTAR AO LOBBY"
              onPress={handleBackToLobby}
              accent={colors.danger}
              style={styles.button}
            />
          </PixelPanel>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

export default OpponentLeftModal;

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
    color: colors.danger,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 3,
    textAlign: 'center',
  },
  glyphBox: {
    width: GLYPH_SIZE,
    height: GLYPH_SIZE,
    borderWidth: 3,
    borderColor: colors.danger,
    backgroundColor: colors.bgDeep,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
  },
  glyph: {
    color: colors.danger,
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
