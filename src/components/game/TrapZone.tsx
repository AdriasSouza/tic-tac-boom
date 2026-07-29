import { memo, useMemo } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { FadeInDown, ZoomOut } from 'react-native-reanimated';

import { useResponsiveLayout } from '@/hooks/useResponsiveLayout';
import { TRAP_LIMIT, selectTraps, useGameStore, type Combatant } from '@/store/gameStore';
import { colors } from '@/theme/colors';

/* -------------------------------------------------------------------------- */
/*                                    PROPS                                    */
/* -------------------------------------------------------------------------- */

export interface TrapZoneProps {
  /** De quem são as armadilhas exibidas. */
  owner?: Combatant;
  style?: StyleProp<ViewStyle>;
  /**
   * `'row'` (padrão) — legenda ao lado dos slots, empilhados na horizontal.
   * Layout mobile: a zona ocupa a largura toda, entre o tabuleiro e a mão.
   *
   * `'column'` — legenda em cima, slots empilhados na vertical. Usado só no
   * layout largo (`useResponsiveLayout().isWide`), onde a zona vira uma
   * coluna lateral estreita ao lado do tabuleiro em vez de uma faixa
   * horizontal — a legenda completa ("ARMADILHAS DA CPU") não cabe numa
   * coluna de ~70dp, por isso `orientation="column"` também troca para um
   * rótulo curto.
   */
  orientation?: 'row' | 'column';
}

/* -------------------------------------------------------------------------- */
/*                                  COMPONENTE                                 */
/* -------------------------------------------------------------------------- */

/**
 * Zona de armadilhas — fica entre o tabuleiro e a mão.
 *
 * Mostra os `TRAP_LIMIT` espaços, com as cartas armadas viradas para baixo.
 * Slots vazios continuam desenhados: comunicam quantas armadilhas ainda cabem
 * sem precisar de texto.
 *
 * O rótulo diz de QUEM é a fileira ("SUAS ARMADILHAS" / "ARMADILHAS DA CPU").
 * As duas zonas são visualmente idênticas — mesmos versos, mesmos slots — e um
 * "ARMADILHAS" genérico em cima das duas deixava o jogador sem saber se a
 * carta virada era ameaça ou defesa dele. A cor do rótulo reforça a distinção
 * para quem lê pelo canto do olho.
 *
 * O anúncio de detonação (nome da carta + haptic) morou aqui antes; agora vive
 * no `<AcknowledgementModal />`, que mostra a carta ampliada no centro da tela
 * ANTES do efeito mecânico aplicar — mais visível, e sem duplicar aviso.
 *
 * Só assina as armadilhas do dono, então uma detonando não re-renderiza
 * tabuleiro nem mão.
 */
/** Rótulo por dono no layout empilhado (mobile) — cabe numa faixa larga. */
const CAPTION: Record<Combatant, string> = {
  PLAYER: 'SUAS ARMADILHAS',
  MACHINE: 'ARMADILHAS DA CPU',
};

/** Rótulo por dono no layout em coluna (desktop largo) — precisa ser curto. */
const CAPTION_SHORT: Record<Combatant, string> = {
  PLAYER: 'VOCÊ',
  MACHINE: 'CPU',
};

