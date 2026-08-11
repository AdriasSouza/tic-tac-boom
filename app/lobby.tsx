import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';

import PixelButton from '@/components/ui/PixelButton';
import PixelPanel from '@/components/ui/PixelPanel';
import { playSound } from '@/audio/soundEngine';
import { isFirebaseConfigured } from '@/config/firebase';
import { normalizeRoomCode } from '@/services/multiplayerService';
import {
  selectError,
  selectIsBusy,
  selectMultiplayerStatus,
  selectPendingReconnectCode,
  selectPlayerId,
  selectRoomCode,
  selectSeed,
  useMultiplayerStore,
} from '@/store/multiplayerStore';
import { colors } from '@/theme/colors';

/** Comprimento do código de sala. Espelha `ROOM_CODE_LENGTH` do serviço. */
const CODE_LENGTH = 4;

/**
 * Lobby do multiplayer online.
 *
 * Duas ações: criar uma sala (vira `player1` e espera) ou entrar numa
 * existente pelo código (vira `player2` e a partida começa).
 *
 * Quando o servidor promove a sala para `MATCH_STARTED`, esta tela **se
 * substitui** pela tela de jogo levando a seed. A navegação é `replace`, não
 * `push`: o lobby não deve sobrar na pilha, senão o botão "voltar" do Android
 * devolveria o jogador a um lobby de uma sala em que ele já está jogando.
 *
 * Toda a orquestração de rede mora no `multiplayerStore` — aqui só há
 * apresentação e entrada de texto. É o mesmo desenho do resto do jogo: a UI
 * lê estado e dispara ações, nunca fala com a camada de transporte.
 */
