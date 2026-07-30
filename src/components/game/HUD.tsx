import * as Haptics from 'expo-haptics';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  interpolate,
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import { useMatchPerspective } from '@/hooks/useMatchPerspective';
import {
  INITIAL_HP,
  selectMachineHp,
  selectPlayerHp,
  selectStatus,
  selectTurn,
  useGameStore,
  type Combatant,
} from '@/store/gameStore';
import { colors } from '@/theme/colors';

/* -------------------------------------------------------------------------- */
/*                                  CONSTANTES                                 */
/* -------------------------------------------------------------------------- */

/** Duração total do flash de dano. */
const DAMAGE_FLASH = 420;

/** Amplitude do shake de dano, em dp. */
const SHAKE_AMPLITUDE = 7;

/** Quanto tempo o bloco perdido fica em animação de quebra. */
const BREAK_DURATION = 480;

const BLOCK_SIZE = 18;
const BLOCK_GAP = 4;

/* -------------------------------------------------------------------------- */
/*                                    PROPS                                    */
/* -------------------------------------------------------------------------- */

export interface HUDProps {
  style?: StyleProp<ViewStyle>;
  /** Rótulo do lado local. */
  playerLabel?: string;
  /** Rótulo do adversário. Omitido, vira "CPU" offline e "RIVAL" no online. */
  machineLabel?: string;
  hapticsEnabled?: boolean;
}

/* -------------------------------------------------------------------------- */
/*                                  COMPONENTE                                 */
/* -------------------------------------------------------------------------- */

/**
 * Painel de status entre o `<ChaosTerminal />` e o `<Board />`.
 *
 * Mostra o HP dos dois lados em blocos pixelados e sinaliza o turno ativo.
 * Cada `<HpTracker />` assina só o próprio HP, então dano no Player não
 * re-renderiza o lado da Máquina.
 */
export function HUD({
  style,
  playerLabel = 'VOCÊ',
  machineLabel,
  hapticsEnabled = true,
}: HUDProps) {
  const turn = useGameStore(selectTurn);
  const status = useGameStore(selectStatus);

  /* O lado esquerdo (vermelho) é sempre QUEM ESTÁ SEGURANDO O APARELHO, e o
     direito (azul) sempre o adversário — mesmo numa sala online, onde o
     jogador local pode ser o combatente `MACHINE`. Fixar `target="PLAYER"` à
     esquerda mostraria ao convidado a vida do oponente no próprio lado. */
  const { localCombatant, remoteCombatant, isOnline } = useMatchPerspective();
  const opponentLabel = machineLabel ?? (isOnline ? 'RIVAL' : 'CPU');

  const isLive = status === 'PLAYING';

  return (
    <View style={[styles.root, style]}>
      <View style={styles.panel}>
        {/* Bisel pixel art chapado — mesma linguagem do Board. */}
        <View style={styles.bevelLight} pointerEvents="none" />
        <View style={styles.bevelShadow} pointerEvents="none" />

        <View style={styles.row}>
          <HpTracker
            target={localCombatant}
            label={playerLabel}
            accent={colors.markX}
            align="left"
            isActive={isLive && turn === localCombatant}
            hapticsEnabled={hapticsEnabled}
          />

          <TurnBadge
            isLocalTurn={turn === localCombatant}
            isLive={isLive}
            opponentLabel={opponentLabel}
          />

          <HpTracker
            target={remoteCombatant}
            label={opponentLabel}
            accent={colors.markO}
            align="right"
            isActive={isLive && turn === remoteCombatant}
            hapticsEnabled={hapticsEnabled}
          />
        </View>
      </View>
    </View>
  );
}

export default HUD;

/* -------------------------------------------------------------------------- */
/*                                 HP TRACKER                                  */
/* -------------------------------------------------------------------------- */

interface HpTrackerProps {
  target: Combatant;
  label: string;
  accent: string;
  align: 'left' | 'right';
  isActive: boolean;
  hapticsEnabled: boolean;
}

