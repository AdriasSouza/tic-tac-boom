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
  const { terminalHeight, boardMaxSize, isWide } = useResponsiveLayout();

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

      {/*
        Região elástica: fica com TODA a altura que sobrar depois dos
        elementos de tamanho fixo. É o que dá ao `<Board />` um espaço
        vertical real para medir — sem isto ele se dimensionava só pela
        largura e transbordava a tela, empurrando a mão para fora.

        Em tela larga (`isWide`), esta mesma fileira também carrega as duas
        zonas de armadilha — jogador à esquerda, CPU à direita — em vez de
        empilhá-las abaixo. Empilhado é o correto no celular (onde a largura
        é curta e a altura é o recurso escasso); numa tela larga a largura
        sobra e a altura é que fica preciosa para a mão de cartas, então
        faz sentido inverter qual eixo cada coisa ocupa.
      */}
      <View style={[styles.middleRow, isWide && styles.middleRowWide]}>
        {isWide && <TrapZone owner="PLAYER" orientation="column" />}

        <View style={styles.boardArea}>
          <Board maxSize={boardMaxSize} />
        </View>

        {isWide && <TrapZone owner="MACHINE" orientation="column" />}
      </View>

      {/* Empilhado (mobile): as duas zonas ficam de pé, entre o tabuleiro e a
          mão — mesma ordem e aparência de antes desta mudança. */}
      {!isWide && (
        <>
          <TrapZone owner="MACHINE" />
          <TrapZone owner="PLAYER" />
        </>
      )}

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
    backgroundColor: '#000',
    // `gap` (não margens soltas em cada componente) garante que NENHUM par
    // de vizinhos na coluna consiga se tocar, mesmo em casos-limite da
    // aritmética de flex — é o que faltava entre o tabuleiro e as zonas de
    // armadilha, que estavam encostando uma na outra.
    gap: 6,
  },
  // Fileira central: `boardArea` sozinho no mobile (coluna), ou
  // TrapZone + boardArea + TrapZone lado a lado no desktop largo (linha).
  middleRow: {
    flex: 1,
    width: '100%',
  },
  middleRowWide: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 10,
    paddingHorizontal: 10,
  },
  boardArea: {
    flex: 1,
    // Sem `width:'100%'` explícito: o alinhamento 'stretch' (padrão do RN
    // para filhos sem `alignSelf` própria) já preenche o eixo cruzado tanto
    // em coluna (mobile: estica a LARGURA) quanto em linha (desktop: estica
    // a ALTURA) — um valor fixo quebraria justo o caso da linha.
    alignItems: 'center',
    justifyContent: 'center',
    // Piso deliberadamente baixo: um 3x3 ainda é jogável com ~44dp por casa,
    // e um piso alto empurraria a mão para fora da tela justamente nos
    // aparelhos pequenos que esta mudança existe para atender — o problema
    // original, só que vindo do outro lado.
    minHeight: 140,
  }
});
