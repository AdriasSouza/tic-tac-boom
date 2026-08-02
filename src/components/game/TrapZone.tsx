import { memo, useMemo } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { FadeInDown, ZoomOut } from 'react-native-reanimated';

import { useLayoutMode } from '@/hooks/useLayoutMode';
import { useMatchPerspective } from '@/hooks/useMatchPerspective';
import { TRAP_LIMIT, selectTraps, useGameStore, type Combatant } from '@/store/gameStore';
import { colors } from '@/theme/colors';
import { TRAP_ZONE_BOUNDS } from '@/theme/layout';

/* -------------------------------------------------------------------------- */
/*                                    PROPS                                    */
/* -------------------------------------------------------------------------- */

export interface TrapZoneProps {
  /** De quem são as armadilhas exibidas. */
  owner?: Combatant;
  style?: StyleProp<ViewStyle>;
}

/* -------------------------------------------------------------------------- */
/*                                  COMPONENTE                                 */
/* -------------------------------------------------------------------------- */

/**
 * Zona de armadilhas — sempre uma coluna estreita na lateral do tabuleiro,
 * em QUALQUER tela.
 *
 * Já foi uma faixa horizontal de largura total (empilhada acima/abaixo do
 * board em retrato) e um sidebar só em paisagem. As duas coisas causavam o
 * mesmo problema pelo mesmo motivo: sempre que a zona dividia o eixo
 * VERTICAL com o board (empilhada na mesma coluna flex), ela roubava altura
 * dele — e altura é justamente o recurso escasso em retrato, a orientação
 * mais comum do jogo. Fixar a zona como sidebar SEMPRE tira esse
 * empilhamento do jogo inteiro: ela só compete por LARGURA, que sobra até em
 * celular — e nunca mais é irmã de flex do board na mesma coluna.
 *
 * Mostra os `TRAP_LIMIT` espaços, com as cartas armadas viradas para baixo.
 * Slots vazios continuam desenhados: comunicam quantas armadilhas ainda cabem
 * sem precisar de texto.
 *
 * O rótulo diz de QUEM é a fileira — só "VOCÊ"/"CPU"/"RIVAL", nunca a frase
 * longa ("SUAS ARMADILHAS" etc.) que este componente já teve: numa coluna de
 * 40dp (o modo `compact`) a frase quebra linha ou vaza, mesmo truncada. A cor
 * do rótulo reforça a distinção para quem lê pelo canto do olho.
 *
 * O rótulo fica SEMPRE em cima do bloco de slots, os dois centralizados entre
 * si — colocá-los lado a lado (como antes) tornava o CONJUNTO assimétrico em
 * relação ao próprio centro, porque o texto tem uma largura que os slots não
 * têm; o bloco de slots, que precisa alinhar com o meio do tabuleiro,
 * terminava deslocado pela largura do texto ao lado.
 *
 * O anúncio de detonação (nome da carta + haptic) mora no
 * `<AcknowledgementModal />`, que mostra a carta ampliada no centro da tela
 * ANTES do efeito mecânico aplicar — mais visível, e sem duplicar aviso.
 *
 * Só assina as armadilhas do dono, então uma detonando não re-renderiza
 * tabuleiro nem mão.
 */
export function TrapZone({ owner = 'PLAYER', style }: TrapZoneProps) {
  const traps = useGameStore(useMemo(() => selectTraps(owner), [owner]));
  const emptySlots = Math.max(0, TRAP_LIMIT - traps.length);

  /* O rótulo depende de a fileira ser MINHA ou DELE — não de o dono ser
     `PLAYER`. Numa sala online quem entrou controla o `MACHINE`, e rotular
     pelo combatente absoluto diria "CPU" em cima das próprias armadilhas do
     convidado. */
  const { localCombatant, isOnline } = useMatchPerspective();
  const isLocal = owner === localCombatant;
  const caption = isLocal ? 'VOCÊ' : isOnline ? 'RIVAL' : 'CPU';

  const { mode } = useLayoutMode();
  const { sidebarWidth, slotSize, hitSlop } = TRAP_ZONE_BOUNDS[mode];
  const slotStyle = { width: slotSize, height: slotSize };
  const slotHitSlop = hitSlop > 0 ? hitSlop : undefined;

  return (
    <View style={[styles.root, { width: sidebarWidth }, style]}>
      {/* Sempre acima do bloco de slots, e sempre centralizado em relação a
          ele — nunca ao lado. Ver o porquê no comentário do componente. */}
      <Text
        style={[styles.caption, isLocal && styles.captionPlayer]}
        numberOfLines={1}
      >
        {caption}
      </Text>

      <View style={styles.slots}>
        {traps.map(({ uid }) => (
          <TrapBack key={uid} size={slotStyle} hitSlop={slotHitSlop} />
        ))}

        {Array.from({ length: emptySlots }, (_, i) => (
          <View key={`empty-${i}`} style={[styles.emptySlot, slotStyle]} hitSlop={slotHitSlop} />
        ))}
      </View>
    </View>
  );
}

