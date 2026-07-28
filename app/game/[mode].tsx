import React, { useEffect } from 'react';
import { View, StyleSheet } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import ChaosTerminal from '@/components/game/ChaosTerminal';
import HUD from '@/components/game/HUD';
import Board from '@/components/game/Board';
import TrapZone from '@/components/game/TrapZone';
import CardHand from '@/components/game/CardHand';
import GameOverOverlay from '@/components/ui/GameOverOverlay';
import { useGameStore } from '@/store/gameStore';
import { useCpuOpponent } from '@/hooks/useCpuOpponent';

export default function GameScreen() {
  const { mode } = useLocalSearchParams();
  const startMatch = useGameStore(state => state.startMatch);

  useEffect(() => {
    startMatch();
  }, [startMatch]);

  // Ativa a IA apenas se a rota acessada for /game/cpu
  useCpuOpponent({ enabled: mode === 'cpu' });

  return (
    <View style={styles.container}>
      <ChaosTerminal />
      <HUD />
      <Board />
      <TrapZone />
      <CardHand />
      <GameOverOverlay />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { 
    flex: 1, 
    backgroundColor: '#000' 
  }
});