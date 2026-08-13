import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown, FadeOutUp } from 'react-native-reanimated';

import { PixelButton } from './PixelButton';
import { manualResync, retryOutboxNow } from '@/services/syncBridge';
import { useIsLocalTurn, useIsOpponentConnected } from '@/hooks/useLocalTurn';
import {
  selectMultiplayerStatus,
  selectOutboxStatus,
  useMultiplayerStore,
} from '@/store/multiplayerStore';
import { selectPendingAcknowledgement, selectStatus, useGameStore } from '@/store/gameStore';
import { colors } from '@/theme/colors';

/**
 * Depois de quanto tempo sem conseguir agir o jogador local vê o nudge de
 * "sincronizar" — curto o bastante para não deixar alguém realmente travado
 * esperando minutos, longo o bastante para não piscar em toda demora normal
 * (oponente pensando, animação do giro de TIC TAC BOOM, etc).
 */
const STALE_WAIT_MS = 20_000;

/**
 * Cobre o buraco investigado no travamento "esperando a jogada um do outro"
 * (ver `syncBridge.ts` — `broadcast`/`manualResync`): duas situações
 * distintas, mesma peça de UI, nunca as duas ao mesmo tempo.
 *
 * 1. **Minha última jogada não confirmou** (`outboxStatus` em
 *    `multiplayerStore`, escrito pela fila de retry de `syncBridge.ts`) —
 *    aviso curto durante `'retrying'`, com botão TENTAR AGORA quando vira
 *    `'stalled'` (várias tentativas seguidas).
 * 2. **Estou esperando o oponente há tempo suspeito**, ele aparece
 *    conectado, e minha própria fila está limpa (se não estivesse, o caso 1
 *    já explicaria a espera) — nudge com botão SINCRONIZAR, que busca o log
 *    direto do servidor e reconstrói o estado local (`manualResync`).
 *
 * Fora do modo online os dois seletores relevantes ficam inertes
 * (`outboxStatus` sempre `'idle'`, `multiplayerStatus` nunca `MATCH_STARTED`)
 * — o componente não renderiza nada.
 */
export function ConnectionSyncBanner() {
  const multiplayerStatus = useMultiplayerStore(selectMultiplayerStatus);
  const outboxStatus = useMultiplayerStore(selectOutboxStatus);
  const matchStatus = useGameStore(selectStatus);
  const pendingAcknowledgement = useGameStore(selectPendingAcknowledgement);
  const isLocalTurn = useIsLocalTurn();
  const isOpponentConnected = useIsOpponentConnected();

  const isOnline = multiplayerStatus === 'MATCH_STARTED';

  // "Travado esperando": não é minha vez (ou há uma confirmação pendente que
  // não é minha), o oponente aparece conectado, e não é já explicado pela
  // minha própria fila de envio falhando (`outboxStatus`, caso 1 acima).
  const waitingOnPeer =
    isOnline &&
    matchStatus === 'PLAYING' &&
    outboxStatus === 'idle' &&
    isOpponentConnected &&
    (!isLocalTurn || pendingAcknowledgement !== null);

  const [staleWait, setStaleWait] = useState(false);
  useEffect(() => {
    if (!waitingOnPeer) {
      setStaleWait(false);
      return;
    }
    const timer = setTimeout(() => setStaleWait(true), STALE_WAIT_MS);
    return () => clearTimeout(timer);
  }, [waitingOnPeer]);

  const [resyncing, setResyncing] = useState(false);
  const handleResync = useCallback(() => {
    setResyncing(true);
    void manualResync().finally(() => setResyncing(false));
  }, []);

  if (!isOnline) return null;

  let text: string;
  let action: { label: string; onPress: () => void; disabled?: boolean } | null = null;

  if (outboxStatus === 'retrying') {
    text = 'REENVIANDO SUA JOGADA...';
  } else if (outboxStatus === 'stalled') {
    text = 'NÃO CONSEGUIMOS ENVIAR SUA JOGADA';
    action = { label: 'TENTAR AGORA', onPress: retryOutboxNow };
  } else if (staleWait) {
    text = 'PARECE QUE ESTÁ DEMORANDO';
    action = { label: resyncing ? 'SINCRONIZANDO...' : 'SINCRONIZAR', onPress: handleResync, disabled: resyncing };
  } else {
    return null;
  }

  return (
    <View style={styles.layer} pointerEvents="box-none">
      <Animated.View
        entering={FadeInDown.springify().damping(16).mass(0.7)}
        exiting={FadeOutUp.duration(220)}
        style={styles.banner}
      >
        <View style={styles.bevel} />
        <Text style={styles.text} numberOfLines={2}>
          {text}
        </Text>
        {action && (
          <PixelButton
            label={action.label}
            onPress={action.onPress}
            disabled={action.disabled}
            accent={colors.winGlow}
            style={styles.action}
          />
        )}
      </Animated.View>
    </View>
  );
}

export default ConnectionSyncBanner;

const styles = StyleSheet.create({
  layer: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingTop: '14%',
    paddingHorizontal: 24,
  },
  banner: {
    maxWidth: 320,
    backgroundColor: colors.bgDeep,
    borderWidth: 2,
    borderColor: colors.winGlow,
    paddingHorizontal: 16,
    paddingVertical: 12,
    alignItems: 'center',
    gap: 10,
    overflow: 'hidden',
  },
  bevel: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 3,
    backgroundColor: colors.winGlow,
  },
  text: {
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1.5,
    textAlign: 'center',
    color: colors.winGlow,
  },
  action: {
    alignSelf: 'stretch',
  },
});
