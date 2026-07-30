import React, { useCallback, useEffect, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import ChaosTerminal from '@/components/game/ChaosTerminal';
import GameHeader from '@/components/game/GameHeader';
import HUD from '@/components/game/HUD';
import OpponentHandZone from '@/components/game/OpponentHandZone';
import Board from '@/components/game/Board';
import TrapZone from '@/components/game/TrapZone';
import CardHand from '@/components/game/CardHand';
import GameOverOverlay from '@/components/ui/GameOverOverlay';
import PauseModal from '@/components/ui/PauseModal';
import DamageFlashOverlay from '@/components/ui/DamageFlashOverlay';
import AcknowledgementModal from '@/components/ui/AcknowledgementModal';
import ExtraTurnBanner from '@/components/ui/ExtraTurnBanner';
import NoticeToast from '@/components/ui/NoticeToast';
import OpponentLeftModal from '@/components/ui/OpponentLeftModal';
import { useMatchPerspective } from '@/hooks/useMatchPerspective';
import { useResponsiveLayout } from '@/hooks/useResponsiveLayout';
import { useGameStore } from '@/store/gameStore';
import { useCpuOpponent } from '@/hooks/useCpuOpponent';
import { useMultiplayerSync } from '@/hooks/useMultiplayerSync';

export default function GameScreen() {
  // `seed` só chega no modo online, vinda da sala do Firebase. Nos modos
  // locais é `undefined` e o `startMatch` sorteia a sua.
  const { mode, seed } = useLocalSearchParams<{ mode: string; seed?: string }>();
  const startMatch = useGameStore(state => state.startMatch);
  const setPaused = useGameStore(state => state.setPaused);
  const [pauseVisible, setPauseVisible] = useState(false);

  // Fonte única do dimensionamento: terminal, tabuleiro e mão escalam a partir
  // do MESMO fator. Com cada um inventando sua própria conta, a soma das
  // alturas passava da tela em celulares baixos e a mão (a última da coluna)
  // ficava fora da área visível.
  const { terminalHeight, boardMaxSize, isWide } = useResponsiveLayout();

  // Quem é "eu" e quem é "ele" nesta tela. Nos modos offline resolve para
  // PLAYER/MACHINE, que é o comportamento de sempre.
  const { localCombatant, remoteCombatant } = useMatchPerspective();

  /**
   * Semeia a partida.
   *
   * No modo online os DOIS clientes recebem a mesma seed da sala e a repassam
   * aqui — é o que faz as mãos iniciais e todos os sorteios coincidirem nos
   * dois aparelhos, requisito do plano de sincronizar apenas os inputs (ver
   * `src/types/multiplayer.ts`). Uma seed inválida vira `undefined`, e a
   * partida sorteia a própria: melhor um jogo local coerente do que dois
   * clientes divergindo em silêncio a partir de um parâmetro corrompido.
   */
  useEffect(() => {
    const parsed = Number.parseInt(seed ?? '', 10);
    // `isOnline` diz ao motor que o combatente `MACHINE` é uma PESSOA, não a
    // IA — é o que faz as cartas de informação abrirem o modal para os dois
    // lados em vez de pular a leitura achando que o outro lado é um robô.
    startMatch(Number.isFinite(parsed) ? parsed : undefined, mode === 'online');
  }, [startMatch, seed, mode]);

  // Ativa a IA apenas se a rota acessada for /game/cpu. O hook também se
  // inibe sozinho durante uma partida online (ver `useCpuOpponent`).
  useCpuOpponent({ enabled: mode === 'cpu' });

  // Cordão umbilical com a rede: consome o log de ações da sala e aplica no
  // motor as jogadas do oponente. Inerte fora do modo online.
  useMultiplayerSync();

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
    //
    // Esta é a ÚNICA fonte de padding para a barra de status/notch em toda a
    // tela — nem `GameHeader`, nem nenhum componente abaixo, deve somar um
    // `paddingTop`/`marginTop` próprio para "compensar" a área segura. Fazer
    // isso duas vezes é o clássico bug do espaço preto gigante no topo: a
    // SafeAreaView já reserva o inset real do aparelho; qualquer padding
    // manual adicional dobra essa reserva.
    <SafeAreaView style={styles.container} edges={['top', 'bottom', 'left', 'right']}>
      <GameHeader onPause={openPause} />
      <ChaosTerminal height={terminalHeight} />
      <HUD />
      <OpponentHandZone />

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
        {isWide && <TrapZone owner={localCombatant} orientation="column" />}

        <View style={styles.boardArea}>
          <Board maxSize={boardMaxSize} />
        </View>

        {isWide && <TrapZone owner={remoteCombatant} orientation="column" />}
      </View>

      {/* Empilhado (mobile): as duas zonas ficam de pé, entre o tabuleiro e a
          mão — a do oponente em cima, a sua embaixo (mais perto da sua mão).
          Os combatentes vêm da perspectiva, não de literais: numa sala online
          o jogador local pode ser o `MACHINE`. */}
      {!isWide && (
        <>
          <TrapZone owner={remoteCombatant} />
          <TrapZone owner={localCombatant} />
        </>
      )}

      <CardHand />

      <DamageFlashOverlay />
      <NoticeToast />
      <ExtraTurnBanner />
      <AcknowledgementModal />
      {/* Acima do fim de jogo: se a sala caiu, o resultado da partida não
          importa mais — o que o jogador precisa é de uma saída. */}
      <OpponentLeftModal />
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
