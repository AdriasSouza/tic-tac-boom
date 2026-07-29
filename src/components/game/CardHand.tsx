import { useCallback, useEffect, useMemo, useState } from 'react';
import {
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
import { useResponsiveLayout } from '@/hooks/useResponsiveLayout';
import { colors } from '@/theme/colors';
import { getCard } from '@/engine/cards/registry';
import {
  selectCanPlayCards,
  selectCanUseCard,
  selectHasPendingAcknowledgement,
  selectPendingAction,
  selectPlayerHand,
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
  const hand = useGameStore(selectPlayerHand);
  const canPlayCards = useGameStore(selectCanPlayCards);
  const status = useGameStore(selectStatus);
  const pendingAction = useGameStore(selectPendingAction);
  const clearPendingAction = useGameStore((s) => s.clearPendingAction);
  // Uma armadilha revelada ou carta de espionagem pausando o jogo: nem
  // arrastar, nem abrir o modo foco fazem sentido enquanto isso está na tela.
  const hasPendingAcknowledgement = useGameStore(selectHasPendingAcknowledgement);
  const { width, height } = useWindowDimensions();
  const { cardWidth, cardHeight, fanSpacing, handAreaHeight } = useResponsiveLayout();

  const isTargeting = pendingAction !== null;

  /* --- Modo foco -----------------------------------------------------------
     Estado local (não vive na store): é puramente apresentacional, não afeta
     regra de jogo — igual `draggingIndex` logo abaixo.                       */
  const [focusedUid, setFocusedUid] = useState<string | null>(null);
  const focusedEntry = focusedUid ? (hand.find((c) => c.uid === focusedUid) ?? null) : null;
  const canConfirmFocused = useGameStore(
    useMemo(() => selectCanUseCard(focusedUid ?? ''), [focusedUid]),
  );

  const handleFocusCard = useCallback(
    (uid: string) => {
      // Não abre foco em cima de uma mira já ativa (de outra carta, via
      // arrasto), nem enquanto uma confirmação manual pausa o jogo — os
      // dois casos evitariam dois fluxos de resolução disputando a vez.
      if (isTargeting || hasPendingAcknowledgement) return;
      setFocusedUid(uid);
    },
    [isTargeting, hasPendingAcknowledgement],
  );

  const handleCancelFocus = useCallback(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Soft);
    setFocusedUid(null);
  }, []);

  const handleConfirmFocus = useCallback(() => {
    if (!focusedEntry) return;
    const { uid, cardId } = focusedEntry;
    const card = getCard(cardId);

    if (card.type !== 'TRAP' && card.requiresTarget) {
      // Carta com alvo: sai do foco e entra em modo mira — o tabuleiro
      // assume a partir daqui, exatamente como no fluxo de arrastar.
      const armed = useGameStore.getState().setPendingAction({ type: 'PLAY_CARD', uid, cardId });
      void Haptics.impactAsync(
        armed ? Haptics.ImpactFeedbackStyle.Rigid : Haptics.ImpactFeedbackStyle.Soft,
      );
      if (!armed) void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } else {
      // Sem alvo (ou TRAP, que sempre arma direto): resolve na hora.
      const played = useGameStore.getState().playCard(uid);
      void Haptics.notificationAsync(
        played
          ? Haptics.NotificationFeedbackType.Success
          : Haptics.NotificationFeedbackType.Error,
      );
    }

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

  // Callbacks estáveis: uma arrow inline nas props anularia o `memo` do
  // CardItem e re-renderizaria a mão inteira a cada render do pai.
  const handleDragStart = useCallback((index: number) => setDraggingIndex(index), []);
  const handleDragEnd = useCallback(() => setDraggingIndex(null), []);

  const handleCancelTargeting = useCallback(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Soft);
    clearPendingAction();
  }, [clearPendingAction]);

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
      {/* Faixa de instrução — sem ela, o modo mira vira um beco sem saída. */}
      {isTargeting && (
        <Animated.View entering={FadeIn.duration(160)} exiting={FadeOut.duration(120)}>
          <Pressable
            onPress={handleCancelTargeting}
            style={styles.targetBanner}
            accessibilityRole="button"
            accessibilityLabel="Cancelar seleção de alvo"
          >
            <Text style={styles.targetBannerText}>
              ◎ ESCOLHA UM ALVO · {getCard(pendingAction.cardId).name}
            </Text>
            <Text style={styles.targetBannerCancel}>TOQUE AQUI PARA CANCELAR</Text>
          </Pressable>
        </Animated.View>
      )}

      <View style={[styles.fan, { height: handAreaHeight }]}>
        {hand.length === 0 ? (
          <Text style={styles.empty}>MÃO VAZIA</Text>
        ) : (
          hand.map(({ uid, cardId }, index) => {
            const { baseX, baseY, baseRotation } = layout[index];
            const isSelected = pendingAction?.uid === uid;

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
                // Durante a mira ninguém arrasta: ou resolve, ou cancela.
                canDrag={canPlayCards && !isTargeting && !hasPendingAcknowledgement}
                isSelected={isSelected}
                isDragging={draggingIndex === index}
                onDragStart={handleDragStart}
                onDragEnd={handleDragEnd}
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
  targetBannerCancel: {
    color: colors.textDim,
    fontSize: 7,
    letterSpacing: 2,
    marginTop: 2,
  },
  empty: {
    color: colors.textDim,
    fontSize: 9,
    letterSpacing: 3,
  },
});
