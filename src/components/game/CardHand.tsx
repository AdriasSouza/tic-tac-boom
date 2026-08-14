import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BackHandler,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';

import { CardItem } from './CardItem';
import { CardFocusModal } from '@/components/ui/CardFocusModal';
import { playSound } from '@/audio/soundEngine';
import { useCanPlayCardsNow, useIsLocalTurn } from '@/hooks/useLocalTurn';
import { useMatchPerspective } from '@/hooks/useMatchPerspective';
import { useResponsiveLayout } from '@/hooks/useResponsiveLayout';
import { netCancelInteraction, netPlayCard } from '@/services/syncBridge';
import { selectMultiplayerStatus, useMultiplayerStore } from '@/store/multiplayerStore';
import { colors } from '@/theme/colors';
import { getCard } from '@/engine/cards/registry';
import {
  selectCanUseCard,
  selectEnergy,
  selectHandOf,
  selectHasPendingAcknowledgement,
  selectIsChaosRouletteSpinning,
  selectPendingInteraction,
  selectStatus,
  useGameStore,
  type CardId,
} from '@/store/gameStore';

/* -------------------------------------------------------------------------- */
/*                             GEOMETRIA DO LEQUE                              */
/* -------------------------------------------------------------------------- */

/** Folga lateral mínima entre a ponta do leque e a borda da tela, em dp. */
const FAN_SIDE_PADDING = 12;

/** Rotação por passo a partir do centro, em graus. */
const FAN_ANGLE_STEP = 7;

/** Teto da rotação total, para mãos grandes não virarem ventilador. */
const FAN_ANGLE_MAX = 16;

/** Quanto cada passo afunda a carta no arco, em dp. */
const FAN_ARC_LIFT = 7;

/** Fração da altura da tela que conta como "zona de jogo". */
const PLAY_ZONE_RATIO = 0.5;

/* -------------------------------------------------------------------------- */
/*                                    PROPS                                    */
/* -------------------------------------------------------------------------- */

export interface CardHandProps {
  style?: StyleProp<ViewStyle>;
}

/* -------------------------------------------------------------------------- */
/*                                  COMPONENTE                                 */
/* -------------------------------------------------------------------------- */

/**
 * Mão do jogador, disposta em leque na base da tela.
 *
 * Responsabilidades:
 * - calcular a geometria do leque (posição, rotação e arco de cada carta);
 * - resolver o z-index da carta em arrasto;
 * - repassar a fronteira da zona de jogo para os worklets;
 * - exibir a faixa de instrução do modo mira.
 *
 * A física do arrasto mora inteira no `<CardItem />`.
 */