export default function LobbyScreen() {
  const router = useRouter();

  const status = useMultiplayerStore(selectMultiplayerStatus);
  const roomCode = useMultiplayerStore(selectRoomCode);
  const playerId = useMultiplayerStore(selectPlayerId);
  const seed = useMultiplayerStore(selectSeed);
  const error = useMultiplayerStore(selectError);
  const isBusy = useMultiplayerStore(selectIsBusy);
  const pendingReconnectCode = useMultiplayerStore(selectPendingReconnectCode);

  const createRoom = useMultiplayerStore((s) => s.createRoom);
  const joinRoom = useMultiplayerStore((s) => s.joinRoom);
  const leaveRoom = useMultiplayerStore((s) => s.leaveRoom);
  const clearError = useMultiplayerStore((s) => s.clearError);
  const reconnect = useMultiplayerStore((s) => s.reconnect);
  const dismissReconnect = useMultiplayerStore((s) => s.dismissReconnect);

  const [codeInput, setCodeInput] = useState('');

  const configured = isFirebaseConfigured();

  /* --- Início da partida ---------------------------------------------------
     Efeito, e não um callback do botão: quem CRIOU a sala não clica em nada
     para começar — a partida arranca quando o oponente entra, e isso chega
     pelo listener. Reagir ao status cobre os dois lados com um caminho só.  */
  useEffect(() => {
    if (status !== 'MATCH_STARTED' || seed === null) return;

    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    playSound('NOTIFY_SUCCESS');
    router.replace({
      pathname: '/game/[mode]',
      params: { mode: 'online', seed: String(seed) },
    });
  }, [status, seed, router]);

  const handleCreate = useCallback(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    playSound('TAP_MEDIUM');
    void createRoom();
  }, [createRoom]);

  const handleJoin = useCallback(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    playSound('TAP_MEDIUM');
    void joinRoom(codeInput);
  }, [joinRoom, codeInput]);

  const handleChangeCode = useCallback(
    (text: string) => {
      // Normaliza enquanto digita (maiúsculas, sem espaço): o campo passa a
      // mostrar exatamente o que será enviado, então "não encontrada" nunca é
      // culpa de um caractere invisível que o jogador não vê.
      setCodeInput(normalizeRoomCode(text).slice(0, CODE_LENGTH));
      clearError();
    },
    [clearError],
  );

  const handleBack = useCallback(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    playSound('TAP_LIGHT');
    void leaveRoom();
    router.back();
  }, [leaveRoom, router]);

  const handleReconnect = useCallback(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    playSound('TAP_MEDIUM');
    void reconnect();
  }, [reconnect]);

  const handleDismissReconnect = useCallback(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Soft);
    playSound('TAP_SOFT');
    dismissReconnect();
  }, [dismissReconnect]);

  /* --- Sem configuração ---------------------------------------------------- */
  if (!configured) {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'bottom', 'left', 'right']}>
        <PixelPanel accent={colors.danger} style={styles.panel} contentStyle={styles.panelContent}>
          <Text style={styles.title}>ONLINE INDISPONÍVEL</Text>
          <Text style={styles.hint}>
            As credenciais do Firebase não foram encontradas. Defina as variáveis
            EXPO_PUBLIC_FIREBASE_* no arquivo .env e reinicie o servidor do Expo.
          </Text>
          <PixelButton label="VOLTAR" variant="ghost" onPress={handleBack} style={styles.action} />
        </PixelPanel>
      </SafeAreaView>
    );
  }

  /* --- Aguardando oponente -------------------------------------------------
     Só quem criou a sala vê esta tela: `player2` entra e a partida começa no
     mesmo instante, sem espera.                                             */
  const isWaiting = status === 'IN_LOBBY' && roomCode !== null;

  /* --- Oferta de reconexão --------------------------------------------------
     `status === 'DISCONNECTED'` exclui o instante em que `reconnect()` já
     está em voo (aí `enterRoom` já pôs `isBusy`/`IN_LOBBY` e este bloco
     precisa sair da frente para o spinner normal de "entrando" aparecer). */
  const showReconnectOffer = pendingReconnectCode !== null && status === 'DISCONNECTED';

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom', 'left', 'right']}>
      <View style={styles.header}>
        <Text style={styles.logo}>
          MODO <Text style={styles.logoAccent}>ONLINE</Text>
        </Text>
      </View>

      {showReconnectOffer ? (
        <PixelPanel accent={colors.markX} style={styles.panel} contentStyle={styles.panelContent}>
          <Text style={styles.subtitle}>PARTIDA EM ANDAMENTO</Text>

          <Text style={styles.hint}>
            Encontramos uma sessão salva da sala{' '}
            <Text style={styles.reconnectCode}>{pendingReconnectCode}</Text>. Reconectar entra de
            volta de onde parou.
          </Text>

          <PixelButton
            label="RECONECTAR"
            onPress={handleReconnect}
            disabled={isBusy}
            style={styles.action}
          />

          {isBusy && <ActivityIndicator color={colors.markX} style={styles.busy} />}

          <PixelButton
            label="COMEÇAR DO ZERO"
            variant="ghost"
            onPress={handleDismissReconnect}
            disabled={isBusy}
            style={styles.action}
          />
        </PixelPanel>
      ) : isWaiting ? (
        <PixelPanel accent={colors.winGlow} style={styles.panel} contentStyle={styles.panelContent}>
          <Text style={styles.subtitle}>CÓDIGO DA SALA</Text>

          {/* O código é a única coisa que o jogador precisa transmitir para o
              amigo — merece ser o maior elemento da tela, legível de longe e
              num print de celular. */}
          <View style={styles.codeBox}>
            <Text style={styles.codeText} selectable>
              {roomCode}
            </Text>
          </View>

          <View style={styles.waitingRow}>
            <ActivityIndicator color={colors.winGlow} />
            <Text style={styles.hint}>Aguardando o oponente entrar...</Text>
          </View>

          <Text style={styles.slotHint}>
            Você é {playerId === 'player1' ? 'o anfitrião' : 'o convidado'}
          </Text>

          <PixelButton
            label="CANCELAR"
            variant="ghost"
            onPress={handleBack}
            style={styles.action}
          />
        </PixelPanel>
      ) : (
        <PixelPanel accent={colors.markO} style={styles.panel} contentStyle={styles.panelContent}>
          <PixelButton
            label="CRIAR SALA"
            onPress={handleCreate}
            disabled={isBusy}
            caption="você recebe um código para compartilhar"
            style={styles.action}
          />

          <View style={styles.divider}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>OU</Text>
            <View style={styles.dividerLine} />
          </View>

          <Text style={styles.subtitle}>ENTRAR COM CÓDIGO</Text>

          <TextInput
            value={codeInput}
            onChangeText={handleChangeCode}
            placeholder="ABCD"
            placeholderTextColor={colors.textDim}
            style={styles.input}
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={CODE_LENGTH}
            editable={!isBusy}
            // `default` em vez de teclado numérico: o alfabeto do código tem
            // letras e números misturados.
            keyboardType="default"
            returnKeyType="go"
            onSubmitEditing={handleJoin}
            accessibilityLabel="Código da sala"
          />

          <PixelButton
            label="ENTRAR NA SALA"
            variant="secondary"
            onPress={handleJoin}
            disabled={isBusy || codeInput.length < CODE_LENGTH}
            style={styles.action}
          />

          {isBusy && <ActivityIndicator color={colors.markO} style={styles.busy} />}

          <PixelButton
            label="VOLTAR"
            variant="ghost"
            onPress={handleBack}
            style={styles.action}
          />
        </PixelPanel>
      )}

      {error !== null && (
        <Animated.View entering={FadeIn.duration(160)} exiting={FadeOut.duration(140)}>
          <Pressable onPress={clearError} style={styles.errorBox} accessibilityRole="button">
            <Text style={styles.errorText}>{error}</Text>
            <Text style={styles.errorDismiss}>TOQUE PARA FECHAR</Text>
          </Pressable>
        </Animated.View>
      )}
    </SafeAreaView>
  );
}

