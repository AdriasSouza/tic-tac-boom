import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, Text, View, StyleSheet, type LayoutChangeEvent } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { restoreRng } from '@/engine/rng';
import { useMatchAutosave } from '@/hooks/useMatchAutosave';
import { loadMatchSnapshot } from '@/store/matchPersistence';
import { isOnlineMatch } from '@/services/syncBridge';
import { selectError, useMultiplayerStore } from '@/store/multiplayerStore';
import { colors } from '@/theme/colors';
import ChaosTerminal from '@/components/game/ChaosTerminal';
import GameHeader from '@/components/game/GameHeader';
import HUD from '@/components/game/HUD';
import Board, { type BoardResolvedSize } from '@/components/game/Board';
import TrapZone from '@/components/game/TrapZone';
import CardHand from '@/components/game/CardHand';
import GameOverOverlay from '@/components/ui/GameOverOverlay';
import PauseModal from '@/components/ui/PauseModal';
import DamageFlashOverlay from '@/components/ui/DamageFlashOverlay';
import AcknowledgementModal from '@/components/ui/AcknowledgementModal';
import AltarModal from '@/components/ui/AltarModal';
import InteractionModal from '@/components/ui/InteractionModal';
import CardsReceivedToast from '@/components/ui/CardsReceivedToast';
import ExtraTurnBanner from '@/components/ui/ExtraTurnBanner';
import ChaosRouletteBanner from '@/components/ui/ChaosRouletteBanner';
import NoticeToast from '@/components/ui/NoticeToast';
import TimeCapsuleBanner from '@/components/ui/TimeCapsuleBanner';
import ParadoxEchoOverlay from '@/components/ui/ParadoxEchoOverlay';
import OpponentDisconnectedModal from '@/components/ui/OpponentDisconnectedModal';
import OpponentLeftModal from '@/components/ui/OpponentLeftModal';
import ConnectionSyncBanner from '@/components/ui/ConnectionSyncBanner';
import { useMatchPerspective } from '@/hooks/useMatchPerspective';
import { useLayoutMode, type LayoutMode } from '@/hooks/useLayoutMode';
import { GAME_MAX_WIDTH, useResponsiveLayout } from '@/hooks/useResponsiveLayout';
import { BOARD_BOUNDS, MIN_PLAYABLE_BOARD, TRAP_ZONE_BOUNDS } from '@/theme/layout';
import { useGameStore } from '@/store/gameStore';
import { useCpuOpponent } from '@/hooks/useCpuOpponent';
import { useMultiplayerSync } from '@/hooks/useMultiplayerSync';

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export default function GameScreen() {
  // `seed` só chega no modo online, vinda da sala do Firebase. Nos modos
  // locais é `undefined` e o `startMatch` sorteia a sua.
  const { mode, seed } = useLocalSearchParams<{ mode: string; seed?: string }>();
  const router = useRouter();
  const startMatch = useGameStore(state => state.startMatch);
  const resumeMatch = useGameStore(state => state.resumeMatch);
  const setPaused = useGameStore(state => state.setPaused);
  const [pauseVisible, setPauseVisible] = useState(false);

  // Erro do listener de rede (`multiplayerStore`, escrito quando `onValue`
  // falha em `listenToRoom`) — antes ficava só no store, invisível: nenhuma
  // tela de partida lia `selectError`. Mudo pra sempre é o pior tipo de
  // falha aqui, então mostrar isto (mesmo padrão dispensável por toque de
  // `app/lobby.tsx`) fecha essa lacuna.
  const multiplayerError = useMultiplayerStore(selectError);
  const clearMultiplayerError = useMultiplayerStore((s) => s.clearError);

  // Fonte única do dimensionamento: terminal, tabuleiro e mão escalam a partir
  // do MESMO fator. Com cada um inventando sua própria conta, a soma das
  // alturas passava da tela em celulares baixos e a mão (a última da coluna)
  // ficava fora da área visível.
  const { terminalHeight, terminalCollapsed } = useResponsiveLayout();
  const { mode: layoutMode } = useLayoutMode();

  /**
   * A2.1 — aproxima as sidebars do tabuleiro sem arriscar encolhê-lo.
   *
   * `rowWidth` vem de `onLayout` em `combatRow`, NUNCA em `boardArea`. Isto é
   * o que evita um segundo laço de realimentação, distinto do que o clamp de
   * `insetPerSide` já previne: `boardArea` é `flex:1` e o SEU tamanho MUDA
   * quando a margem é aplicada nas sidebars — medir ali faria o cálculo se
   * realimentar da própria saída (mede 824 → aplica 155 → boardArea encolhe
   * para 514 → recalcula com 514 → dá inset 0 → volta a 824 → ...), oscilando
   * para sempre, mesmo com `boardSize` protegido. `combatRow`, ao contrário,
   * tem a largura ditada pelo WRAPPER (um ancestral, imune ao que os próprios
   * filhos fazem) — é um valor estável, e o inset calculado a partir dele é
   * um ponto fixo: aplicado uma vez, nunca precisa mudar de novo sozinho.
   */
  const [rowWidth, setRowWidth] = useState(0);
  const handleCombatRowLayout = useCallback((event: LayoutChangeEvent) => {
    const { width } = event.nativeEvent.layout;
    setRowWidth((prev) => (Math.abs(prev - width) < 1 ? prev : width));
  }, []);

  /**
   * Resultado que o `<Board />` reportou de si mesmo — nunca um valor que
   * `[mode].tsx` impõe a ele. Guarda por VALOR (não por identidade do objeto
   * recebido) é o que impede o loop de render: o `<Board />` reporta de novo
   * a cada remedição (inclusive quando o inset aplicado abaixo faz sua caixa
   * encolher sem mudar o resultado), e sem este `prev?.boardSize===...`
   * `setState` aceitaria um objeto novo com os MESMOS números e disparíamos
   * um re-render — que remede o board — que reporta de novo — infinito.
   */
  const [resolvedBoard, setResolvedBoard] = useState<BoardResolvedSize | null>(null);
  const handleBoardResolvedSize = useCallback((next: BoardResolvedSize | null) => {
    setResolvedBoard((prev) =>
      prev?.boardSize === next?.boardSize && prev?.cellSize === next?.cellSize ? prev : next,
    );
  }, []);

  /**
   * `insetPerSide` — quanto empurrar cada sidebar em direção ao tabuleiro.
   *
   * `natural` reconstrói ARITMETICAMENTE a largura que `boardArea` teria SEM
   * nenhum inset (a mesma coisa que o `<Board />` mediria) a partir de
   * `rowWidth` (estável, ver acima) menos as duas sidebars e os dois gaps —
   * nunca medida diretamente na própria `boardArea`, pelo motivo já explicado.
   *
   * O teto (`ceiling`) é a garantia de que `boardSize` nunca encolhe: ele
   * força `natural - 2·insetPerSide ≥ boardSize + GUTTER`, e como o `<Board
   * />` usa exatamente `hardCeiling - GUTTER` como alvo antes de aplicar seu
   * próprio teto (`MAX_BOARD`), manter a largura disponível acima desse piso
   * mantém `min(availableW, availableH)` cravado em `availableH` (quando a
   * altura já era quem mandava) — o board recebe uma caixa mais estreita,
   * mas nunca estreita o bastante para IMPORTAR.
   *
   * A prova de que em `compact` isto tende a zero tem uma precondição: vale
   * quando a LARGURA já governa o board E `MAX_BOARD` não morde — o regime de
   * todo dispositivo `compact` medido até agora. Fora dessa precondição (ex:
   * uma janela `compact` incomum onde `boardSize` bate no teto de `MAX_BOARD`
   * antes da largura apertar), `ceiling` pode ser positivo e o inset também
   * — o que é o comportamento CORRETO, não um bug. Por isso `HUG_GAP.compact`
   * não é 0: é um valor real (12), só que inerte no regime comum.
   *
   * **Segunda precondição, descoberta depois de medir 926×428**: a fórmula
   * acima é sólida matematicamente (nunca encolhe o board), mas ela não sabe
   * dizer se apertar a largura FAZ SENTIDO — só se é SEGURO. Em 926×428,
   * `min(availableW,availableH)=availableH` também governa (exatamente como
   * em 1440×900!), então "altura governa" sozinho NÃO discrimina os dois
   * casos — uma guarda por eixo teria zerado o inset do 1440×900 também,
   * quebrando o critério de aceitação. O que de fato distingue os dois é o
   * TAMANHO do resultado: em 1440×900 o board (466) já é grande, e o hug
   * elimina um excesso real de largura ao redor dele; em 926×428 o board
   * (136) já está ABAIXO de `MIN_PLAYABLE_BOARD` — a mesma linha que faz
   * `<Board />` emitir o `console.warn` de A1 — uma categoria de limitação
   * conhecida (ver README) que pede correção estrutural (altura de HUD/mão),
   * não cosmética. Apertar a largura de um layout que já falhou na altura só
   * desloca a quebra para outro eixo, sem ganho nenhum — daí a guarda:
   * NUNCA aplicar o hug abaixo do piso jogável.
   */
  const insetPerSide = useMemo(() => {
    if (!resolvedBoard || rowWidth <= 0) return 0;
    if (resolvedBoard.boardSize < MIN_PLAYABLE_BOARD) return 0;

    const { sidebarWidth } = TRAP_ZONE_BOUNDS[layoutMode];
    const { GUTTER } = BOARD_BOUNDS[layoutMode];
    const gap = COMBAT_GAP[layoutMode];
    const natural = rowWidth - 2 * sidebarWidth - 2 * gap;

    const target = Math.floor((natural - resolvedBoard.boardSize) / 2) - HUG_GAP[layoutMode];
    const ceiling = Math.floor((natural - (resolvedBoard.boardSize + GUTTER)) / 2);

    return clamp(target, 0, ceiling);
  }, [resolvedBoard, rowWidth, layoutMode]);

  // Quem é "eu" e quem é "ele" nesta tela. Nos modos offline resolve para
  // PLAYER/MACHINE, que é o comportamento de sempre.
  const { localCombatant, remoteCombatant } = useMatchPerspective();

  /**
   * Inicia, retoma, ou desiste desta tela — três casos, um efeito só.
   *
   * **Online**: exige uma sessão multiplayer de verdade (`isOnlineMatch()`)
   * antes de rodar `startMatch`. Sem isto, se esta rota for reentregue sem
   * uma sala por trás (relançamento do app, recarregar a URL no web —
   * `useMultiplayerStore` volta pro estado padrão a cada carga nova), a tela
   * rodava a partida "isolada": `isOnline:true` fica marcado no motor, mas
   * não existe CPU nem rede para jogar por `MACHINE`, e nenhum modal de erro
   * aparece (`OpponentDisconnectedModal`/`OpponentLeftModal` ficam mudos fora
   * de `MATCH_STARTED`) — era exatamente o "caiu direto na partida bugada em
   * vez de voltar pra tela de conexão" relatado. A correção é voltar pro
   * lobby, não tentar rodar a partida.
   *
   * **Local/CPU**: tenta retomar um snapshot salvo (`matchPersistence.ts`)
   * antes de começar uma partida nova — é isto que sobrevive a um remount
   * (rotação sem a trava de orientação realmente aplicada no build instalado)
   * ou a um relançamento real do app. `restoreRng` roda ANTES de
   * `resumeMatch`: os canais de RNG são estado de módulo fora do React (ver
   * `src/engine/rng.ts`), e `useCpuOpponent` pode consumi-los assim que o
   * novo estado renderizar. Decidir "começar do zero" é responsabilidade de
   * quem NAVEGA para cá (`app/index.tsx` já limpa o snapshot antes de
   * navegar quando o jogador escolhe uma partida nova) — esta tela só olha
   * "existe algo salvo para ESTE `mode`?".
   */
  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      if (mode === 'online') {
        if (!isOnlineMatch()) {
          router.replace('/lobby');
          return;
        }
        const parsed = Number.parseInt(seed ?? '', 10);
        // `isOnline` diz ao motor que o combatente `MACHINE` é uma PESSOA,
        // não a IA — é o que faz as cartas de informação abrirem o modal
        // para os dois lados em vez de pular a leitura achando que o outro
        // lado é um robô.
        startMatch(Number.isFinite(parsed) ? parsed : undefined, true);
        return;
      }

      const snapshot = await loadMatchSnapshot();
      if (cancelled) return;

      if (snapshot && snapshot.mode === mode) {
        restoreRng(snapshot.rng);
        resumeMatch(snapshot.gameState);
      } else {
        startMatch(undefined, false);
      }
    }

    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, [startMatch, resumeMatch, seed, mode, router]);

  // Salva local/CPU automaticamente enquanto a partida está em andamento —
  // inerte no online (ver `useMatchAutosave`).
  useMatchAutosave(mode);

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
      {/* GAME WRAPPER — o jogo em si, travado em `GAME_MAX_WIDTH` e
          centralizado pelo `alignItems:'center'` da raiz. Os overlays ficam
          DE FORA dele, como irmãos: um flash de dano ou o fim de partida
          precisam cobrir a tela inteira, não só a coluna do jogo. */}
      <View style={styles.wrapper}>
        <GameHeader onPause={openPause} />
        <ChaosTerminal height={terminalHeight} collapsed={terminalCollapsed} />

        {/* ── LINHA 1 · BARRA DE STATUS ──────────────────────────────────────
            [ HP · mão (você) ]   [ TURNO ]   [ mão · HP (rival) ]
            Altura ditada pelo conteúdo; a largura é a do wrapper, então no
            desktop os dois lados param de se afastar em 1024. Ver `<HUD />`. */}
        <HUD />

        {/* ── LINHA 2 · ÁREA DE COMBATE ──────────────────────────────────────
            A única linha elástica: fica com a altura que sobrar das outras
            duas. SEMPRE uma fileira, em QUALQUER orientação — retrato
            incluso — porque a `<TrapZone />` também é sempre um sidebar
            agora (ver o componente): [armadilhas suas] [TABULEIRO] [armadilhas
            do rival]. Não existe mais um segundo arranjo empilhado para
            retrato; era exatamente esse empilhamento (armadilha compartilhando
            o eixo VERTICAL com o board) que roubava altura do board no caso
            mais comum do jogo. A ordem segue a leitura da mesa: o rival do
            lado de lá, você do lado de cá.

            `boardArea` é só `flex:1` + `alignSelf:'stretch'` — SEM
            `aspectRatio`, `maxWidth` ou `maxHeight` (ver invariante em
            AGENTS.md). O `<Board />` mede as duas dimensões que sobrarem e
            resolve o quadrado sozinho; este container só entrega espaço
            bruto.

            As duas `<TrapZone />` recebem `marginLeft`/`marginRight` =
            `insetPerSide` (A2.1) — aproxima a sidebar do tabuleiro comendo a
            folga que sobra dentro de `boardArea`, nunca o próprio board (ver
            o cálculo de `insetPerSide`, acima). */}
        <View style={[styles.combatRow, { gap: COMBAT_GAP[layoutMode] }]} onLayout={handleCombatRowLayout}>
          <TrapZone owner={localCombatant} style={{ marginLeft: insetPerSide }} />

          <View style={styles.boardArea}>
            <Board onResolvedSize={handleBoardResolvedSize} />
          </View>

          <TrapZone owner={remoteCombatant} style={{ marginRight: insetPerSide }} />
        </View>

        {/* ── LINHA 3 · MÃO INTERATIVA ───────────────────────────────────────
            As cartas de verdade, em leque. Ver `<CardHand />`/`<CardItem />`. */}
        <CardHand />
      </View>

      {multiplayerError !== null && (
        <Animated.View
          entering={FadeIn.duration(160)}
          exiting={FadeOut.duration(140)}
          style={styles.errorLayer}
          pointerEvents="box-none"
        >
          <Pressable
            onPress={clearMultiplayerError}
            style={styles.errorBox}
            accessibilityRole="button"
          >
            <Text style={styles.errorText}>{multiplayerError}</Text>
            <Text style={styles.errorDismiss}>TOQUE PARA FECHAR</Text>
          </Pressable>
        </Animated.View>
      )}

      <DamageFlashOverlay />
      <ParadoxEchoOverlay />
      <NoticeToast />
      <CardsReceivedToast target="PLAYER" />
      <CardsReceivedToast target="MACHINE" />
      <ConnectionSyncBanner />
      <ExtraTurnBanner />
      <TimeCapsuleBanner />
      <ChaosRouletteBanner />
      <AcknowledgementModal />
      {/* Abre sozinho ao ler `lastAltarPrompt` do store — só para quem jogou
          a carta (`caster === localCombatant`, checado dentro do próprio
          componente). Nenhuma prop precisa descer até aqui. */}
      <AltarModal />
      {/* Cobre os 3 `kind`s de `pendingInteraction` que precisam de grade
          tocável (PICK_ONE_FROM_HAND/PICK_MANY_FROM_HAND/PICK_ONE_REVEALED).
          BOARD_TARGET usa a UI de mira do próprio tabuleiro; SACRIFICE_DRAG
          continua no `AltarModal` acima até a Fase 6. */}
      <InteractionModal />
      {/* Acima do fim de jogo: se a sala caiu, o resultado da partida não
          importa mais — o que o jogador precisa é de uma saída. */}
      <OpponentLeftModal />
      {/* Queda TEMPORÁRIA — distinta de `OpponentLeftModal` (sala encerrada
          para sempre). Esconde sozinho se `matchStatus` virar MATCH_OVER
          (inclusive por um W.O. declarado a partir DELE), então não precisa
          de ordem especial em relação ao `<GameOverOverlay />` abaixo. */}
      <OpponentDisconnectedModal />
      <GameOverOverlay />
      <PauseModal visible={pauseVisible} onClose={closePause} />
    </SafeAreaView>
  );
}

