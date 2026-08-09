import * as Haptics from 'expo-haptics';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
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

import { useMatchPerspective } from '@/hooks/useMatchPerspective';
import {
  getLocalCombatant,
  isLocalTurn,
  isOpponentConnected,
  netPlaceMark,
  netResolveInteraction,
} from '@/services/syncBridge';
import {
  canPlaceAt,
  isPendingTarget,
  selectCell,
  selectHighlightedOldest,
  selectIsBlocked,
  selectIsCardLocked,
  selectIsTargeting,
  selectIsValidTarget,
  selectIsVanishing,
  selectIsWinningCell,
  selectLastChaosRoulette,
  useGameStore,
  CHAOS_ROULETTE_COLUMN_STOP_MS,
  CHAOS_ROULETTE_FADE_MS,
  CHAOS_ROULETTE_FLICKER_MS,
  type Combatant,
  type Mark,
} from '@/store/gameStore';
import { colors } from '@/theme/colors';
import { RARITY_COLOR } from '@/theme/rarity';

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

/**
 * Duração de meio ciclo do glow de VIDENTE — sensivelmente mais lento que o
 * de alvo válido (`TARGET_PULSE_DURATION`) de propósito: os dois nunca
 * coexistem de fato (mira exige uma interação `BOARD_TARGET` pendente, que
 * impede jogar outra carta nesse instante), mas o ritmo diferente deixa a
 * leitura inequívoca
 * mesmo assim — reaproveita a MESMA cor (`colors.winGlow`, já é a cor de
 * "informação de carta", ver o badge de custo), só com forma e cadência
 * distintas (borda tracejada, pulso mais lento).
 */