export function CardHand({ style }: CardHandProps) {
  // A mão do combatente que ESTE aparelho controla — `PLAYER` nos modos
  // offline, mas `MACHINE` para quem entrou numa sala online. Ler
  // `selectPlayerHand` fixo mostrava ao convidado a mão do adversário.
  const { localCombatant } = useMatchPerspective();
  const hand = useGameStore(useMemo(() => selectHandOf(localCombatant), [localCombatant]));
  // Energia do combatente local — cada carta compara o PRÓPRIO `cost` contra
  // este valor para decidir se aparece esmaecida (ver o `.map()` mais abaixo).
  const currentEnergy = useGameStore(useMemo(() => selectEnergy(localCombatant), [localCombatant]));
  // `useCanPlayCardsNow` no lugar de `selectCanPlayCards`: o seletor original
  // testa `turn === 'PLAYER'`, o que travaria permanentemente quem entrou
  // como `player2` numa sala online (do lado dele o combatente local é
  // `MACHINE`). Fora do online os dois são equivalentes de verdade —
  // `useIsLocalTurn` consulta `controlledCombatants` (hot-seat controla os
  // dois lados, CPU só `PLAYER`), não mais um `true` incondicional.
  const canPlayCards = useCanPlayCardsNow();
  const isLocalTurn = useIsLocalTurn();
  const isOnline = useMultiplayerStore(selectMultiplayerStatus) === 'MATCH_STARTED';
  const status = useGameStore(selectStatus);
  const pendingInteraction = useGameStore(selectPendingInteraction);
  // Uma armadilha revelada ou carta de espionagem pausando o jogo: nem
  // arrastar, nem abrir o modo foco fazem sentido enquanto isso está na tela.
  const hasPendingAcknowledgement = useGameStore(selectHasPendingAcknowledgement);
  // Giro de TIC TAC BOOM! em andamento: mesma trava de UI de `pendingInteraction`/
  // `pendingAcknowledgement`, ver `selectIsChaosRouletteSpinning`.
  const isChaosRouletteSpinning = useGameStore(selectIsChaosRouletteSpinning);
  const { width, height } = useWindowDimensions();
  const { cardWidth, cardHeight, fanSpacing, handAreaHeight } = useResponsiveLayout();

  // Qualquer interação pendente trava mão/tabuleiro pra outra ação (regra do
  // contrato, Fase 3) — `isTargeting` cobre os 2 `kind`s que miram CÉLULA
  // (`BOARD_TARGET`, e `PICK_BOARD_CELL` — 2º passo de DESLIZAR), que são
  // quem tem a própria faixa "◎ ESCOLHA..." abaixo; os outros `kind`s ganham
  // UI própria no `<InteractionModal />`, montado no root da tela, não aqui.
  const isInteracting = pendingInteraction !== null;
  const isTargeting =
    pendingInteraction?.kind === 'BOARD_TARGET' || pendingInteraction?.kind === 'PICK_BOARD_CELL';

  /* --- Modo foco -----------------------------------------------------------
     Estado local (não vive na store): é puramente apresentacional, não afeta
     regra de jogo — igual `draggingIndex` logo abaixo.                       */
  const [focusedUid, setFocusedUid] = useState<string | null>(null);
  const focusedEntry = focusedUid ? (hand.find((c) => c.uid === focusedUid) ?? null) : null;
  const canConfirmFocused = useGameStore(
    useMemo(() => selectCanUseCard(focusedUid ?? ''), [focusedUid]),
  );

  /**
   * Motivo mais provável do botão "USAR"/"ARMAR" estar desabilitado,
   * reconstituído na camada de apresentação a partir dos MESMOS sinais que já
   * travam o arrasto (`canDrag`, ver o `.map()` mais abaixo) — sem mudar
   * `selectCanUseCard`/a store, só explica pro jogador qual condição é a
   * culpada, na mesma ordem em que a guarda de fato checa (turno ➜ giro ➜
   * energia ➜ condição específica da carta, ex.: slot de armadilha cheio).
   * Sem isto o botão só ficava esmaecido, igual à mão, sem dizer por quê.
   */
  const focusDisabledReason = useMemo(() => {
    if (canConfirmFocused || !focusedEntry) return null;
    if (!canPlayCards) return 'NÃO É SUA VEZ';
    if (isChaosRouletteSpinning) return 'AGUARDE O GIRO TERMINAR';
    if (getCard(focusedEntry.cardId).cost > currentEnergy) return 'ENERGIA INSUFICIENTE';
    return 'CONDIÇÃO DA CARTA NÃO ATENDIDA';
  }, [canConfirmFocused, focusedEntry, canPlayCards, isChaosRouletteSpinning, currentEnergy]);

  const handleFocusCard = useCallback(
    (uid: string) => {
      // Não abre foco em cima de QUALQUER interação já pendente (mira de
      // outra carta, escolha de carta oculta, etc — via arrasto ou já
      // resolvendo em outro modal), nem enquanto uma confirmação manual
      // pausa o jogo — os dois casos evitariam dois fluxos de resolução
      // disputando a vez.
      if (isInteracting || hasPendingAcknowledgement) return;
      setFocusedUid(uid);
    },
    [isInteracting, hasPendingAcknowledgement],
  );

  const handleCancelFocus = useCallback(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Soft);
    playSound('TAP_SOFT');
    setFocusedUid(null);
  }, []);

  const handleConfirmFocus = useCallback(() => {
    if (!focusedEntry) return;
    const { uid } = focusedEntry;

    // Sempre pela mesma facade, sem ramo por tipo de carta — o STORE decide
    // sozinho se resolve na hora, abre `BOARD_TARGET` (carta com alvo) ou
    // outro `kind` de interação (Fase 3: não existe mais uma ação separada
    // de "armar mira", `playCard` cobre tudo). Ver `netPlayCard`. Replica no
    // online, repassa no local.
    const played = netPlayCard(uid);
    void Haptics.notificationAsync(
      played ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Error,
    );
    playSound(played ? 'NOTIFY_SUCCESS' : 'NOTIFY_ERROR');

    setFocusedUid(null);
  }, [focusedEntry]);

  // A carta pode sair da mão por caminhos que não passam por "cancelar" ou
  // "confirmar" (ex: SAQUE do oponente rouba ou destrói) — se isso acontecer
  // com o foco aberto, fecha sozinho em vez de mostrar uma carta fantasma.
  useEffect(() => {
    if (focusedUid && !hand.some((c) => c.uid === focusedUid)) setFocusedUid(null);
  }, [focusedUid, hand]);

  /**
   * A rodada/partida pode terminar com o modo foco aberto (ex: a jogada de
   * tabuleiro do oponente fecha a rodada enquanto o jogador está olhando uma
   * carta). `selectCanUseCard` já desabilita o botão "USAR" nesse caso — o
   * store nunca aceitaria a jogada mesmo que alguém clicasse —, mas o MODAL
   * em si ficava aberto, parecendo interativo. `focusedUid` é estado LOCAL
   * deste componente: retornar `null` de outro lugar não o desmonta nem reseta
   * seus hooks, então nada além deste efeito o fecharia sozinho.
   */
  useEffect(() => {
    if (status !== 'PLAYING') setFocusedUid(null);
  }, [status]);

  /**
   * Metade superior da tela = "jogar no tabuleiro".
   * Calculado aqui e passado como número puro: o worklet do gesto não pode
   * chamar hooks nem ler o store durante o arrasto.
   */
  const playZoneBottom = height * PLAY_ZONE_RATIO;

  /**
   * Índice da carta em arrasto, para levantá-la acima das vizinhas.
   *
   * Estado do React em vez de `zIndex` animado: mudança de z-index dentro de
   * `useAnimatedStyle` é instável no Android. Custa um render por arrasto —
   * irrelevante, já que os frames do movimento nunca tocam a thread JS.
   */
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);

  /**
   * Índice da carta sob o cursor. Mesmo papel do `draggingIndex` acima, pelo
   * mesmo motivo: a decisão de qual carta fica por cima é uma comparação entre
   * IRMÃS, e só o pai tem essa visão.
   *
   * Guardado como índice único (não um booleano por carta) porque no máximo
   * uma carta pode estar sobrevoada por vez — e é isso que resolve o caso
   * chato de o ponteiro atravessar rápido a região sobreposta de duas cartas:
   * se o `enter` da nova chegar ANTES do `leave` da antiga, o índice já é o
   * novo e o `leave` atrasado (que traz o índice velho) é descartado pela
   * comparação abaixo, em vez de apagar um destaque que acabou de nascer.
   */
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  // Callbacks estáveis: uma arrow inline nas props anularia o `memo` do
  // CardItem e re-renderizaria a mão inteira a cada render do pai.
  const handleDragStart = useCallback((index: number) => setDraggingIndex(index), []);
  const handleDragEnd = useCallback(() => setDraggingIndex(null), []);

  const handleHoverChange = useCallback((index: number, hovered: boolean) => {
    setHoveredIndex((prev) => (hovered ? index : prev === index ? null : prev));
  }, []);

  /**
   * O destaque é por ÍNDICE, e o índice muda de dono quando a mão muda de
   * tamanho: jogar a 2ª de 4 cartas faz a antiga 3ª virar a 2ª, e ela herdaria
   * um realce que o cursor nunca lhe deu — a carta some por baixo do ponteiro,
   * então não existe `pointerleave` para desfazê-lo. Zerar aqui é o mesmo
   * cuidado que o `onDragEnd` já toma com o `draggingIndex`.
   */
  useEffect(() => {
    setHoveredIndex(null);
  }, [hand.length]);

  const handleCancelTargeting = useCallback(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Soft);
    playSound('TAP_SOFT');
    netCancelInteraction();
  }, []);

  /**
   * Botão físico de voltar (Android) cancela a mira, mesma paridade que os
   * outros 4 `kind`s de `pendingInteraction` já têm via `onRequestClose` do
   * `<Modal>` nativo (`InteractionModal`/`AltarModal`). `BOARD_TARGET` não é
   * um `Modal` — é o tabuleiro + a faixa de instrução abaixo — então precisa
   * do próprio listener; sem isto, "voltar" durante a mira saía da tela do
   * jogo em vez de só cancelar a carta.
   */
  useEffect(() => {
    if (!isTargeting) return;

    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      handleCancelTargeting();
      return true; // consome o evento — não deixa o Android navegar pra trás
    });

    return () => subscription.remove();
  }, [isTargeting, handleCancelTargeting]);

  /**
   * Geometria pré-calculada: recomputa quando a mão ou a tela mudam.
   *
   * O espaçamento tem DOIS tetos, e vence o menor:
   * - o valor proporcional da tela (`fanSpacing`, de `useResponsiveLayout`);
   * - o que ainda cabe na largura disponível com a mão cheia.
   *
   * O segundo é o que resolve o sumiço das cartas em celular: com espaçamento
   * fixo, uma mão de 5 cartas ocupava mais que a largura da tela e as das
   * pontas ficavam metade para fora. Agora o leque simplesmente se fecha mais
   * (as cartas se sobrepõem), que é o comportamento natural de um leque de
   * verdade quando a mão cresce.
   */
  const layout = useMemo(() => {
    const count = hand.length;
    const middle = (count - 1) / 2;
    // Achata o leque conforme a mão cresce, respeitando o teto de ângulo.
    const angleStep = middle > 0 ? Math.min(FAN_ANGLE_STEP, FAN_ANGLE_MAX / middle) : 0;

    const usableWidth = Math.max(0, width - FAN_SIDE_PADDING * 2 - cardWidth);
    const maxSpacing = count > 1 ? usableWidth / (count - 1) : fanSpacing;
    const spacing = Math.max(12, Math.min(fanSpacing, maxSpacing));

    return Array.from({ length: count }, (_, index) => {
      const offset = index - middle;
      return {
        baseX: offset * spacing,
        baseY: Math.abs(offset) * FAN_ARC_LIFT, // centro mais alto ⇒ arco
        baseRotation: offset * angleStep,
      };
    });
  }, [hand.length, width, cardWidth, fanSpacing]);

  return (
    <View style={[styles.root, style]}>
      {/* Vez do oponente: sem um aviso, a mão simplesmente para de responder e
          o jogador não tem como saber se travou ou se é a vez do outro. Só
          aparece no online — em hot-seat `isLocalTurn` é sempre true (os dois
          lados são o mesmo humano); em CPU ele reflete a vez de verdade (ver
          `useIsLocalTurn`), mas a dimmed da mão já basta lá, sem precisar
          deste banner especificamente online. */}
      {isOnline && !isLocalTurn && (
        <Animated.View
          entering={FadeIn.duration(160)}
          exiting={FadeOut.duration(120)}
          style={styles.waitBanner}
        >
          <Text style={styles.waitBannerText}>AGUARDE · VEZ DO OPONENTE</Text>
        </Animated.View>
      )}

      {/* Faixa de instrução — sem ela, o modo mira vira um beco sem saída.
          Cobre os 2 `kind`s que miram célula (ver `isTargeting`, acima).
          `pendingInteraction.caster === localCombatant` (no online): esta
          faixa nomeia a carta E oferece cancelar — informação e uma ação que
          só fazem sentido pra quem jogou. O adversário já foi avisado de
          qual carta é via `CARD_PLAYED` (anúncio de sempre, antes da mira
          abrir); não precisa ver isto de novo, muito menos com um botão de
          cancelar que o motor rejeitaria mesmo se tocado (`cancelInteraction`,
          `gameStore.ts`, já recusa `caster !== combatant`). */}
      {isTargeting &&
        pendingInteraction &&
        (!isOnline || pendingInteraction.caster === localCombatant) && (
        <Animated.View entering={FadeIn.duration(160)} exiting={FadeOut.duration(120)}>
          <Pressable
            onPress={handleCancelTargeting}
            style={styles.targetBanner}
            accessibilityRole="button"
            accessibilityLabel="Cancelar seleção de alvo"
          >
            <Text style={styles.targetBannerText}>
              {pendingInteraction.kind === 'PICK_BOARD_CELL' ? '◎ ESCOLHA O DESTINO' : '◎ ESCOLHA UM ALVO'} ·{' '}
              {getCard(pendingInteraction.cardId).name}
            </Text>
            {/* Selo próprio, separado da linha de instrução acima — reforça
                que ESTA parte específica é a ação de cancelar, no mesmo
                idioma visual (borda chapada) dos botões "CANCELAR" que os
                outros 4 `kind`s de `pendingInteraction` já mostram em modal. */}
            <View style={styles.targetBannerCancelChip}>
              <Text style={styles.targetBannerCancel}>TOQUE AQUI PARA CANCELAR</Text>
            </View>
          </Pressable>
        </Animated.View>
      )}

      <View style={[styles.fan, { height: handAreaHeight }]}>
        {hand.length === 0 ? (
          <Text style={styles.empty}>MÃO VAZIA</Text>
        ) : (
          hand.map(({ uid, cardId }, index) => {
            const { baseX, baseY, baseRotation } = layout[index];
            const isSelected =
              pendingInteraction?.kind === 'BOARD_TARGET' && pendingInteraction.cardUid === uid;
            // Energia insuficiente trava o ARRASTO pelo MESMO mecanismo de
            // "não é sua vez"/"mira ativa" (entra no `canDrag` abaixo), mas
            // também vai sozinha pro `<CardItem />` como `canAfford`: dos
            // motivos que esmaecem a carta, só este o jogador resolve sozinho
            // esperando energia, e por isso ganha um sinal PRÓPRIO (selo de
            // custo vermelho) em vez de se perder na mesma opacidade reduzida
            // de "fora da vez"/"interação pendente".
            const canAfford = getCard(cardId).cost <= currentEnergy;

            return (
              <CardItem
                // `uid` é estável para o tempo de vida da carta: é o que faz
                // `entering`/`exiting` do Reanimated funcionarem ao remover
                // uma carta do meio do leque.
                key={uid}
                uid={uid}
                cardId={cardId}
                index={index}
                cardWidth={cardWidth}
                cardHeight={cardHeight}
                baseX={baseX}
                baseY={baseY}
                baseRotation={baseRotation}
                playZoneBottom={playZoneBottom}
                // Durante QUALQUER interação pendente ninguém arrasta outra
                // carta: ou resolve, ou cancela a que já está em curso. O
                // giro de TIC TAC BOOM! entra na mesma trava.
                canDrag={
                  canPlayCards &&
                  !isInteracting &&
                  !hasPendingAcknowledgement &&
                  !isChaosRouletteSpinning &&
                  canAfford
                }
                canAfford={canAfford}
                isSelected={isSelected}
                isDragging={draggingIndex === index}
                // Destaque de cursor: independente de `canDrag`. Uma carta que
                // o jogador não pode usar agora (energia curta, vez do rival)
                // continua precisando ser LIDA — o toque/clique nela abre o
                // `<CardFocusModal />` de qualquer jeito, e apagar o realce
                // faria a carta parecer inerte quando na verdade responde.
                isHovered={hoveredIndex === index}
                onDragStart={handleDragStart}
                onDragEnd={handleDragEnd}
                onHoverChange={handleHoverChange}
                onFocus={handleFocusCard}
              />
            );
          })
        )}
      </View>

      {/* Modo foco: alternativa ao arrastar, pensada para mouse/web. */}
      {focusedEntry && (
        <CardFocusModal
          cardId={focusedEntry.cardId}
          canConfirm={canConfirmFocused}
          disabledReason={focusDisabledReason}
          onCancel={handleCancelFocus}
          onConfirm={handleConfirmFocus}
        />
      )}
    </View>
  );
}

