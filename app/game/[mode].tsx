import React, { useCallback, useEffect, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import ChaosTerminal from '@/components/game/ChaosTerminal';
import GameHeader from '@/components/game/GameHeader';
import HUD from '@/components/game/HUD';
import MachineHandZone from '@/components/game/MachineHandZone';
import Board from '@/components/game/Board';
import TrapZone from '@/components/game/TrapZone';
import CardHand from '@/components/game/CardHand';
import GameOverOverlay from '@/components/ui/GameOverOverlay';
import PauseModal from '@/components/ui/PauseModal';
import DamageFlashOverlay from '@/components/ui/DamageFlashOverlay';
import AcknowledgementModal from '@/components/ui/AcknowledgementModal';
import ExtraTurnBanner from '@/components/ui/ExtraTurnBanner';
import NoticeToast from '@/components/ui/NoticeToast';
import { useResponsiveLayout } from '@/hooks/useResponsiveLayout';
import { useGameStore } from '@/store/gameStore';
import { useCpuOpponent } from '@/hooks/useCpuOpponent';

export default function GameScreen() {
  const { mode } = useLocalSearchParams();
  const startMatch = useGameStore(state => state.startMatch);
  const setPaused = useGameStore(state => state.setPaused);
  const [pauseVisible, setPauseVisible] = useState(false);

  // Fonte única do dimensionamento: terminal, tabuleiro e mão escalam a partir
  // do MESMO fator. Com cada um inventando sua própria conta, a soma das
  // alturas passava da tela em celulares baixos e a mão (a última da coluna)
  // ficava fora da área visível.
  const { terminalHeight, boardMaxSize } = useResponsiveLayout();

  useEffect(() => {
    startMatch();
  }, [startMatch]);

  // Ativa a IA apenas se a rota acessada for /game/cpu
  useCpuOpponent({ enabled: mode === 'cpu' });

  const openPause = useCallback(() => {
    setPaused(true);
    setPauseVisible(true);
  }, [setPaused]);

  const closePause = useCallback(() => {
    setPaused(false);
    setPauseVisible(false);
  }, [setPaused]);

  return (
    // `edges` sem 'bottom' seria errado justamente aqui: a mão de cartas mora
    // no rodapé e é o primeiro elemento a sumir embaixo da barra de gestos.
    <SafeAreaView style={styles.container} edges={['top', 'bottom', 'left', 'right']}>
      <GameHeader onPause={openPause} />
      <ChaosTerminal height={terminalHeight} />
      <HUD />
      <MachineHandZone />

      {/* Região elástica: fica com TODA a altura que sobrar depois dos
          elementos de tamanho fixo. É o que dá ao `<Board />` um espaço
          vertical real para medir — sem isto ele se dimensionava só pela
          largura e transbordava a tela, empurrando a mão para fora. */}
      <View style={styles.boardArea}>
        <Board maxSize={boardMaxSize} />
      </View>

      <TrapZone owner="MACHINE" />
      <TrapZone owner="PLAYER" />
      <CardHand />

      <DamageFlashOverlay />
      <NoticeToast />
      <ExtraTurnBanner />
      <AcknowledgementModal />
      <GameOverOverlay />
      <PauseModal visible={pauseVisible} onClose={closePause} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000'
  },
  boardArea: {
    flex: 1,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    // Piso deliberadamente baixo: um 3x3 ainda é jogável com ~44dp por casa,
    // e um piso alto empurraria a mão para fora da tela justamente nos
    // aparelhos pequenos que esta mudança existe para atender — o problema
    // original, só que vindo do outro lado.
    minHeight: 140,
    paddingVertical: 4,
  }
});
