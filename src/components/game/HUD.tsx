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

import HandTracker from './HandTracker';
import { useMatchPerspective } from '@/hooks/useMatchPerspective';
import { useResponsiveLayout } from '@/hooks/useResponsiveLayout';
import {
  ENERGY_CAP,
  INITIAL_HP,
  selectEnergy,
  selectMachineHp,
  selectPlayerHp,
  selectReservedEnergy,
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

/**
 * Folga entre blocos de HP. Único número da barra que NÃO escala: abaixo de
 * ~3dp dois blocos vizinhos deixam de se ler como separados, e o medidor
 * inteiro vira uma barra contínua — que é exatamente a leitura que o formato
 * em blocos existe para evitar.
 */
const BLOCK_GAP = 3;

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
 * **Linha superior do layout** — a barra de status.
 *
 * Uma única fileira `space-between` com três grupos:
 *
 * ```
 * [ HP · mão (você) ]      [ TURNO ]      [ mão · HP (rival) ]
 * ```
 *
 * As duas mãos vivem aqui (e não mais numa faixa própria abaixo, como fazia o
 * antigo `<OpponentHandZone />`) por dois motivos: a comparação "quantas
 * cartas eu tenho × quantas ele tem" passa a ser um único olhar em vez de dois
 * pontos distantes da tela, e a coluna vertical — o recurso mais escasso do
 * layout empilhado — economiza a faixa inteira que aquela zona reservava.
 *
 * Cada grupo lateral (HP + mão) muda de EIXO conforme a orientação da tela —
 * mesma lógica de "usar o eixo que está sobrando" já aplicada à área de
 * combate (ver `[mode].tsx`):
 *
 * - **Retrato**: o grupo empilha em coluna (mão logo abaixo do HP). A largura
 *   de cada lado fica pequena, mas a coluna vertical tem folga — é o mesmo
 *   motivo pelo qual a mão de baixo (`<CardHand />`) também é vertical de
 *   sobra nesse eixo.
 * - **Paisagem**: o grupo volta a ser uma fileira (HP e mão lado a lado,
 *   centralizados verticalmente) — há largura de monitor sobrando para os
 *   dois convivendo na mesma linha, e cartas maiores (ver
 *   `useResponsiveLayout`) aproveitam esse espaço em vez de ficar diminutas
 *   num canto.
 *
 * Cada `<HpTracker />` assina só o próprio HP, então dano num lado não
 * re-renderiza o outro.
 */
export function HUD({
  style,
  playerLabel = 'VOCÊ',
  machineLabel,
  hapticsEnabled = true,
}: HUDProps) {
  const turn = useGameStore(selectTurn);
  const status = useGameStore(selectStatus);
  // Barra de status inteira escalada pela MESMA fonte do resto da tela: aqui
  // ela divide uma única fileira entre HP, miniatura de mão e turno dos dois
  // lados, e com as medidas fixas de antes essa soma estourava a largura de um
  // celular pequeno.
  const { hpBlockSize, handTrackerRowHeight, isPortrait } = useResponsiveLayout();

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

        <View style={[styles.row, isPortrait && styles.rowPortrait]}>
          {/* Esquerda: você. Em paisagem, HP e mão lado a lado; em retrato,
              a mão empilha abaixo do HP — os dois alinhados à borda externa
              (`flex-start`: a mais próxima do canto esquerdo da tela). */}
          <View style={[styles.side, isPortrait ? styles.sideColumn : styles.sideRow]}>
            <HpTracker
              target={localCombatant}
              label={playerLabel}
              accent={colors.markX}
              align="left"
              isActive={isLive && turn === localCombatant}
              hapticsEnabled={hapticsEnabled}
              blockSize={hpBlockSize}
              // Retrato: tracker embutido no `trackerHeader` (ganho líquido de
              // altura, ver useResponsiveLayout.ts). Paisagem: NÃO embutido —
              // a `sideRow` já reservava exatamente este espaço pro antigo
              // `<MiniHand />`, então ele ocupa o mesmo lugar aqui embaixo,
              // sem custo de altura extra nenhum.
              inlineHandTracker={isPortrait}
              handTrackerRowHeight={handTrackerRowHeight}
              // São as MINHAS cartas — o leque lá embaixo já as mostra por
              // extenso, então o tracker não vaza identidade nova nenhuma.
              handRevealed
            />
            {!isPortrait && <HandTracker owner={localCombatant} revealed />}
          </View>

          <TurnBadge
            isLocalTurn={turn === localCombatant}
            isLive={isLive}
            opponentLabel={opponentLabel}
          />

          {/* Direita: o rival, espelhado. Em paisagem `row-reverse` põe o HP
              na borda externa e a mão para dentro; em retrato os dois só
              alinham à direita (`flex-end`), na mesma ordem vertical do lado
              esquerdo — não há "borda externa" a espelhar numa coluna. */}
          <View style={[styles.side, isPortrait ? styles.sideColumnRight : styles.sideRowReverse]}>
            <HpTracker
              target={remoteCombatant}
              label={opponentLabel}
              accent={colors.markO}
              align="right"
              isActive={isLive && turn === remoteCombatant}
              hapticsEnabled={hapticsEnabled}
              blockSize={hpBlockSize}
              inlineHandTracker={isPortrait}
              handTrackerRowHeight={handTrackerRowHeight}
              // Sem `handRevealed`: versos idênticos, só a carta que a
              // ESPIADA já revelou mostra face (ver `<HandTracker />`).
            />
            {/* `row-reverse` no pai põe o HP na borda externa — este elemento
                fica pra dentro, mesma posição que o antigo `<MiniHand />`
                ocupava. */}
            {!isPortrait && <HandTracker owner={remoteCombatant} />}
          </View>
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
  /** Lado de cada bloco em dp, já resolvido para esta tela. */
  blockSize: number;
  /** Repassado direto ao `<HandTracker />` deste lado — ver o prop lá. */
  handRevealed?: boolean;
  /**
   * `true` só em retrato: embute o `<HandTracker />` DENTRO do
   * `trackerHeader` (ganho líquido de altura ali — a antiga `<MiniHand />`
   * empilhava abaixo, em coluna). Em paisagem fica `false`: o `<HandTracker />`
   * é renderizado como IRMÃO deste componente, no lugar exato que a
   * `<MiniHand />` ocupava na `sideRow` — ali os dois nunca se somavam
   * (a fileira já tinha a altura do maior dos dois), então embutir aqui só
   * forçaria este cabeçalho a crescer sem nada em troca. Ver `HUD()`.
   */
  inlineHandTracker: boolean;
  /** Altura EXPLÍCITA do `trackerHeader` — só aplicada quando `inlineHandTracker`. */
  handTrackerRowHeight: number;
}

const HpTracker = memo(function HpTracker({
  target,
  label,
  accent,
  align,
  isActive,
  hapticsEnabled,
  blockSize,
  handRevealed = false,
  inlineHandTracker,
  handTrackerRowHeight,
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

  const energy = useGameStore(useMemo(() => selectEnergy(target), [target]));
  // Pips logo acima de `energy` que só estão vazios porque uma interação
  // pendente DESTE combatente já debitou o custo ao abrir (timing unificado,
  // Fase 3) — voltam a `energy` se ele cancelar. Ganham contorno tracejado em
  // vez de vazio liso, sinalizando "reservado" em vez de "gasto".
  const reserved = useGameStore(useMemo(() => selectReservedEnergy(target), [target]));
  const energyPips = useMemo(() => Array.from({ length: ENERGY_CAP }, (_, i) => i), []);
  // Menor que o bloco de HP DE PROPÓSITO: a altura desta fileira (`styles.blocks`)
  // é ditada pelo maior filho, e o bloco de HP já é esse filho — um pip que
  // nunca é maior garante, por construção, que acrescentar energia aqui não
  // muda a altura do HUD (ver AGENTS.md: só o `<Board />` decide geometria de
  // jogo, e ele mede o espaço que sobra DEPOIS do HUD — qualquer dp a mais na
  // altura do HUD sairia direto do tabuleiro).
  const energyPipSize = Math.round(blockSize * 0.75);

  return (
    <Animated.View
      style={[styles.tracker, align === 'right' && styles.trackerRight, containerStyle]}
    >
      <View
        style={[
          styles.trackerHeader,
          inlineHandTracker && { height: handTrackerRowHeight },
          align === 'right' && styles.rowReverse,
        ]}
      >
        {/* Marcador de turno: barra sólida que só existe no lado ativo. */}
        <TurnMarker isActive={isActive} color={accent} />
        <Animated.Text style={[styles.trackerLabel, labelStyle]} numberOfLines={1}>
          {label}
        </Animated.Text>
        {/* `row-reverse` no `trackerHeader` (lado direito) já espelha a ORDEM
            destes filhos — o tracker cai automaticamente do lado de dentro
            (perto do tabuleiro) nos dois lados, sem lógica extra aqui.
            Só em retrato: em paisagem o `<HandTracker />` mora fora daqui
            (ver `inlineHandTracker` e `HUD()`). */}
        {inlineHandTracker && <HandTracker owner={target} revealed={handRevealed} />}
      </View>

      <View style={[styles.blocks, align === 'right' && styles.rowReverse]}>
        {blocks.map((i) => (
          <HpBlock
            key={i}
            filled={i < hp}
            breaking={breakingIndex === i}
            accent={accent}
            damage={damage}
            size={blockSize}
          />
        ))}
        {/* Espaçador só pra separar visualmente HP de energia, sem precisar de
            um rótulo novo (que custaria altura). */}
        <View style={{ width: Math.max(4, Math.round(blockSize * 0.4)) }} />
        {energyPips.map((i) => (
          <EnergyPip
            key={i}
            state={i < energy ? 'FILLED' : i < energy + reserved ? 'RESERVED' : 'EMPTY'}
            size={energyPipSize}
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
  /** Lado do bloco em dp. */
  size: number;
}

const HpBlock = memo(function HpBlock({ filled, breaking, accent, damage, size }: HpBlockProps) {
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
    <View style={[styles.blockSlot, { width: size, height: size }]}>
      {/* Slot vazio sempre visível: comunica quanto HP já foi perdido. */}
      <View style={[styles.blockEmpty, { borderColor: accent }]} pointerEvents="none" />
      <Animated.View
        // O miolo cheio é sempre menor que o slot pela mesma proporção do
        // desenho original (12 de 18) — com um recuo fixo em dp, num aparelho
        // pequeno o miolo desapareceria dentro da própria borda.
        style={[{ width: Math.round(size * 0.66), height: Math.round(size * 0.66) }, animatedStyle]}
        pointerEvents="none"
      />
    </View>
  );
});

/* -------------------------------------------------------------------------- */
/*                                ENERGY PIP                                   */
/* -------------------------------------------------------------------------- */

/**
 * - `FILLED`   — energia disponível agora.
 * - `RESERVED` — vazio só porque uma interação pendente deste combatente já
 *   debitou o custo ao abrir; volta a `FILLED` se ele cancelar. Visualmente
 *   idêntico a `EMPTY` exceto pela borda (tracejada) — nunca muda o tamanho
 *   do slot, então não pode alterar a altura da fileira (`styles.blocks`).
 * - `EMPTY`    — sem energia, sem reserva.
 */
type EnergyPipState = 'FILLED' | 'RESERVED' | 'EMPTY';

interface EnergyPipProps {
  state: EnergyPipState;
  /** Lado do pip em dp — sempre <= `blockSize` (ver `energyPipSize` em `HpTracker`). */
  size: number;
}

/**
 * Ficha de energia — mesmo desenho do `<HpBlock />` (slot + miolo), sem a
 * animação de dano/quebra: energia não tem evento de "perder" digno de flash,
 * só sobe e desce em silêncio a cada turno.
 */
const EnergyPip = memo(function EnergyPip({ state, size }: EnergyPipProps) {
  return (
    <View style={[styles.blockSlot, { width: size, height: size }]}>
      <View
        style={[
          styles.blockEmpty,
          { borderColor: colors.winGlow },
          state === 'RESERVED' && styles.energyPipReservedBorder,
        ]}
        pointerEvents="none"
      />
      {state === 'FILLED' && (
        <View
          style={[
            styles.energyPipFill,
            { width: Math.round(size * 0.66), height: Math.round(size * 0.66) },
          ]}
          pointerEvents="none"
        />
      )}
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
    // `flex-end` (não `center`): em paisagem cada grupo lateral é uma FILEIRA
    // (HP + mão lado a lado), e o medidor de HP tem duas linhas (rótulo +
    // blocos) enquanto a mão tem uma só (contagem + fichas) — ancorar pela
    // BASE alinha os dois na mesma linha do olhar. Centralizar deixava a mão
    // flutuando no meio do HP.
    alignItems: 'flex-end',
    justifyContent: 'space-between',
  },
  // Retrato: cada grupo lateral virou uma COLUNA (HP em cima, mão embaixo) —
  // "base" deixa de fazer sentido como referência entre os dois grupos, então
  // centraliza a fileira toda em relação ao badge de turno do meio.
  rowPortrait: {
    alignItems: 'center',
  },
  rowReverse: {
    flexDirection: 'row-reverse',
  },

  /**
   * Grupo lateral: HP + miniatura da mão. `flex:1` divide a sobra igualmente
   * entre os dois lados, e o `<TurnBadge />` no meio fica com a largura fixa
   * dele — é o que mantém o indicador de turno visualmente centrado mesmo com
   * mãos de tamanhos diferentes nos dois lados.
   *
   * A DIREÇÃO do grupo (variantes abaixo) é quem decide se HP e mão dividem a
   * largura (paisagem, sobrando) ou a altura (retrato, sobrando) — nunca o
   * eixo que já está apertado.
   */
  side: {
    flex: 1,
    gap: 8,
  },
  // Paisagem, lado esquerdo (você): HP e mão em fileira, centralizados.
  sideRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  // Paisagem, lado direito (rival): espelha — HP na borda externa, mão para
  // dentro — mesmo papel que `rowReverse` já cumpre em outros componentes.
  sideRowReverse: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
  },
  // Retrato, lado esquerdo: empilha, ancorado à borda externa (esquerda).
  sideColumn: {
    flexDirection: 'column',
    alignItems: 'flex-start',
  },
  // Retrato, lado direito: empilha, ancorado à borda externa (direita).
  sideColumnRight: {
    flexDirection: 'column',
    alignItems: 'flex-end',
  },

  /* Tracker */
  tracker: {
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
    fontSize: 10,
    letterSpacing: 1.5,
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
    // width/height chegam inline, escalados por `useResponsiveLayout`.
    alignItems: 'center',
    justifyContent: 'center',
  },
  blockEmpty: {
    ...StyleSheet.absoluteFill,
    borderWidth: 2,
    opacity: 0.28,
  },
  energyPipFill: {
    backgroundColor: colors.winGlow,
  },
  // Só troca o traço da borda (tracejado) — herda largura/cor/opacidade de
  // `blockEmpty`, então não pode mudar o tamanho do pip nem a altura da
  // fileira (mesma garantia estrutural do `energyPipSize`, ver `HpTracker`).
  energyPipReservedBorder: {
    borderStyle: 'dashed',
    opacity: 0.6,
  },

  /* Badge central */
  turnBadge: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
    // Sem `minWidth` fixo: agora que os dois grupos laterais são `flex:1`,
    // uma largura mínima aqui só serviria para roubar espaço deles em telas
    // estreitas. O badge fica com o que o próprio texto pede.
    flexShrink: 0,
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