export default TrapZone;

/* -------------------------------------------------------------------------- */
/*                              VERSO DA CARTA                                 */
/* -------------------------------------------------------------------------- */

/**
 * Verso pixelado. Deliberadamente sem identidade: o oponente não pode saber
 * qual armadilha está armada, então todas as cartas viradas são idênticas.
 *
 * `exiting={ZoomOut}` marca o consumo — a carta some da mesa ao ser revelada
 * (o `<AcknowledgementModal />` assume a partir daí).
 */
const TrapBack = memo(function TrapBack({
  size,
  hitSlop,
}: {
  size: { width: number; height: number };
  hitSlop?: number;
}) {
  return (
    <Animated.View
      entering={FadeInDown.springify().damping(14).mass(0.6)}
      exiting={ZoomOut.duration(240)}
      style={[styles.back, size]}
      hitSlop={hitSlop}
    >
      {/* Bisel chapado, mesma linguagem do resto da UI. */}
      <View style={styles.backBevel} pointerEvents="none" />

      {/* Padrão de hachura: 3 barras diagonais em bloco, sem gradiente. */}
      <View style={styles.backPattern} pointerEvents="none">
        {[0, 1, 2].map((i) => (
          <View key={i} style={[styles.backStripe, { width: size.width * 1.6 }]} />
        ))}
      </View>

      <Text style={styles.backGlyph}>?</Text>
    </Animated.View>
  );
});

/* -------------------------------------------------------------------------- */
/*                                   ESTILOS                                   */
/* -------------------------------------------------------------------------- */

const styles = StyleSheet.create({
  /**
   * `alignItems:'center'` é o que centraliza a legenda EM RELAÇÃO ao bloco de
   * slots logo abaixo — os dois são filhos diretos desta coluna, então o
   * próprio Flexbox garante a simetria sem nenhuma conta manual de largura.
   *
   * `alignSelf:'stretch'` (herdado do pai, que dá `alignItems:'stretch'` na
   * fileira de combate) entrega a ALTURA cheia da linha a esta coluna;
   * `justifyContent:'center'` centraliza os slots (bem mais curtos que essa
   * altura) no meio dela — é o que garante a zona ficar na altura do olhar,
   * alinhada com o meio do tabuleiro, em vez de flutuar encostada no topo.
   *
   * `flexShrink:0`: quem cede espaço quando a tela aperta é sempre o
   * tabuleiro (que sabe se redimensionar sozinho), nunca a zona — um slot
   * espremido deixa de ser legível como slot. A largura vem inline
   * (`sidebarWidth`, por `LayoutMode`), então não há o que encolher aqui de
   * qualquer forma.
   */
  root: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    flexShrink: 0,
  },
  caption: {
    color: colors.textDim,
    fontSize: 7,
    letterSpacing: 1.5,
    fontWeight: '700',
    textAlign: 'center',
  },
  captionPlayer: {
    color: colors.markX, // mesma cor da peça do jogador — "isto é seu"
  },
  slots: {
    flexDirection: 'column',
    gap: 6,
  },
  emptySlot: {
    // width/height chegam inline, de `TRAP_ZONE_BOUNDS`.
    borderWidth: 2,
    borderStyle: 'dashed',
    // Branco translúcido em vez do marrom escuro da moldura: contra o fundo
    // escuro do painel (e a moldura do tabuleiro ao lado), a cor antiga
    // (`boardFrameShadow`, quase preta) a 50% de opacidade era praticamente
    // invisível — o jogador não conseguia ver quantos espaços ainda tinha.
    borderColor: 'rgba(255, 255, 255, 0.25)',
  },
  back: {
    backgroundColor: colors.boardFrame,
    borderWidth: 2,
    borderColor: colors.boardFrameLight,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  backBevel: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 2,
    backgroundColor: 'rgba(255,255,255,0.16)',
  },
  backPattern: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    opacity: 0.35,
  },
  backStripe: {
    height: 4,
    backgroundColor: colors.boardFrameShadow,
    transform: [{ rotate: '-45deg' }],
  },
  backGlyph: {
    color: colors.winGlow,
    fontSize: 18,
    fontWeight: '900',
  },
});
