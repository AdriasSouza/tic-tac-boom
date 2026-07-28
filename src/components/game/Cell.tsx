import * as Haptics from 'expo-haptics';
import { memo, useCallback, useEffect, useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import {
  canPlaceAt,
  isPendingTarget,
  selectCell,
  selectIsBlocked,
  selectIsTargeting,
  selectIsValidTarget,
  selectIsVanishing,
  selectIsWinningCell,
  useGameStore,
  type Mark,
} from '@/store/gameStore';
import { colors } from '@/theme/colors';

/* -------------------------------------------------------------------------- */
/*                                  CONSTANTES                                 */
/* -------------------------------------------------------------------------- */

/** Duração de meio ciclo do pulso da peça condenada. */
const PULSE_DURATION = 520;

/** Opacidade mínima do pulso — o requisito pede oscilar entre 0.3 e 1. */
const PULSE_MIN_OPACITY = 0.3;

/** Espessura da barra do "X" em relação ao lado da célula. */
const X_BAR_RATIO = 0.18;

/** Duração de meio ciclo do pisca-pisca de alvo válido. */
const TARGET_PULSE_DURATION = 420;

/* -------------------------------------------------------------------------- */
/*                                    PROPS                                    */
/* -------------------------------------------------------------------------- */

export interface CellProps {
  /** Posição no grid achatado (0..8). */
  index: number;
  /** Lado da célula em dp. O `<Board />` envia um inteiro já arredondado. */
  size: number;
}

/* -------------------------------------------------------------------------- */
/*                                  COMPONENTE                                 */
/* -------------------------------------------------------------------------- */

function CellComponent({ index, size }: CellProps) {
  /* --- Assinaturas mínimas ------------------------------------------------
     Cada seletor devolve um valor primitivo (ou a MESMA referência de Piece),
     então esta célula só re-renderiza quando ELA muda — não quando o HP, a
     mão de cartas ou outra casa do tabuleiro mudam.                          */
  const piece = useGameStore(useMemo(() => selectCell(index), [index]));
  const isVanishing = useGameStore(useMemo(() => selectIsVanishing(index), [index]));
  const isBlocked = useGameStore(useMemo(() => selectIsBlocked(index), [index]));
  const isWinning = useGameStore(useMemo(() => selectIsWinningCell(index), [index]));
  const isTargeting = useGameStore(selectIsTargeting);
  const isValidTarget = useGameStore(useMemo(() => selectIsValidTarget(index), [index]));

  /* --- Shared values (rodam na UI thread, zero re-render) ----------------- */
  const pulse = useSharedValue(1); // 1 = opaco, 0 = quase apagado
  const press = useSharedValue(0); // 0 = solto, 1 = pressionado
  const pop = useSharedValue(piece ? 1 : 0); // animação de entrada da peça
  const shake = useSharedValue(0); // tremida de jogada inválida
  const targetGlow = useSharedValue(0); // 0..1 — pisca-pisca de alvo válido

  /* --- Pulso contínuo da peça condenada ----------------------------------- */
  useEffect(() => {
    if (isVanishing) {
      pulse.value = withRepeat(
        withTiming(PULSE_MIN_OPACITY, {
          duration: PULSE_DURATION,
          easing: Easing.inOut(Easing.quad),
        }),
        -1, // infinito
        true, // reverte (ping-pong) em vez de saltar
      );
    } else {
      // Cancelar ANTES de reatribuir: sem isto o loop continua vivo na UI
      // thread e briga com o withTiming de saída.
      cancelAnimation(pulse);
      pulse.value = withTiming(1, { duration: 160 });
    }

    return () => cancelAnimation(pulse);
  }, [isVanishing, pulse]);

  /* --- Pisca-pisca de alvo válido (modo mira) ----------------------------- */
  useEffect(() => {
    if (isValidTarget) {
      targetGlow.value = withRepeat(
        withTiming(1, { duration: TARGET_PULSE_DURATION, easing: Easing.inOut(Easing.quad) }),
        -1,
        true,
      );
    } else {
      cancelAnimation(targetGlow);
      targetGlow.value = withTiming(0, { duration: 140 });
    }

    return () => cancelAnimation(targetGlow);
  }, [isValidTarget, targetGlow]);

  /* --- Entrada da peça ----------------------------------------------------
     Depende de `turnPlaced`, não da existência da peça: assim uma peça que
     some e outra que nasce na mesma célula reanimam corretamente.            */
  useEffect(() => {
    if (!piece) {
      pop.value = 0;
      return;
    }
    pop.value = 0;
    pop.value = withSpring(1, { damping: 11, stiffness: 260, mass: 0.6 });
  }, [piece?.turnPlaced, piece, pop]);

  /* --- Estilos animados ---------------------------------------------------- */
  const markStyle = useAnimatedStyle(() => ({
    opacity: pulse.value * interpolate(pop.value, [0, 1], [0, 1]),
    transform: [
      // Overshoot suave na entrada + respiração leve durante o pulso.
      { scale: interpolate(pop.value, [0, 1], [0.4, 1]) * interpolate(pulse.value, [PULSE_MIN_OPACITY, 1], [0.9, 1]) },
    ],
  }));

  const surfaceStyle = useAnimatedStyle(() => ({
    transform: [
      { scale: interpolate(press.value, [0, 1], [1, 0.94]) },
      { translateX: shake.value },
    ],
  }));

  /** Overlay do modo mira. Camada separada para não brigar com o pulso da peça. */
  const targetOverlayStyle = useAnimatedStyle(() => ({
    opacity: interpolate(targetGlow.value, [0, 1], [0.25, 0.9]),
    borderWidth: interpolate(targetGlow.value, [0, 1], [2, 3]),
  }));

  /* --- Interação ----------------------------------------------------------- */

  const rejectFeedback = useCallback(() => {
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    shake.value = withSequence(
      withTiming(-5, { duration: 45 }),
      withTiming(5, { duration: 45 }),
      withTiming(-3, { duration: 45 }),
      withTiming(0, { duration: 45 }),
    );
  }, [shake]);

  const handlePress = useCallback(() => {
    // Leitura imperativa do estado fresco: a validação não precisa de
    // assinatura reativa, e evita agir sobre um valor de render antigo.
    const state = useGameStore.getState();

    /* --- Modo mira intercepta tudo ---------------------------------------
       Com pendingAction ativo o toque resolve a carta, nunca posiciona peça. */
    if (state.pendingAction) {
      if (!isPendingTarget(state, index)) {
        rejectFeedback();
        return;
      }

      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      // Se o store recusar (corrida com mudança de estado), devolve o erro.
      if (!state.playCard(state.pendingAction.uid, index)) rejectFeedback();
      return;
    }

    /* --- Fluxo normal ----------------------------------------------------- */
    if (!canPlaceAt(state, index)) {
      rejectFeedback();
      return;
    }

    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    state.placeMark(index);
  }, [index, rejectFeedback]);

  const handlePressIn = useCallback(() => {
    press.value = withTiming(1, { duration: 70 });
  }, [press]);

  const handlePressOut = useCallback(() => {
    press.value = withSpring(0, { damping: 14, stiffness: 320 });
  }, [press]);

  /* --- Render -------------------------------------------------------------- */
  // Xadrez sutil: ajuda a ler o grid antes dos sprites finais entrarem.
  const isDarkTile = (Math.floor(index / 3) + (index % 3)) % 2 === 1;

  return (
    <Pressable
      onPress={handlePress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      // A célula sempre aceita toque: jogada inválida precisa do haptic de erro.
      accessibilityRole="button"
      accessibilityLabel={buildA11yLabel(
        index,
        piece?.mark ?? null,
        isBlocked,
        isVanishing,
        isValidTarget,
      )}
      style={{ width: size, height: size }}
    >
      <Animated.View
        style={[
          styles.surface,
          {
            width: size,
            height: size,
            backgroundColor: isBlocked
              ? colors.cellBlocked
              : isDarkTile
                ? colors.cellFillAlt
                : colors.cellFill,
          },
          isWinning && styles.surfaceWinning,
          surfaceStyle,
        ]}
      >
        {/* Bisel pixel art: 2 barras chapadas, sem gradiente. */}
        <View style={styles.bevelLight} pointerEvents="none" />
        <View style={styles.bevelShadow} pointerEvents="none" />

        {isBlocked && <BlockedGlyph size={size} />}

        {piece && (
          <Animated.View style={markStyle}>
            {piece.mark === 'X' ? <MarkX size={size} /> : <MarkO size={size} />}
          </Animated.View>
        )}

        {/* Alvo válido: moldura pulsando. Desenhada por cima da peça para o
            destaque não competir com o pulso de "vai sumir". */}
        {isValidTarget && (
          <Animated.View
            style={[styles.targetOverlay, targetOverlayStyle]}
            pointerEvents="none"
          />
        )}

        {/* Alvo inválido durante a mira: escurece para dirigir o olhar. */}
        {isTargeting && !isValidTarget && (
          <View style={styles.targetDimmed} pointerEvents="none" />
        )}
      </Animated.View>
    </Pressable>
  );
}

/**
 * `memo` com comparação explícita: o `<Board />` re-renderiza ao medir, mas
 * as células só precisam refazer render se index ou size mudarem — o resto
 * vem das assinaturas do Zustand.
 */
export const Cell = memo(
  CellComponent,
  (prev, next) => prev.index === next.index && prev.size === next.size,
);

export default Cell;

/* -------------------------------------------------------------------------- */
/*                          PEÇAS (placeholder pixel art)                      */
/* -------------------------------------------------------------------------- */
/* Desenhadas com Views em vez de fonte/imagem: arestas duras, sem
   anti-aliasing e sem dependência de asset. Trocar por <Image> quando os
   sprites finais existirem — a API (`size`) continua a mesma.                */

function MarkX({ size }: { size: number }) {
  const bar = Math.round(size * X_BAR_RATIO);
  const length = Math.round(size * 0.62);

  return (
    <View style={[styles.markBox, { width: size, height: size }]}>
      {[45, -45].map((deg) => (
        <View
          key={deg}
          style={[
            styles.xBar,
            {
              width: length,
              height: bar,
              marginTop: -bar / 2,
              marginLeft: -length / 2,
              transform: [{ rotate: `${deg}deg` }],
            },
          ]}
        />
      ))}
    </View>
  );
}

function MarkO({ size }: { size: number }) {
  const outer = Math.round(size * 0.6);
  const ring = Math.round(size * X_BAR_RATIO);

  return (
    <View style={[styles.markBox, { width: size, height: size }]}>
      <View
        style={{
          width: outer,
          height: outer,
          borderWidth: ring,
          borderColor: colors.markO,
          // borderRadius 0 de propósito: "O" blocado lê como pixel art.
          borderRadius: 0,
        }}
      />
    </View>
  );
}

/** Marca de célula interditada (regra BLOCKED_CELL). */
function BlockedGlyph({ size }: { size: number }) {
  const bar = Math.round(size * 0.12);

  return (
    <View style={[styles.markBox, StyleSheet.absoluteFill]} pointerEvents="none">
      <View
        style={{
          width: Math.round(size * 0.55),
          height: bar,
          backgroundColor: colors.danger,
          opacity: 0.85,
        }}
      />
    </View>
  );
}

/* -------------------------------------------------------------------------- */
/*                                 ACESSIBILIDADE                              */
/* -------------------------------------------------------------------------- */

function buildA11yLabel(
  index: number,
  mark: Mark | null,
  isBlocked: boolean,
  isVanishing: boolean,
  isValidTarget: boolean,
): string {
  const row = Math.floor(index / 3) + 1;
  const col = (index % 3) + 1;
  const base = `Linha ${row}, coluna ${col}`;
  const target = isValidTarget ? ', alvo válido para a carta' : '';

  if (isBlocked) return `${base}, célula bloqueada${target}`;
  if (!mark) return `${base}, vazia${target}`;
  return `${base}, peça ${mark}${isVanishing ? ', prestes a desaparecer' : ''}${target}`;
}

/* -------------------------------------------------------------------------- */
/*                                   ESTILOS                                   */
/* -------------------------------------------------------------------------- */

const styles = StyleSheet.create({
  surface: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  surfaceWinning: {
    backgroundColor: colors.winGlow,
  },
  bevelLight: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 2,
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  bevelShadow: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 2,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  markBox: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  xBar: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    backgroundColor: colors.markX,
  },
  targetOverlay: {
    ...StyleSheet.absoluteFill,
    borderColor: colors.winGlow,
  },
  targetDimmed: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
});
