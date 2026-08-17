import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import Animated, { withRepeat, withTiming, withSequence, useSharedValue, useAnimatedStyle } from 'react-native-reanimated';
import PixelButton from '@/components/ui/PixelButton';
import HowToPlayModal from '@/components/ui/HowToPlayModal';
import CreditsModal from '@/components/ui/CreditsModal';
import { clearMatchSnapshot, loadMatchSnapshot, type MatchSnapshot, type PersistableMode } from '@/store/matchPersistence';

export default function TitleScreen() {
  const router = useRouter();
  const [modalVisible, setModalVisible] = useState(false);
  const [creditsVisible, setCreditsVisible] = useState(false);

  /**
   * Existe uma partida local/CPU salva para retomar? (ver
   * `src/store/matchPersistence.ts` — investigação de "rotação reinicia o
   * jogo"). `useFocusEffect`, não `useEffect` de montagem: precisa reavaliar
   * toda vez que o jogador volta pro menu (ex.: saiu pela Pausa), não só no
   * cold start — e cobre o caso do Router NÃO reentregar a última rota depois
   * de um relançamento real do app, oferecendo a retomada aqui também.
   */
  const [resumable, setResumable] = useState<MatchSnapshot | null>(null);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      void loadMatchSnapshot().then((snapshot) => {
        if (!cancelled) setResumable(snapshot);
      });
      return () => {
        cancelled = true;
      };
    }, []),
  );

  /**
   * Começar uma partida nova pelo menu é o único momento em que a intenção do
   * jogador é inequívoca — por isso é AQUI, não na tela do jogo, que o
   * snapshot antigo é descartado. Sem isto, "rota reentregue depois de um
   * remount" e "jogador pediu partida nova" ficariam indistinguíveis do lado
   * de lá (nem uma query string resolveria: no web um reload preserva a URL
   * inteira, query incluída).
   */
  const handleFreshStart = useCallback(
    async (mode: PersistableMode) => {
      await clearMatchSnapshot();
      router.push({ pathname: '/game/[mode]', params: { mode } });
    },
    [router],
  );

  const handleResume = useCallback(() => {
    if (!resumable) return;
    router.push({ pathname: '/game/[mode]', params: { mode: resumable.mode } });
  }, [resumable, router]);

  const scale = useSharedValue(1);

  useEffect(() => {
    scale.value = withRepeat(
      withSequence(
        withTiming(1.08, { duration: 900 }), 
        withTiming(1, { duration: 900 })
      ),
      -1,
      true
    );
  }, []);

  const animatedTitle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }]
  }));

  return (
    <View style={styles.container}>
      <Animated.View style={[styles.titleContainer, animatedTitle]}>
        <Text style={styles.titleText}>TIC TAC</Text>
        <Text style={styles.boomText}>BOOM</Text>
      </Animated.View>

    <View style={styles.menu}>
      {resumable && (
        <PixelButton
          label="Continuar Partida"
          variant="secondary"
          onPress={handleResume}
        />
      )}
      <PixelButton
        label="Jogar vs CPU"
        onPress={() => void handleFreshStart('cpu')}
      />
      <PixelButton
        label="Modo Clássico"
        variant="secondary"
        onPress={() => void handleFreshStart('classic')}
      />
      <PixelButton
        label="Jogar Online"
        variant="secondary"
        onPress={() => router.push('/lobby')}
      />
      <PixelButton
        label="Como Jogar"
        onPress={() => setModalVisible(true)}
      />
      <PixelButton
        label="Créditos"
        variant="ghost"
        onPress={() => setCreditsVisible(true)}
      />
    </View>

      {modalVisible && (
        <HowToPlayModal visible={modalVisible} onClose={() => setModalVisible(false)} />
      )}
      {creditsVisible && (
        <CreditsModal visible={creditsVisible} onClose={() => setCreditsVisible(false)} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#111', alignItems: 'center', justifyContent: 'center' },
  titleContainer: { marginBottom: 80, alignItems: 'center' },
  titleText: { fontSize: 44, color: '#FFF', fontWeight: 'bold', letterSpacing: 2 },
  boomText: { fontSize: 68, color: '#FF3366', fontWeight: '900', marginTop: -15, letterSpacing: 4 },
  menu: { gap: 20 }
});