const HpTracker = memo(function HpTracker({
  target,
  label,
  accent,
  align,
  isActive,
  hapticsEnabled,
}: HpTrackerProps) {
  const hp = useGameStore(target === 'PLAYER' ? selectPlayerHp : selectMachineHp);

  /* --- Detecção do evento de dano ----------------------------------------
     O store expõe o HP atual, não um evento. Comparar com o valor anterior
     via ref é o jeito correto de derivar "levou dano" sem poluir o estado
     com flags efêmeras que teriam de ser limpas depois.                     */
  const prevHp = useRef(hp);
  const [breakingIndex, setBreakingIndex] = useState<number | null>(null);

  const damage = useSharedValue(0); // 0 = normal, 1 = pico do flash
  const shake = useSharedValue(0);

  useEffect(() => {
    const lost = prevHp.current - hp;
    prevHp.current = hp;

    if (lost <= 0) {
      // Cura ou reset de partida: só limpa o estado visual.
      setBreakingIndex(null);
      return;
    }

    // O bloco que acabou de esvaziar é exatamente o de índice `hp`.
    setBreakingIndex(hp);

    damage.value = withSequence(
      withTiming(1, { duration: 60, easing: Easing.out(Easing.quad) }),
      withTiming(0, { duration: DAMAGE_FLASH - 60, easing: Easing.in(Easing.quad) }),
    );

    shake.value = withSequence(
      withTiming(-SHAKE_AMPLITUDE, { duration: 42 }),
      withTiming(SHAKE_AMPLITUDE, { duration: 42 }),
      withTiming(-SHAKE_AMPLITUDE * 0.6, { duration: 42 }),
      withTiming(SHAKE_AMPLITUDE * 0.4, { duration: 42 }),
      withTiming(0, { duration: 42 }),
    );

    if (hapticsEnabled) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }

    const timeout = setTimeout(() => setBreakingIndex(null), BREAK_DURATION);
    return () => clearTimeout(timeout);
  }, [hp, damage, shake, hapticsEnabled]);

  useEffect(
    () => () => {
      cancelAnimation(damage);
      cancelAnimation(shake);
    },
    [damage, shake],
  );

  /* --- Estilos animados --------------------------------------------------- */
  const containerStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: shake.value }],
  }));

  const labelStyle = useAnimatedStyle(() => ({
    color: interpolateColor(damage.value, [0, 1], [colors.textDim, '#ffffff']),
  }));

  const blocks = useMemo(() => Array.from({ length: INITIAL_HP }, (_, i) => i), []);

  return (
    <Animated.View
      style={[styles.tracker, align === 'right' && styles.trackerRight, containerStyle]}
    >
      <View style={[styles.trackerHeader, align === 'right' && styles.rowReverse]}>
        {/* Marcador de turno: barra sólida que só existe no lado ativo. */}
        <TurnMarker isActive={isActive} color={accent} />
        <Animated.Text style={[styles.trackerLabel, labelStyle]} numberOfLines={1}>
          {label}
        </Animated.Text>
      </View>

      <View style={[styles.blocks, align === 'right' && styles.rowReverse]}>
        {blocks.map((i) => (
          <HpBlock
            key={i}
            filled={i < hp}
            breaking={breakingIndex === i}
            accent={accent}
            damage={damage}
          />
        ))}
      </View>
    </Animated.View>
  );
});

/* -------------------------------------------------------------------------- */
/*                                  HP BLOCK                                   */
/* -------------------------------------------------------------------------- */

interface HpBlockProps {
  filled: boolean;
  breaking: boolean;
  accent: string;
  /** Shared value do tracker — 0..1 durante o flash de dano. */
  damage: SharedValue<number>;
}

const HpBlock = memo(function HpBlock({ filled, breaking, accent, damage }: HpBlockProps) {
  const burst = useSharedValue(0);

  useEffect(() => {
    if (!breaking) {
      burst.value = 0;
      return;
    }
    burst.value = 0;
    burst.value = withSequence(
      withTiming(1, { duration: 110, easing: Easing.out(Easing.back(2)) }),
      withTiming(0, { duration: BREAK_DURATION - 110, easing: Easing.in(Easing.quad) }),
    );
    return () => cancelAnimation(burst);
  }, [breaking, burst]);

  const animatedStyle = useAnimatedStyle(() => {
    // Bloco cheio pisca vermelho ➜ branco durante o dano do tracker.
    const flashed = interpolateColor(damage.value, [0, 1], [accent, '#ffffff']);

    return {
      backgroundColor: breaking ? '#ffffff' : filled ? flashed : 'transparent',
      opacity: breaking ? interpolate(burst.value, [0, 1], [0, 1]) : 1,
      transform: [{ scale: breaking ? interpolate(burst.value, [0, 1], [0.6, 1.45]) : 1 }],
    };
  });

  return (
    <View style={styles.blockSlot}>
      {/* Slot vazio sempre visível: comunica quanto HP já foi perdido. */}
      <View style={[styles.blockEmpty, { borderColor: accent }]} pointerEvents="none" />
      <Animated.View style={[styles.blockFill, animatedStyle]} pointerEvents="none" />
    </View>
  );
});

