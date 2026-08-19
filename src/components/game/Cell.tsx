import * as Haptics from 'expo-haptics';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
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

import { playSound } from '@/audio/soundEngine';
import { useMatchPerspective } from '@/hooks/useMatchPerspective';
import { useIsLocalTurn } from '@/hooks/useLocalTurn';
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
  selectEnergy,
  selectForcedVanish,
  selectHighlightedOldest,
  selectIsBlocked,
  selectIsCardLocked,
  selectIsChaosRouletteSpinning,
  selectIsTargeting,
  selectIsValidTarget,
  selectIsVanishing,
  selectIsWinningCell,
  selectLastChaosRoulette,
  selectLastVanishedIndex,
  selectTargetingCaster,
  useGameStore,
  CHAOS_ROULETTE_COLUMN_STOP_MS,
  CHAOS_ROULETTE_FADE_MS,
  CHAOS_ROULETTE_FLICKER_DECEL_MS,
  CHAOS_ROULETTE_FLICKER_MS,
  MARK_BY_COMBATANT,
  PLACEMENT_COST,
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
  // Global, não por-célula: liga só quando a ÚLTIMA coluna do giro parou —
  // ver o comentário na seção do giro de TIC TAC BOOM! abaixo.
  const chaosRouletteSpinning = useGameStore(selectIsChaosRouletteSpinning);
  const isTargeting = useGameStore(selectIsTargeting);
  // Define qual peça é "minha" para efeito de cor — ver `colorFor`.
  const { localCombatant, isOnline } = useMatchPerspective();
  const targetingCaster = useGameStore(selectTargetingCaster);
  /**
   * Fase 8b: colocar peça passa a custar `PLACEMENT_COST`, então "não dá pra
   * colocar aqui agora, falta energia" precisa de ALGUM sinal — o mais
   * barato possível, reaproveitando o MESMO mecanismo de esmaecimento que
   * `CardItem.tsx` já usa pra `canAfford` (`cardDisabled: {opacity:0.55}`,
   * puro `StyleSheet` condicional, nenhuma animação nova). Global, não
   * por-célula (mesmo padrão de `chaosRouletteSpinning`/`isTargeting` acima):
   * as 9 células compartilham a mesma resposta pra "é meu turno e tenho
   * energia?". Só esmaece célula VAZIA — uma célula ocupada não tem
   * affordance de colocação pra começo de conversa.
   */
  const isMyTurn = useIsLocalTurn();
  const localEnergy = useGameStore(useMemo(() => selectEnergy(localCombatant), [localCombatant]));
  const showsUnaffordable = !piece && isMyTurn && localEnergy < PLACEMENT_COST;
  /**
   * Brilho de "alvo válido" — informação TÁTICA (qual peça está em jogo,
   * quais destinos ela pode tomar), não só "qual carta" (isso já é anunciado
   * pra ambos via `CARD_PLAYED`, ver `gameStore.ts`). No online, só acende
   * no tabuleiro de quem É o caster da mira — mesmo racional já usado pelo
   * destaque de VIDENTE logo abaixo (`isHighlightedByVidente`). O motor já
   * recusa um toque do lado errado (`resolveInteraction`/`cancelInteraction`,
   * `caster !== combatant`) — isto aqui é só a UI parando de convidar o toque
   * que o motor ia rejeitar de qualquer forma.
   */
  const isValidTarget =
    useGameStore(useMemo(() => selectIsValidTarget(index), [index])) &&
    (!isOnline || targetingCaster === localCombatant);

  /**
   * VIDENTE: "só para quem jogou" só faz sentido gatear por IDENTIDADE fixa
   * (`localCombatant`) no ONLINE, onde os dois lados são aparelhos
   * fisicamente separados. Fora do online (CPU/Clássico, um único humano no
   * aparelho) o destaque já só existe enquanto é o turno de quem o lançou
   * (ver limpeza em `placeMark`/`endTurn`), então mostrar sempre que estiver
   * aceso é seguro e correto — esconder não protegeria nada.
   */
  const highlighted = useGameStore(selectHighlightedOldest);
  const isHighlightedByVidente =
    highlighted?.index === index && (!isOnline || highlighted.caster === localCombatant);

  /**
   * AMALDIÇOAR (`mode: 'CHOSEN'`) e ANOMALIA (`mode: 'RANDOM'`): o dono das
   * peças (`forcedVanish.owner === localCombatant`) precisa SENTIR que uma
   * delas está condenada, sem saber QUAL — mesma dúvida visual nas duas
   * cartas, mesmo campo (`forcedVanish`). Ao contrário do destaque de
   * VIDENTE (que aponta a peça real só para o caster), aqui nenhuma célula
   * lê `forcedVanish.index`. Toda peça PRÓPRIA do dono é candidata igual; o
   * flicker (efeito abaixo) decide, localmente e sem RNG determinístico,
   * quais acendem a cada instante.
   */
  const forcedVanish = useGameStore(selectForcedVanish);
  const isDoubtCandidate =
    !!piece &&
    piece.owner === localCombatant &&
    (forcedVanish?.mode === 'CHOSEN' || forcedVanish?.mode === 'RANDOM') &&
    forcedVanish.owner === localCombatant;

  /* --- Shared values (rodam na UI thread, zero re-render) ----------------- */
  const pulse = useSharedValue(1); // 1 = opaco, 0 = quase apagado
  const press = useSharedValue(0); // 0 = solto, 1 = pressionado
  const pop = useSharedValue(piece ? 1 : 0); // animação de entrada da peça
  const shake = useSharedValue(0); // tremida de jogada inválida
  const targetGlow = useSharedValue(0); // 0..1 — pisca-pisca de alvo válido
  const visionGlow = useSharedValue(0); // 0..1 — glow do destaque de VIDENTE
  const doubtGlow = useSharedValue(0); // 0..1 — flicker ambíguo de AMALDIÇOAR
  const winPulse = useSharedValue(0); // 0..1 — brilho intermitente ao revelar linha do TIC TAC BOOM!
  const clearShake = useSharedValue(0); // tremida ao limpar um bloqueio (LIMPAR/PURIFICAR)
  const clearFade = useSharedValue(1); // opacidade do glifo de bloqueio saindo
  const lockShake = useSharedValue(0); // tremida de entrada ao travar uma célula nova (TRAVAR)
  const vanishFade = useSharedValue(1); // opacidade+escala da peça sumindo (overflow/DEMOLIR/ANOMALIA)

  // Leitura sempre fresca de `isWinning` dentro do timer do giro (abaixo) sem
  // precisar listar `isWinning` nas deps daquele efeito — ele é reagendado só
  // por `lastChaosRoulette?.id`/`column`, e `winningLine` já está decidido
  // (síncrono, no mesmo `set()` que abre o giro) muito antes deste timer
  // dispensar, então o valor não teria como mudar no meio do caminho de
  // qualquer forma; a ref só evita a dependência supérflua.
  const isWinningRef = useRef(isWinning);
  isWinningRef.current = isWinning;

  /** Estado da borda ANTERIOR de bloqueio/trava, para o efeito de
   * shake+fade/shake-de-entrada abaixo detectar a transição sem depender de
   * saber QUAL carta causou a mudança — `<Cell />` só vê o fato (bloqueada ou
   * não), nunca a carta (LIMPAR/PURIFICAR/TRAVAR/surto de caos revertendo). */
  const prevBlockRef = useRef({ blocked: isBlocked, locked: isCardLocked });
  /** Glifo de bloqueio em saída (depois de limpo) — precisa continuar
   * montado por cima do fade/shake antes de sumir de vez. */
  const [exitingGlyph, setExitingGlyph] = useState<{ locked: boolean } | null>(null);
  /** Peça em saída (depois de sumir) — mesma ideia de `exitingGlyph`, mas
   * pra peça em vez do glifo de bloqueio. */
  const [exitingPiece, setExitingPiece] = useState<{ owner: Combatant } | null>(null);

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

  /** --- Flicker ambíguo de AMALDIÇOAR -------------------------------------
   * `Math.random()` de propósito, não o canal do RNG determinístico — mesmo
   * racional do flicker de TIC TAC BOOM! (`Cell.tsx`, giro abaixo): ruído
   * puramente cosmético que não carrega informação real (a peça VERDADEIRA
   * marcada nunca é lida aqui, só `forcedVanish.owner`/`.mode`), então os
   * dois clientes de uma partida online podem piscar em padrões diferentes
   * sem nenhum risco de dessincronia — não é estado de jogo, é só dúvida. */
  useEffect(() => {
    if (!isDoubtCandidate) {
      cancelAnimation(doubtGlow);
      doubtGlow.value = withTiming(0, { duration: 160 });
      return;
    }

    const flicker = setInterval(() => {
      const lit = Math.random() < 0.4;
      doubtGlow.value = withTiming(lit ? 1 : 0, { duration: 220 });
    }, 450);

    return () => {
      clearInterval(flicker);
      cancelAnimation(doubtGlow);
    };
  }, [isDoubtCandidate, doubtGlow]);

  /** --- LIMPAR/PURIFICAR (saída) e TRAVAR (entrada) ------------------------
   * Uma única transição de borda por chamada — `isBlocked`/`isCardLocked` são
   * booleans PUROS (o motor não diz "foi a carta X"), então a UI só reage à
   * MUDANÇA em si: bloqueio caindo treme+esmaece o glifo antigo antes de
   * desmontar (cobre LIMPAR, PURIFICAR e o surto de caos revertendo sozinho —
   * visualmente é o MESMO evento, uma célula deixando de estar interditada);
   * `isCardLocked` subindo treme a entrada (só TRAVAR liga esse boolean). */
  useEffect(() => {
    const prev = prevBlockRef.current;
    prevBlockRef.current = { blocked: isBlocked, locked: isCardLocked };

    if (!prev.blocked && isBlocked) {
      // Bloqueio NOVO: garante o glifo visível de novo, mesmo que a célula já
      // tivesse acabado de sumir num ciclo anterior (`clearFade` ficaria em 0).
      cancelAnimation(clearFade);
      clearFade.value = 1;
    }

    if (prev.blocked && !isBlocked) {
      setExitingGlyph({ locked: prev.locked });
      clearShake.value = withSequence(
        withTiming(-5, { duration: 45 }),
        withTiming(5, { duration: 45 }),
        withTiming(-3, { duration: 45 }),
        withTiming(0, { duration: 45 }),
      );
      clearFade.value = withTiming(0, { duration: 220 });
      const timer = setTimeout(() => setExitingGlyph(null), 260);
      return () => clearTimeout(timer);
    }

    if (!prev.locked && isCardLocked) {
      lockShake.value = withSequence(
        withTiming(-6, { duration: 50 }),
        withTiming(6, { duration: 50 }),
        withTiming(-4, { duration: 50 }),
        withTiming(4, { duration: 50 }),
        withTiming(0, { duration: 50 }),
      );
    }
  }, [isBlocked, isCardLocked, clearFade, clearShake, lockShake]);

  /** --- Peça sumindo (overflow natural, DEMOLIR, ANOMALIA/RANDOM_FADE) -----
   * `lastVanishedIndex` já carrega o `owner` da peça que sumiu (capturado no
   * motor ANTES de nulificar a célula, ver `rules.ts`) — a UI não precisa
   * "lembrar" a última peça vista aqui, só comparar o índice e desenhar um
   * glifo fantasma saindo por cima do vazio que o `board` já mostra. */
  const lastVanishedIndex = useGameStore(selectLastVanishedIndex);
  useEffect(() => {
    if (lastVanishedIndex?.index !== index) return;

    setExitingPiece({ owner: lastVanishedIndex.owner });
    vanishFade.value = 1;
    vanishFade.value = withTiming(0, { duration: 260, easing: Easing.in(Easing.quad) });
    const timer = setTimeout(() => setExitingPiece(null), 280);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- só o `id` decide se é um evento NOVO
  }, [lastVanishedIndex?.id, index, vanishFade]);

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
  const spinRoll = useSharedValue(0); // 0..1 — "queda" do glifo entrando, reforça a sensação de rolo

  useEffect(() => {
    if (!lastChaosRoulette) return;

    setIsSpinning(true);
    chaosGlow.value = withTiming(1, { duration: CHAOS_ROULETTE_FADE_MS });

    const stopAt = CHAOS_ROULETTE_COLUMN_STOP_MS[column];
    const startedAt = Date.now();
    let flickerTimer: ReturnType<typeof setTimeout>;

    /**
     * Cadência que DESACELERA conforme a coluna se aproxima do próprio
     * horário de travar (um `setTimeout` que se reagenda, não mais um
     * `setInterval` de cadência fixa) — sensação de "rolo caindo até parar"
     * em vez de um flicker constante que corta seco. `Date.now()` de
     * propósito, não o canal do RNG determinístico: é ritmo puramente
     * cosmético — os dois clientes de uma partida online podem (e vão)
     * "girar" em ritmos levemente diferentes, só o glifo TRAVADO precisa
     * bater, e esse vem do board já sincronizado (`piece`), não deste timer.
     */
    const scheduleNextFlicker = () => {
      const elapsed = Date.now() - startedAt;
      const remaining = stopAt - elapsed;
      if (remaining <= CHAOS_ROULETTE_FLICKER_MS) return; // perto demais do fim — deixa o `stop` abaixo travar
      const progress = Math.min(1, elapsed / stopAt);
      const delay = CHAOS_ROULETTE_FLICKER_MS + progress * progress * CHAOS_ROULETTE_FLICKER_DECEL_MS;
      flickerTimer = setTimeout(() => {
        setSpinGlyph((['X', 'O', null] as const)[Math.floor(Math.random() * 3)]);
        spinRoll.value = 0;
        spinRoll.value = withTiming(1, { duration: 90 });
        scheduleNextFlicker();
      }, delay);
    };
    scheduleNextFlicker();

    const stop = setTimeout(() => {
      clearTimeout(flickerTimer);
      setIsSpinning(false);
      setSpinGlyph(null);
      chaosGlow.value = withTiming(0, { duration: CHAOS_ROULETTE_FADE_MS });
    }, stopAt);

    /* --- Brilho intermitente da linha vencedora --------------------------
       Agendado pela ÚLTIMA coluna (`[2]`), não a própria — cada célula sabe
       exatamente quando o giro INTEIRO (não só a própria coluna) terminou,
       sem depender de `chaosRouletteSpinning` como dependência de efeito (o
       store já cuida de desligá-lo nesse mesmo instante, ver
       `scheduleChaosRouletteUnlock`). Só pulsa se ESTA célula acabou fazendo
       parte da linha — `isWinningRef` porque o efeito não está listado por
       `isWinning` (ver comentário na declaração da ref). */
    const winReveal = setTimeout(() => {
      if (!isWinningRef.current) return;
      winPulse.value = withSequence(
        withTiming(1, { duration: 140 }),
        withTiming(0.15, { duration: 140 }),
        withTiming(1, { duration: 140 }),
        withTiming(0.15, { duration: 140 }),
        withTiming(0, { duration: 220 }),
      );
    }, CHAOS_ROULETTE_COLUMN_STOP_MS[2]);

    return () => {
      clearTimeout(flickerTimer);
      clearTimeout(stop);
      clearTimeout(winReveal);
      cancelAnimation(chaosGlow);
      cancelAnimation(winPulse);
      cancelAnimation(spinRoll);
    };
  }, [lastChaosRoulette?.id, column, chaosGlow, winPulse, spinRoll]);

  const chaosOverlayStyle = useAnimatedStyle(() => ({ opacity: chaosGlow.value }));
  const winPulseOverlayStyle = useAnimatedStyle(() => ({ opacity: winPulse.value }));
  const spinRollStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: interpolate(spinRoll.value, [0, 1], [-8, 0]) }],
  }));

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

  const vanishStyle = useAnimatedStyle(() => ({
    opacity: vanishFade.value,
    transform: [{ scale: interpolate(vanishFade.value, [0, 1], [0.5, 1]) }],
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

  /** Overlay do flicker ambíguo de AMALDIÇOAR. Tom "danger" (vermelho fraco)
   * — distinto do dourado de VIDENTE/alvo válido de propósito: aqui não é
   * uma pista boa, é um aviso incerto. */
  const doubtOverlayStyle = useAnimatedStyle(() => ({
    opacity: interpolate(doubtGlow.value, [0, 1], [0, 0.5]),
  }));

  /** Glifo de bloqueio (LIMPAR/PURIFICAR saindo, TRAVAR entrando) — os dois
   * tremores nunca coexistem no tempo (um é saída, o outro é entrada), então
   * somar os dois `translateX` num transform só é seguro. */
  const blockGlyphStyle = useAnimatedStyle(() => ({
    opacity: clearFade.value,
    transform: [{ translateX: clearShake.value + lockShake.value }],
  }));

  /* --- Interação ----------------------------------------------------------- */

  const rejectFeedback = useCallback(() => {
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    playSound('NOTIFY_ERROR');
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
      playSound('TAP_MEDIUM');
      // Pela facade da ponte, não pelo store direto: é ela que replica a
      // resolução para o oponente e resolve pelo combatente que este cliente
      // controla (`getLocalCombatant()`, dentro de `netResolveInteraction`).
      if (!netResolveInteraction({ kind: 'BOARD_TARGET', index })) rejectFeedback();
      return;
    }

    /* --- 2º passo de DESLIZAR ----------------------------------------------
       Mesma UI de mira do BOARD_TARGET, `kind` diferente — a célula de
       destino já vem restrita a `pending.eligibleIndexes` (vizinhos vazios
       calculados no 1º passo), `isPendingTarget` cobre os dois `kind`s. */
    if (state.pendingInteraction?.kind === 'PICK_BOARD_CELL') {
      if (!isPendingTarget(state, index)) {
        rejectFeedback();
        return;
      }

      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      playSound('TAP_MEDIUM');
      if (!netResolveInteraction({ kind: 'PICK_BOARD_CELL', index })) rejectFeedback();
      return;
    }

    /* --- Fluxo normal ----------------------------------------------------- */
    if (!canPlaceAt(state, index, getLocalCombatant())) {
      rejectFeedback();
      return;
    }

    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    playSound('TAP_MEDIUM');
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
      style={[{ width: size, height: size }, showsUnaffordable && styles.cellUnaffordable]}
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
          // Gateado por `!chaosRouletteSpinning` (flag GLOBAL, não a própria
          // coluna desta célula): sem isto, uma célula da coluna 0 revelava o
          // dourado assim que SUA coluna parava (900ms), até 1.6s antes da
          // coluna 2 — a linha "fechava" visualmente cedo demais, antes do
          // giro inteiro acabar. `chaosRouletteSpinning` só cai quando a
          // ÚLTIMA coluna para (`scheduleChaosRouletteUnlock`), então gatear
          // por ele sincroniza a revelação com o fim de verdade do giro —
          // sem custo fora do TIC TAC BOOM!, onde já nasce `false`.
          isWinning && !chaosRouletteSpinning && styles.surfaceWinning,
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

        {/* Brilho intermitente ao revelar a linha vencedora do TIC TAC BOOM!
            — alguns pulsos por cima do dourado estático, depois assenta,
            para dar a impressão de "sequência sorteada" em vez de só acender
            e ficar parado. Sempre montado (mesma razão do overlay acima);
            só anima de verdade quando o timer da última coluna dispara. */}
        <Animated.View style={[styles.winPulseOverlay, winPulseOverlayStyle]} pointerEvents="none" />

        {isSpinning ? (
          spinGlyph && (
            <Animated.View style={spinRollStyle}>
              {spinGlyph === 'X' ? (
                <MarkX size={size} color={colors.bgDeep} />
              ) : (
                <MarkO size={size} color={colors.bgDeep} />
              )}
            </Animated.View>
          )
        ) : (
          <>
            {(isBlocked || exitingGlyph) && (
              <Animated.View style={[StyleSheet.absoluteFill, blockGlyphStyle]} pointerEvents="none">
                <BlockedGlyph size={size} locked={isBlocked ? isCardLocked : (exitingGlyph?.locked ?? false)} />
              </Animated.View>
            )}

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

            {/* Peça em saída: a célula real já está vazia (`piece` é `null`
                aqui) — este é só o fantasma dela esmaecendo por cima, no
                mesmo lugar centralizado que a peça de verdade ocupava (a
                mesma centralização por flex de `styles.surface`, sem estilo
                de posicionamento próprio). */}
            {!piece && exitingPiece && (
              <Animated.View style={vanishStyle} pointerEvents="none">
                {MARK_BY_COMBATANT[exitingPiece.owner] === 'X' ? (
                  <MarkX size={size} color={colorFor(exitingPiece.owner)} />
                ) : (
                  <MarkO size={size} color={colorFor(exitingPiece.owner)} />
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

        {/* Flicker ambíguo de AMALDIÇOAR: acende sem nunca apontar a peça
            real (ver `isDoubtCandidate`). */}
        {!isSpinning && isDoubtCandidate && (
          <Animated.View style={[styles.doubtOverlay, doubtOverlayStyle]} pointerEvents="none" />
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
  // Mesmo valor de `cardDisabled` em `CardItem.tsx` — mesmo sinal visual de
  // "não dá pra pagar agora", reaproveitado aqui pra colocação de peça
  // (Fase 8b). Só `opacity`: não muda largura/altura/padding, então não
  // toca o orçamento de layout do `<Board />`.
  cellUnaffordable: {
    opacity: 0.55,
  },
  surface: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  surfaceWinning: {
    backgroundColor: colors.winGlow,
  },
  // Camada própria por cima de `surfaceWinning` — anima só a OPACIDADE do
  // brilho intermitente (`winPulse`), sem interferir no fundo estático.
  winPulseOverlay: {
    ...StyleSheet.absoluteFill,
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
  doubtOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: colors.danger,
  },
});