/* -------------------------------------------------------------------------- */
/*                                   ESTILOS                                   */
/* -------------------------------------------------------------------------- */

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bgDeep,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
    gap: 16,
  },
  header: {
    alignItems: 'center',
  },
  logo: {
    color: colors.text,
    fontSize: 20,
    fontWeight: '900',
    letterSpacing: 4,
  },
  logoAccent: {
    color: colors.markO,
  },
  panel: {
    width: '100%',
    maxWidth: 360,
  },
  panelContent: {
    padding: 20,
    gap: 14,
  },
  title: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '900',
    letterSpacing: 2,
    textAlign: 'center',
  },
  subtitle: {
    color: colors.textDim,
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 3,
    textAlign: 'center',
  },
  codeBox: {
    borderWidth: 3,
    borderColor: colors.winGlow,
    backgroundColor: colors.bgDeep,
    paddingVertical: 14,
    alignItems: 'center',
  },
  codeText: {
    color: colors.winGlow,
    fontSize: 42,
    fontWeight: '900',
    letterSpacing: 10,
    // Compensa o `letterSpacing`, que o RN aplica também DEPOIS do último
    // caractere — sem isto o código parece deslocado para a esquerda.
    marginLeft: 10,
  },
  waitingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  hint: {
    color: colors.text,
    fontSize: 11,
    lineHeight: 17,
    textAlign: 'center',
    opacity: 0.8,
    flexShrink: 1,
  },
  slotHint: {
    color: colors.textDim,
    fontSize: 9,
    letterSpacing: 1.5,
    textAlign: 'center',
  },
  reconnectCode: {
    color: colors.markX,
    fontWeight: '900',
    letterSpacing: 2,
  },
  input: {
    borderWidth: 2,
    borderColor: colors.boardFrameLight,
    backgroundColor: colors.bgDeep,
    color: colors.text,
    fontSize: 28,
    fontWeight: '900',
    letterSpacing: 8,
    textAlign: 'center',
    paddingVertical: 10,
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  dividerLine: {
    flex: 1,
    height: 2,
    backgroundColor: colors.boardFrameShadow,
  },
  dividerText: {
    color: colors.textDim,
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 2,
  },
  action: {
    alignSelf: 'stretch',
  },
  busy: {
    alignSelf: 'center',
  },
  errorBox: {
    maxWidth: 360,
    borderWidth: 2,
    borderColor: colors.danger,
    backgroundColor: colors.bgPanel,
    paddingHorizontal: 16,
    paddingVertical: 10,
    alignItems: 'center',
  },
  errorText: {
    color: colors.danger,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1,
    textAlign: 'center',
  },
  errorDismiss: {
    marginTop: 4,
    color: colors.textDim,
    fontSize: 7,
    letterSpacing: 2,
  },
});