export function TrapZone({ owner = 'PLAYER', style, orientation = 'row' }: TrapZoneProps) {
  const traps = useGameStore(useMemo(() => selectTraps(owner), [owner]));
  const emptySlots = Math.max(0, TRAP_LIMIT - traps.length);
  const isPlayer = owner === 'PLAYER';
  const isColumn = orientation === 'column';

  // Duas zonas empilhadas somam altura de sobra num celular baixo — elas
  // encolhem junto com o resto para o tabuleiro e a mão não perderem espaço.
  const { trapSlotWidth, trapSlotHeight } = useResponsiveLayout();
  const slotSize = { width: trapSlotWidth, height: trapSlotHeight };

  return (
    <View style={[styles.root, isColumn ? styles.rootColumn : styles.rootRow, style]}>
      <View style={[styles.content, isColumn && styles.contentColumn]}>
        <Text
          style={[styles.caption, isPlayer && styles.captionPlayer, isColumn && styles.captionColumn]}
          // Trava em 1 linha: sem isto, em telas estreitas "ARMADILHAS DA
          // CPU" quebrava para uma segunda linha, e como a legenda e os slots
          // dividem a mesma fileira (`content`, flexDirection:'row'), a
          // quebra fazia a zona INTEIRA crescer de altura — roubando espaço
          // do orçamento apertado da coluna e empurrando o resto (inclusive o
          // tabuleiro) para cima/baixo de forma imprevisível. Truncar aqui
          // (nunca a legenda dita a altura) é o que garante que a zona de
          // armadilhas tenha SEMPRE a mesma altura fixa dos slots.
          numberOfLines={1}
        >
          {isColumn ? CAPTION_SHORT[owner] : CAPTION[owner]}
        </Text>

        <View style={[styles.slots, isColumn && styles.slotsColumn]}>
          {traps.map(({ uid }) => (
            <TrapBack key={uid} size={slotSize} />
          ))}

          {Array.from({ length: emptySlots }, (_, i) => (
            <View key={`empty-${i}`} style={[styles.emptySlot, slotSize]} />
          ))}
        </View>
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
const TrapBack = memo(function TrapBack({ size }: { size: { width: number; height: number } }) {
  return (
    <Animated.View
      entering={FadeInDown.springify().damping(14).mass(0.6)}
      exiting={ZoomOut.duration(240)}
      style={[styles.back, size]}
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
  root: {
    alignItems: 'center',
  },
  // Mobile: faixa horizontal de largura total, entre o tabuleiro e a mão.
  rootRow: {
    width: '100%',
    paddingHorizontal: 16,
    marginVertical: 4,
    // Explícito (mesmo já sendo o padrão do RN para View): a zona de
    // armadilhas é altura FIXA, nunca deve ser ela a ceder espaço quando o
    // orçamento vertical da coluna aperta — quem cede é sempre o `boardArea`
    // flexível em `[mode].tsx`.
    flexShrink: 0,
  },
  // Desktop largo: coluna estreita ao lado do tabuleiro. `alignSelf:'stretch'`
  // faz a zona ocupar a altura toda da fileira central (mesma altura do
  // tabuleiro), e `justifyContent:'center'` centraliza o conteúdo nela.
  rootColumn: {
    alignSelf: 'stretch',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  contentColumn: {
    flexDirection: 'column',
    gap: 8,
  },
  caption: {
    color: colors.textDim,
    fontSize: 7,
    letterSpacing: 1.5,
    fontWeight: '700',
    // Encolhe (e o `numberOfLines={1}` acima trunca com "…") ANTES de
    // deixar a fileira estourar — o vizinho `slots` tem `flexShrink:0`
    // logo abaixo, então entre os dois é sempre a LEGENDA que cede.
    flexShrink: 1,
  },
  captionPlayer: {
    color: colors.markX, // mesma cor da peça do jogador — "isto é seu"
  },
  captionColumn: {
    textAlign: 'center',
  },
  slots: {
    flexDirection: 'row',
    gap: 6,
    // Os slots são a informação principal da zona (quantas armadilhas há e
    // se estão armadas) — nunca podem ser espremidos para abrir espaço para
    // o texto da legenda.
    flexShrink: 0,
  },
  slotsColumn: {
    flexDirection: 'column',
    gap: 6,
  },
  emptySlot: {
    // width/height chegam inline, de `useResponsiveLayout`.
    borderWidth: 2,
    borderStyle: 'dashed',
    // Branco translúcido em vez do marrom escuro da moldura: contra o fundo
    // escuro do painel (e, no layout largo, contra a moldura do tabuleiro
    // ao lado), a cor antiga (`boardFrameShadow`, quase preta) a 50% de
    // opacidade era praticamente invisível — o jogador não conseguia ver
    // quantos espaços de armadilha ainda tinha livres.
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