export default CardHand;

/* -------------------------------------------------------------------------- */
/*                                   ESTILOS                                   */
/* -------------------------------------------------------------------------- */

const styles = StyleSheet.create({
  root: {
    width: '100%',
    alignItems: 'center',
  },
  fan: {
    // `height` chega inline, de `useResponsiveLayout` — a faixa da mão precisa
    // encolher junto com a carta, senão reserva altura que a tela não tem.
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  waitBanner: {
    marginBottom: 6,
    paddingHorizontal: 14,
    paddingVertical: 5,
    backgroundColor: colors.bgPanel,
    borderWidth: 2,
    borderColor: colors.markO,
    alignItems: 'center',
  },
  waitBannerText: {
    color: colors.markO,
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 2,
  },
  targetBanner: {
    marginBottom: 6,
    paddingHorizontal: 14,
    paddingVertical: 6,
    backgroundColor: colors.bgPanel,
    borderWidth: 2,
    borderColor: colors.winGlow,
    alignItems: 'center',
  },
  targetBannerText: {
    color: colors.winGlow,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 2,
  },
  targetBannerCancelChip: {
    marginTop: 4,
    borderWidth: 1,
    borderColor: colors.textDim,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  targetBannerCancel: {
    color: colors.textDim,
    fontSize: 7,
    letterSpacing: 2,
  },
  empty: {
    color: colors.textDim,
    fontSize: 9,
    letterSpacing: 3,
  },
});