/* -------------------------------------------------------------------------- */
/*                            INDICADORES DE TURNO                             */
/* -------------------------------------------------------------------------- */

/** Barra sólida que pulsa no lado de quem está jogando. */
const TurnMarker = memo(function TurnMarker({
  isActive,
  color,
}: {
  isActive: boolean;
  color: string;
}) {
  const pulse = useSharedValue(0);

  useEffect(() => {
    if (isActive) {
      pulse.value = withRepeat(
        withTiming(1, { duration: 620, easing: Easing.inOut(Easing.quad) }),
        -1,
        true,
      );
    } else {
      cancelAnimation(pulse);
      pulse.value = withTiming(0, { duration: 140 });
    }
    return () => cancelAnimation(pulse);
  }, [isActive, pulse]);

  const style = useAnimatedStyle(() => ({
    opacity: isActive ? interpolate(pulse.value, [0, 1], [0.35, 1]) : 0.12,
  }));

  return <Animated.View style={[styles.turnMarker, { backgroundColor: color }, style]} />;
});

/**
 * Rótulo central de quem joga agora.
 *
 * Recebe `isLocalTurn` já resolvido em vez do `Combatant` cru: a decisão
 * "isto sou eu?" pertence à perspectiva, e o badge só precisa do resultado.
 */
const TurnBadge = memo(function TurnBadge({
  isLocalTurn,
  isLive,
  opponentLabel,
}: {
  isLocalTurn: boolean;
  isLive: boolean;
  opponentLabel: string;
}) {
  const fade = useSharedValue(1);

  // Refaz o fade a cada troca de turno para dar sensação de "troca de posse".
  useEffect(() => {
    fade.value = 0;
    fade.value = withTiming(1, { duration: 220, easing: Easing.out(Easing.quad) });
    return () => cancelAnimation(fade);
  }, [isLocalTurn, fade]);

  const style = useAnimatedStyle(() => ({
    opacity: fade.value,
    transform: [{ translateY: interpolate(fade.value, [0, 1], [-4, 0]) }],
  }));

  return (
    <View style={styles.turnBadge}>
      <Text style={styles.turnBadgeCaption}>TURNO</Text>
      <Animated.Text
        style={[
          styles.turnBadgeValue,
          { color: isLocalTurn ? colors.markX : colors.markO },
          style,
        ]}
        numberOfLines={1}
      >
        {!isLive ? '--' : isLocalTurn ? 'VOCÊ' : opponentLabel}
      </Animated.Text>
    </View>
  );
});

/* -------------------------------------------------------------------------- */
/*                                   ESTILOS                                   */
/* -------------------------------------------------------------------------- */

const styles = StyleSheet.create({
  root: {
    width: '100%',
    paddingHorizontal: 12,
  },
  panel: {
    backgroundColor: colors.bgPanel,
    borderWidth: 2,
    borderColor: colors.boardFrameShadow,
    paddingVertical: 10,
    paddingHorizontal: 12,
    overflow: 'hidden',
  },
  bevelLight: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 2,
    backgroundColor: 'rgba(255,255,255,0.10)',
  },
  bevelShadow: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 2,
    backgroundColor: 'rgba(0,0,0,0.40)',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  rowReverse: {
    flexDirection: 'row-reverse',
  },

  /* Tracker */
  tracker: {
    flex: 1,
    alignItems: 'flex-start',
    gap: 6,
  },
  trackerRight: {
    alignItems: 'flex-end',
  },
  trackerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  trackerLabel: {
    fontSize: 11,
    letterSpacing: 2,
    fontWeight: '700',
    color: colors.textDim,
  },
  turnMarker: {
    width: 6,
    height: 12,
  },

  /* Blocos de HP */
  blocks: {
    flexDirection: 'row',
    gap: BLOCK_GAP,
  },
  blockSlot: {
    width: BLOCK_SIZE,
    height: BLOCK_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  blockEmpty: {
    ...StyleSheet.absoluteFill,
    borderWidth: 2,
    opacity: 0.28,
  },
  blockFill: {
    width: BLOCK_SIZE - 6,
    height: BLOCK_SIZE - 6,
  },

  /* Badge central */
  turnBadge: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
    minWidth: 72,
  },
  turnBadgeCaption: {
    fontSize: 8,
    letterSpacing: 3,
    color: colors.textDim,
    marginBottom: 2,
  },
  turnBadgeValue: {
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 1,
  },
});