const VISION_PULSE_DURATION = 900;

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
  const isCardLocked = useGameStore(useMemo(() => selectIsCardLocked(index), [index]));
  const isWinning = useGameStore(useMemo(() => selectIsWinningCell(index), [index]));
  const isTargeting = useGameStore(selectIsTargeting);
  const isValidTarget = useGameStore(useMemo(() => selectIsValidTarget(index), [index]));
  // Define qual peça é "minha" para efeito de cor — ver `colorFor`.
  const { localCombatant, isOnline } = useMatchPerspective();

  /**
   * VIDENTE: "só para quem jogou" só faz sentido gatear por IDENTIDADE fixa
   * (`localCombatant`) no ONLINE, onde os dois lados são aparelhos
   * fisicamente separados. Fora do online (`isOnline === false` cobre CPU E
   * `/game/local` hot-seat) `localCombatant` é sempre `'PLAYER'` — mas em
   * hot-seat `MACHINE` é um segundo HUMANO no mesmo aparelho, então esconder
   * por essa identidade fixa esconderia o destaque de quem joga de MACHINE
   * ali. Como o destaque só existe enquanto é o turno de quem o lançou (ver
   * limpeza em `placeMark`/`endTurn`), mostrar sempre que estiver aceso é
   * seguro e correto fora do online — a tela já é compartilhada, esconder
   * não protegeria nada.
   */
  const highlighted = useGameStore(selectHighlightedOldest);
  const isHighlightedByVidente =
    highlighted?.index === index && (!isOnline || highlighted.caster === localCombatant);

  /* --- Shared values (rodam na UI thread, zero re-render) ----------------- */
  const pulse = useSharedValue(1); // 1 = opaco, 0 = quase apagado
  const press = useSharedValue(0); // 0 = solto, 1 = pressionado
  const pop = useSharedValue(piece ? 1 : 0); // animação de entrada da peça
  const shake = useSharedValue(0); // tremida de jogada inválida
  const targetGlow = useSharedValue(0); // 0..1 — pisca-pisca de alvo válido
  const visionGlow = useSharedValue(0); // 0..1 — glow do destaque de VIDENTE

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

  /** --- Glow do destaque de VIDENTE ----------------------------------------
   * Variável própria (`visionGlow`), independente do pulso de "vai sumir" e
   * do glow de mira — cada efeito tem semântica própria e não deve competir
   * com os outros dois. */
  useEffect(() => {
    if (isHighlightedByVidente) {
      visionGlow.value = withRepeat(
        withTiming(1, { duration: VISION_PULSE_DURATION, easing: Easing.inOut(Easing.quad) }),
        -1,
        true,
      );
    } else {
      cancelAnimation(visionGlow);
      visionGlow.value = withTiming(0, { duration: 140 });
    }

    return () => cancelAnimation(visionGlow);
  }, [isHighlightedByVidente, visionGlow]);

  /** --- Giro de TIC TAC BOOM! (CHAOS_ROULETTE) -----------------------------
   * Reage ao `id` (não ao payload), mesmo racional de `<ExtraTurnBanner />`:
   * sobrevive a double-invoke de efeito em dev e refaz mesmo em replay
   * idêntico. O glifo "verdadeiro" ao travar vem de `piece` (já é o board
   * PÓS-reshuffle, resolvido de forma síncrona por `applyCardEffectResult`)
   * — nenhum estado adicional precisa ser lido além do que a célula já
   * assina. Cada coluna trava no seu próprio horário
   * (`CHAOS_ROULETTE_COLUMN_STOP_MS[column]`), dando o efeito de "esquerda,
   * meio, direita" pedido. */
  const lastChaosRoulette = useGameStore(selectLastChaosRoulette);
  const column = index % 3; // 0 esquerda, 1 meio, 2 direita
  const [isSpinning, setIsSpinning] = useState(false);
  const [spinGlyph, setSpinGlyph] = useState<Mark | null>(null);
  const chaosGlow = useSharedValue(0); // 0..1 — opacidade do destaque laranja

  useEffect(() => {
    if (!lastChaosRoulette) return;

    setIsSpinning(true);
    chaosGlow.value = withTiming(1, { duration: CHAOS_ROULETTE_FADE_MS });

    const flicker = setInterval(() => {
      // Math.random() de propósito, não o canal do RNG determinístico: é
      // ruído puramente cosmético — os dois clientes de uma partida online
      // podem (e vão) "girar" com padrões diferentes, só o glifo TRAVADO
      // precisa bater, e esse vem do board já sincronizado, não deste timer.
      setSpinGlyph((['X', 'O', null] as const)[Math.floor(Math.random() * 3)]);
    }, CHAOS_ROULETTE_FLICKER_MS);

    const stop = setTimeout(() => {
      clearInterval(flicker);
      setIsSpinning(false);
      setSpinGlyph(null);
      chaosGlow.value = withTiming(0, { duration: CHAOS_ROULETTE_FADE_MS });
    }, CHAOS_ROULETTE_COLUMN_STOP_MS[column]);

    return () => {
      clearInterval(flicker);
      clearTimeout(stop);
      cancelAnimation(chaosGlow);
    };
  }, [lastChaosRoulette?.id, column, chaosGlow]);

  const chaosOverlayStyle = useAnimatedStyle(() => ({ opacity: chaosGlow.value }));

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

  /** Overlay do destaque de VIDENTE. Mesma cor do alvo válido, forma diferente
   * (borda tracejada) — os dois nunca coexistem, mas a leitura fica inequívoca. */
  const visionOverlayStyle = useAnimatedStyle(() => ({
    opacity: interpolate(visionGlow.value, [0, 1], [0.35, 0.9]),
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

    /* --- Trava do giro de TIC TAC BOOM! ------------------------------------
       Trava só de UI, não regra de jogo (AGENTS.md "Invariantes de
       domínio") — o board já é o resultado FINAL desde que a carta
       resolveu, só a apresentação ainda está em curso. Sem `rejectFeedback`:
       o tabuleiro já piscando de laranja comunica "espera" sozinho. */
    if (state.chaosRouletteSpinning) return;

    /* --- Trava de turno do multiplayer ------------------------------------
       Fora do online `isLocalTurn()` é sempre `true`, então isto some para
       os modos local e CPU. No online é a primeira guarda: sem ela, tocar
       fora da própria vez publicaria uma jogada que o oponente recusaria,
       dessincronizando os dois clientes. */
    if (!isLocalTurn()) {
      rejectFeedback();
      return;
    }

    /* --- Trava de presença --------------------------------------------------
       Mesmo raciocínio, eixo diferente: mesmo NA sua vez, jogar com o
       oponente desconectado é escrever numa partida que ele não está mais
       recebendo. O `<OpponentDisconnectedModal />` cobre a tela por cima,
       mas — mesmo padrão de `pendingAcknowledgement` — a guarda existe aqui
       também, e não só no modal, porque um `Modal` cobrindo a tela é a
       primeira linha de defesa, não a única confiável em toda plataforma. */
    if (!isOpponentConnected()) {
      rejectFeedback();
      return;
    }

    /* --- Modo mira intercepta tudo ---------------------------------------
       Com uma interação BOARD_TARGET pendente o toque resolve a carta, nunca
       posiciona peça. */
    if (state.pendingInteraction?.kind === 'BOARD_TARGET') {
      if (!isPendingTarget(state, index)) {
        rejectFeedback();
        return;
      }

      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      // Pela facade da ponte, não pelo store direto: é ela que replica a
      // resolução para o oponente e resolve pelo combatente que este cliente
      // controla (`getLocalCombatant()`, dentro de `netResolveInteraction`).
      if (!netResolveInteraction({ kind: 'BOARD_TARGET', index })) rejectFeedback();
      return;
    }

    /* --- Fluxo normal ----------------------------------------------------- */
    if (!canPlaceAt(state, index, getLocalCombatant())) {
      rejectFeedback();
      return;
    }

    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    netPlaceMark(index);
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

  /** Aliado sempre na cor principal; inimigo sempre na secundária. */
  const colorFor = (owner: Combatant) =>
    owner === localCombatant ? colors.markX : colors.markO;

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
        isHighlightedByVidente,
        isSpinning,
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

        {/* Destaque de TIC TAC BOOM!: sempre montado (opacidade 0 = invisível
            e sem custo) para permitir um fade de SAÍDA de verdade em vez de
            só sumir instantaneamente quando `isSpinning` virar `false`. */}
        <Animated.View style={[styles.chaosRouletteOverlay, chaosOverlayStyle]} pointerEvents="none" />

        {isSpinning ? (
          spinGlyph &&
          (spinGlyph === 'X' ? (
            <MarkX size={size} color={colors.bgDeep} />
          ) : (
            <MarkO size={size} color={colors.bgDeep} />
          ))
        ) : (
          <>
            {isBlocked && <BlockedGlyph size={size} locked={isCardLocked} />}

            {piece && (
              <Animated.View style={markStyle}>
                {/* FORMA pelo símbolo, COR pela aliança.
                    A forma é identidade da peça e tem que bater nos dois
                    aparelhos — trocar X por O deixaria os jogadores descrevendo
                    tabuleiros diferentes um para o outro. Já a cor é linguagem
                    de time: "vermelho é meu, azul é dele" vale para os dois
                    lados, e é o que faz o convidado ler o tabuleiro tão rápido
                    quanto o anfitrião em vez de ter que lembrar que ele é o
                    azul. */}
                {piece.mark === 'X' ? (
                  <MarkX size={size} color={colorFor(piece.owner)} />
                ) : (
                  <MarkO size={size} color={colorFor(piece.owner)} />
                )}
              </Animated.View>
            )}
          </>
        )}

        {/* Alvo válido: moldura pulsando. Desenhada por cima da peça para o
            destaque não competir com o pulso de "vai sumir". Suprimido
            durante o giro: uma célula mostrando glifo falso não tem alvo
            real para destacar ainda. */}
        {!isSpinning && isValidTarget && (
          <Animated.View
            style={[styles.targetOverlay, targetOverlayStyle]}
            pointerEvents="none"
          />
        )}

        {/* Alvo inválido durante a mira: escurece para dirigir o olhar. */}
        {!isSpinning && isTargeting && !isValidTarget && (
          <View style={styles.targetDimmed} pointerEvents="none" />
        )}

        {/* Destaque de VIDENTE: peça mais antiga do oponente, visível só para
            quem jogou a carta (ver `isHighlightedByVidente`). */}
        {!isSpinning && isHighlightedByVidente && (
          <Animated.View style={[styles.visionOverlay, visionOverlayStyle]} pointerEvents="none" />
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

function MarkX({ size, color }: { size: number; color: string }) {
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
              backgroundColor: color,
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

function MarkO({ size, color }: { size: number; color: string }) {
  const outer = Math.round(size * 0.6);
  const ring = Math.round(size * X_BAR_RATIO);

  return (
    <View style={[styles.markBox, { width: size, height: size }]}>
      <View
        style={{
          width: outer,
          height: outer,
          borderWidth: ring,
          borderColor: color,
          // borderRadius 0 de propósito: "O" blocado lê como pixel art.
          borderRadius: 0,
        }}
      />
    </View>
  );
}

/**
 * Marca de célula interditada.
 *
 * `locked` distingue a trava deliberada da carta TRAVAR (uma barra em X,
 * amarela) da interdição aleatória do caos (uma barra simples, vermelha).
 * São efeitos idênticos em regra e opostos em intenção — uma o jogador
 * comprou, a outra caiu na cabeça dele —, e desenhar as duas igual fazia a
 * própria carta do jogador parecer mais azar do terminal.
 */
function BlockedGlyph({ size, locked }: { size: number; locked: boolean }) {
  const bar = Math.round(size * 0.12);
  const length = Math.round(size * 0.55);
  const tone = locked ? colors.winGlow : colors.danger;

  return (
    <View style={[styles.markBox, StyleSheet.absoluteFill]} pointerEvents="none">
      {(locked ? [45, -45] : [0]).map((deg) => (
        <View
          key={deg}
          style={{
            position: 'absolute',
            width: length,
            height: bar,
            backgroundColor: tone,
            opacity: 0.85,
            transform: [{ rotate: `${deg}deg` }],
          }}
        />
      ))}
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
  isHighlightedByVidente: boolean,
  isSpinning: boolean,
): string {
  const row = Math.floor(index / 3) + 1;
  const col = (index % 3) + 1;
  const base = `Linha ${row}, coluna ${col}`;

  if (isSpinning) return `${base}, girando`;

  const target = isValidTarget ? ', alvo válido para a carta' : '';
  const highlight = isHighlightedByVidente ? ', destacada pela VIDENTE' : '';

  if (isBlocked) return `${base}, célula bloqueada${target}`;
  if (!mark) return `${base}, vazia${target}`;
  return `${base}, peça ${mark}${isVanishing ? ', prestes a desaparecer' : ''}${highlight}${target}`;
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
  // Opaco de propósito: durante o giro, cobre completamente o que estiver
  // por baixo (inclusive `surfaceWinning`) — ver comentário na Fase de
  // renderização sobre por que isso resolve a precedência sem branch extra.
  chaosRouletteOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: RARITY_COLOR.BOOM,
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
    // `backgroundColor` chega inline — a cor da peça depende da aliança, não
    // do símbolo. Ver `colorFor`.
  },
  targetOverlay: {
    ...StyleSheet.absoluteFill,
    borderColor: colors.winGlow,
  },
  targetDimmed: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  // Mesma cor do targetOverlay (colors.winGlow), forma diferente — tracejado,
  // não sólido — para não ler como "célula clicável" (ver VISION_PULSE_DURATION).
  visionOverlay: {
    ...StyleSheet.absoluteFill,
    borderWidth: 3,
    borderStyle: 'dashed',
    borderColor: colors.winGlow,
  },
});
