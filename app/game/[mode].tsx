import React, { useCallback, useEffect, useState } from 'react';
import { View, StyleSheet } from 'react-native';
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
import { useGameStore } from '@/store/gameStore';
import { useCpuOpponent } from '@/hooks/useCpuOpponent';

export default function GameScreen() {
  const { mode } = useLocalSearchParams();
  const startMatch = useGameStore(state => state.startMatch);
  const setPaused = useGameStore(state => state.setPaused);
  const [pauseVisible, setPauseVisible] = useState(false);

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
    <View style={styles.container}>
      <GameHeader onPause={openPause} />
      <ChaosTerminal />
      <HUD />
      <MachineHandZone />
      <Board />
      <TrapZone owner="PLAYER" />
      <TrapZone owner="MACHINE" />
      <CardHand />
      <DamageFlashOverlay />
      <AcknowledgementModal />
      <GameOverOverlay />
      <PauseModal visible={pauseVisible} onClose={closePause} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000'
  }
});