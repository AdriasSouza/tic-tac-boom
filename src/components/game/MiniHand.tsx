import { memo, useMemo } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';

import { getCard } from '@/engine/cards/registry';
import { useResponsiveLayout } from '@/hooks/useResponsiveLayout';
import { selectHandOf, useGameStore, type CardId, type Combatant } from '@/store/gameStore';
import { colors } from '@/theme/colors';
import { RARITY_COLOR } from '@/theme/rarity';

/* -------------------------------------------------------------------------- */
/*                                    PROPS                                    */
/* -------------------------------------------------------------------------- */

export interface MiniHandProps {
  /** De quem é a mão representada. */
  owner: Combatant;
  /**
   * `true` — fichas de FACE ABERTA (inicial do nome + cor da raridade). Use
   * apenas para a mão do combatente LOCAL: são as cartas que este aparelho já
   * mostra por extenso no leque de baixo, então miniaturizá-las não revela
   * nada de novo.
   *
   * `false` — versos genéricos e idênticos. A CONTAGEM da mão é pública (é o
   * que permite ao jogador perceber que o adversário está prestes a estourar o
   * limite ou que ficou sem recurso), mas a IDENTIDADE das cartas continua
   * secreta — é justamente o que ESPIONAGEM/VISÃO ABSOLUTA existem para
   * revelar, e vazá-la aqui esvaziaria essas cartas.
   */
  revealed?: boolean;
  /** Lado da barra de status onde a miniatura mora. Alinha o texto e as fichas. */
  align?: 'left' | 'right';
  style?: StyleProp<ViewStyle>;
}

/* -------------------------------------------------------------------------- */
/*                                  COMPONENTE                                 */
/* -------------------------------------------------------------------------- */

/**
 * Miniatura de uma mão, para a barra de status (linha superior do layout).
 *
 * Substitui o antigo `<OpponentHandZone />`, que era uma faixa de largura
 * total só para o lado do adversário. Duas diferenças que motivaram a troca:
 *
 * 1. **Simetria.** O jogador agora vê as duas mãos no mesmo lugar e no mesmo
 *    formato — a dele à esquerda (junto do próprio HP), a do rival à direita
 *    (junto do HP dele). Comparar "quantas cartas eu tenho contra quantas ele
 *    tem" era uma conta que exigia olhar para dois cantos distintos da tela.
 * 2. **Altura.** A faixa antiga gastava uma linha inteira da coluna vertical,
 *    o recurso mais escasso do layout empilhado — a barra de status já
 *    reservava essa altura de qualquer jeito.
 *
 * `pointerEvents="none"`: puramente informativo. Nem as fichas do adversário
 * (que não são do jogador) nem as próprias (que já são jogáveis no leque de
 * baixo, o único lugar onde a jogada deve poder nascer) devem aceitar toque.
 */
export function MiniHand({ owner, revealed = false, align = 'left', style }: MiniHandProps) {
  const hand = useGameStore(useMemo(() => selectHandOf(owner), [owner]));
  const { miniCardWidth, miniCardHeight } = useResponsiveLayout();

  /* As fichas se sobrepõem em vez de ficarem lado a lado: numa barra que já
     divide a largura com dois medidores de HP e o indicador de turno, uma mão
     cheia em fileira aberta era a diferença entre caber e estourar num celular
     pequeno. Sobrepor também é como uma mão de cartas de verdade se comporta. */
  const overlap = Math.round(miniCardWidth * 0.35);

  return (
    <View style={[styles.root, align === 'right' && styles.rootRight, style]} pointerEvents="none">
      {/* Ocupa a mesma linha do rótulo do `<HpTracker />` vizinho, então este
          texto não custa altura nenhuma à barra. */}
      <Text style={styles.count}>{hand.length}</Text>

      <View style={[styles.chips, { minHeight: miniCardHeight }]}>
        {hand.map(({ uid, cardId }, index) => (
          <MiniCard
            key={uid}
            cardId={revealed ? cardId : null}
            width={miniCardWidth}
            height={miniCardHeight}
            // A primeira ficha não recua; as seguintes deslizam por baixo dela.
            offset={index === 0 ? 0 : -overlap}
          />
        ))}
      </View>
    </View>
  );
}

export default MiniHand;

/* -------------------------------------------------------------------------- */
/*                                    FICHA                                    */
/* -------------------------------------------------------------------------- */

interface MiniCardProps {
  /** `null` = verso fechado (mão do adversário). */
  cardId: CardId | null;
  width: number;
  height: number;
  /** Margem esquerda negativa que produz a sobreposição. */
  offset: number;
}

/**
 * Uma carta reduzida ao mínimo legível: a inicial do nome sobre a cor da
 * raridade. Numa ficha de ~11dp não cabe texto — a cor é o que carrega a
 * informação, e ela já é o mesmo código visual da barrinha lateral do
 * `<CardItem />` no leque de baixo (ver `RARITY_COLOR`), então o jogador não
 * precisa aprender nada novo para ligar uma coisa à outra.
 */
const MiniCard = memo(function MiniCard({ cardId, width, height, offset }: MiniCardProps) {
  const card = cardId ? getCard(cardId) : null;
  const accent = card ? RARITY_COLOR[card.rarity] : colors.boardFrameLight;

  return (
    <Animated.View
      entering={FadeIn.duration(160)}
      exiting={FadeOut.duration(160)}
      style={[
        styles.chip,
        {
          width,
          height,
          marginLeft: offset,
          borderColor: accent,
          backgroundColor: card ? colors.bgPanel : colors.boardFrame,
        },
      ]}
    >
      <Text
        style={[
          styles.chipGlyph,
          { color: card ? accent : colors.winGlow, fontSize: Math.max(6, Math.round(height * 0.6)) },
        ]}
      >
        {card ? card.name.charAt(0) : '?'}
      </Text>
    </Animated.View>
  );
});

/* -------------------------------------------------------------------------- */
/*                                   ESTILOS                                   */
/* -------------------------------------------------------------------------- */

const styles = StyleSheet.create({
  root: {
    alignItems: 'flex-start',
    gap: 6,
    // Nunca espreme: a fileira de fichas tem largura previsível (no máximo
    // `HAND_LIMIT` cartas sobrepostas) e é quem sofreria a deformação mais
    // feia se o flex resolvesse cortá-la por aqui.
    flexShrink: 0,
  },
  rootRight: {
    alignItems: 'flex-end',
  },
  count: {
    color: colors.textDim,
    fontSize: 8,
    fontWeight: '800',
    letterSpacing: 1,
  },
  chips: {
    flexDirection: 'row',
    alignItems: 'flex-end',
  },
  chip: {
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  chipGlyph: {
    fontWeight: '900',
  },
});