/**
 * Espaçamento entre as 3 colunas da linha de combate, por `LayoutMode` — mais
 * folga onde a largura sobra (wide), mais econômico onde não sobra (compact).
 * Não afeta o cálculo do board: é só respiro visual entre ele e as sidebars.
 */
const COMBAT_GAP: Record<LayoutMode, number> = {
  compact: 12,
  regular: 20,
  wide: 28,
};

/**
 * Respiro final desejado entre a sidebar e a moldura do tabuleiro, depois do
 * inset aplicado (ver o cálculo de `insetPerSide`, acima). `compact` usa um
 * valor real (12), não 0 — ele só fica INERTE no regime comum de celular
 * (largura já governando o board, `MAX_BOARD` sem morder), onde o teto de
 * segurança do inset já força o resultado a 0 de qualquer forma. Fora desse
 * regime, é este valor que de fato conta.
 */
const HUG_GAP: Record<LayoutMode, number> = {
  compact: 12,
  regular: 16,
  wide: 24,
};

/**
 * A tela tem duas camadas: a raiz (tela cheia, fundo preto) e o **game
 * wrapper** — o jogo propriamente dito, travado em `GAME_MAX_WIDTH` e
 * centralizado. Tudo que é interface de jogo vive no wrapper; os overlays de
 * tela cheia ficam na raiz.
 *
 * Dentro do wrapper, três linhas:
 *
 * ```
 * ┌──────────────── raiz (tela cheia, centraliza) ────────────────┐
 * │        ┌──────── wrapper (≤ 1024dp) ────────┐                 │
 * │        │ header · terminal                  │                 │
 * │        │ 1 · [HP+mão]  [TURNO]  [mão+HP]    │ altura própria  │
 * │        │ 2 · [armadilhas][ TABULEIRO ][armadilhas] │ flex:1   │
 * │        │ 3 · leque de cartas                │ altura própria  │
 * │        └────────────────────────────────────┘                 │
 * └───────────────────────────────────────────────────────────────┘
 * ```
 *
 * Duas regras sustentam o conjunto:
 *
 * 1. **Exatamente uma linha é elástica.** As linhas 1 e 3 pedem a altura de
 *    que precisam e não cedem; a linha 2 fica com o resto e o `<Board />` lá
 *    dentro encolhe até caber. Com mais de uma (ou nenhuma), o excesso vaza
 *    para fora e vira sobreposição.
 * 2. **A linha 2 é SEMPRE uma fileira, em qualquer orientação.** As
 *    armadilhas são sidebars de largura fixa (ver `<TrapZone />`) — nunca
 *    mais irmãs de flex do board no eixo vertical, o eixo que é escasso
 *    justamente na orientação mais comum do jogo (retrato). O board é o
 *    único `flex:1` da linha; as sidebars têm largura própria e não cedem.
 */
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
    // Centraliza o wrapper quando a tela é mais larga que `GAME_MAX_WIDTH`.
    alignItems: 'center',
  },
  wrapper: {
    flex: 1,
    width: '100%',
    maxWidth: GAME_MAX_WIDTH,
    // `space-between` distribui a sobra entre as linhas — na prática a linha 2
    // (`flex:1`) já absorve tudo, então isto só age como rede de segurança
    // caso alguma linha deixe de ser elástica: mesmo aí, HUD fica ancorado no
    // topo e a mão no rodapé, em vez de tudo se amontoar em cima.
    justifyContent: 'space-between',
    // `gap` (não margens soltas em cada componente) garante que NENHUM par de
    // vizinhos na coluna consiga se tocar, mesmo em casos-limite do flex.
    gap: 6,
  },

  /**
   * Linha 2 · área de combate. `alignItems:'stretch'` (não mais `'center'`)
   * entrega a ALTURA cheia da linha tanto para as `<TrapZone />` (que
   * centralizam os próprios slots, bem mais curtos, dentro dela) quanto para
   * `boardArea` — sem isso `boardArea` receberia só a altura do próprio
   * conteúdo, e `Math.min(availableW, availableH)` do `<Board />` mediria a
   * caixa errada.
   */
  combatRow: {
    flex: 1,
    width: '100%',
    flexDirection: 'row',
    alignItems: 'stretch',
    justifyContent: 'center',
    // gap chega inline, de COMBAT_GAP[layoutMode].
  },

  /**
   * O único `flex:1` da linha — cresce para ocupar toda a largura que as duas
   * sidebars (largura própria, não-flex) não usaram. Combinado com
   * `alignItems:'stretch'` do pai, recebe a altura cheia da linha também: as
   * DUAS dimensões vêm de espaço real medido, nunca de `aspectRatio` — ver a
   * invariante em AGENTS.md (a mesma classe de bug já apareceu duas vezes:
   * primeiro um `maxWidth`/`maxHeight` externo, depois um `aspectRatio` num
   * container `row`; os dois pré-quadravam a caixa e o `<Board />`
   * quadrava de novo por cima, chegando a medir metade da largura real da
   * linha em vez do que sobrava de verdade).
   */
  boardArea: {
    flex: 1,
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
  },

  /**
   * Erro do listener de rede — mais alto na tela que `<ConnectionSyncBanner
   * />` (`paddingTop: '6%'` contra `'14%'` de lá) para os dois nunca se
   * sobreporem visualmente no raro caso de aparecerem juntos.
   */
  errorLayer: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingTop: '6%',
    paddingHorizontal: 24,
  },
  errorBox: {
    maxWidth: 320,
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
