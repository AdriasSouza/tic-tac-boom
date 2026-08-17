import { memo, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { FadeInDown, ZoomOut } from 'react-native-reanimated';

import { CardFocusModal } from '@/components/ui/CardFocusModal';
import { useLayoutMode } from '@/hooks/useLayoutMode';
import { useMatchPerspective } from '@/hooks/useMatchPerspective';
import { getCard } from '@/engine/cards/registry';
import type { CardId } from '@/engine/cards/definitions';
import {
  TRAP_LIMIT,
  selectTraps,
  useGameStore,
  type Combatant,
} from '@/store/gameStore';
import { colors } from '@/theme/colors';
import { TRAP_ZONE_BOUNDS } from '@/theme/layout';
import { RARITY_COLOR } from '@/theme/rarity';

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
  const { localCombatant, isOnline, controlledCombatants } = useMatchPerspective();
  const isLocal = owner === localCombatant;
  const caption = isLocal ? 'VOCÊ' : isOnline ? 'RIVAL' : 'CPU';

  /**
   * Quem arma uma armadilha sabe o que armou — o segredo é só em relação ao
   * OPONENTE, então a face fica visível pro próprio dono. `controlledCombatants`
   * (ver `useMatchPerspective`) já resolve isso: CPU/online controlam 1 lado
   * só → a própria face aparece sempre, a do outro lado nunca (evita vazar a
   * armadilha da IA quando é a vez dela).
   */
  const isFaceVisible = controlledCombatants.includes(owner);

  const { mode } = useLayoutMode();
  const { sidebarWidth, slotSize, hitSlop } = TRAP_ZONE_BOUNDS[mode];
  const slotStyle = { width: slotSize, height: slotSize };
  const slotHitSlop = hitSlop > 0 ? hitSlop : undefined;

  /**
   * Consulta só-leitura de uma armadilha PRÓPRIA já armada (patch pós-Fase
   * 7a) — "dar uma espiada" na carta virada na mesa, pra quem esqueceu o que
   * armou. Só possível quando `isFaceVisible` (é exatamente "é minha").
   */
  const [focusedCardId, setFocusedCardId] = useState<CardId | null>(null);

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
        {traps.map(({ uid, cardId }) => (
          <TrapSlot
            key={uid}
            cardId={cardId}
            faceVisible={isFaceVisible}
            size={slotStyle}
            hitSlop={slotHitSlop}
            onPress={isFaceVisible ? () => setFocusedCardId(cardId) : undefined}
          />
        ))}

        {Array.from({ length: emptySlots }, (_, i) => (
          <View key={`empty-${i}`} style={[styles.emptySlot, slotStyle]} hitSlop={slotHitSlop} />
        ))}
      </View>

      {focusedCardId && (
        <CardFocusModal cardId={focusedCardId} readOnly onCancel={() => setFocusedCardId(null)} />
      )}
    </View>
  );
}

export default TrapZone;

/* -------------------------------------------------------------------------- */
/*                              VERSO DA CARTA                                 */
/* -------------------------------------------------------------------------- */

/**
 * Slot de armadilha armada — UM componente persistente pros dois estados
 * (verso e face), nunca dois componentes escolhidos condicionalmente.
 *
 * Isso importa porque `faceVisible` pode mudar sozinho durante a partida
 * (a perspectiva de quem olha, ver `useMatchPerspective`) sem a armadilha em
 * si ser armada ou detonada de novo — se verso/face fossem elementos de tipos DIFERENTES na
 * mesma `key`, o React desmontaria/remontaria a cada troca, disparando
 * `entering`/`exiting` (`FadeInDown`/`ZoomOut`) num flicker que deveria só
 * acontecer ao armar/detonar de verdade. Aqui só o CONTEÚDO interno troca —
 * o `Animated.View` externo (e a caixa que ele mede) é sempre o mesmo.
 *
 * Verso: hachura + "?", sem identidade — o oponente não pode saber qual
 * armadilha está armada. Face: glifo da inicial do nome, colorido pela
 * raridade — visível só pro dono (`faceVisible`, decidido pelo `<TrapZone />`
 * via `controlledCombatants`, ver `useMatchPerspective`). Sem nome/custo por
 * extenso: o slot é pequeno demais (32dp em compact) pra caber texto legível.
 *
 * `exiting={ZoomOut}` marca o consumo — a carta some da mesa ao ser revelada
 * (o `<AcknowledgementModal />` assume a partir daí).
 */
const TrapSlot = memo(function TrapSlot({
  cardId,
  faceVisible,
  size,
  hitSlop,
  onPress,
}: {
  cardId: CardId;
  faceVisible: boolean;
  size: { width: number; height: number };
  hitSlop?: number;
  /** Consulta só-leitura (patch pós-Fase 7a) — `undefined` quando não é
   * consultável agora (armadilha do OPONENTE — ver `isFaceVisible` em
   * `<TrapZone />`). */
  onPress?: () => void;
}) {
  const card = getCard(cardId);

  const content = (
    <Animated.View
      entering={FadeInDown.springify().damping(14).mass(0.6)}
      exiting={ZoomOut.duration(240)}
      style={[styles.back, size]}
      hitSlop={onPress ? undefined : hitSlop}
    >
      {/* Bisel chapado, mesma linguagem do resto da UI — compartilhado pelos
          dois estados. */}
      <View style={styles.backBevel} pointerEvents="none" />

      {faceVisible ? (
        <Text style={[styles.faceGlyph, { color: RARITY_COLOR[card.rarity] }]}>
          {card.name.charAt(0)}
        </Text>
      ) : (
        <>
          {/* Padrão de hachura: 3 barras diagonais em bloco, sem gradiente. */}
          <View style={styles.backPattern} pointerEvents="none">
            {[0, 1, 2].map((i) => (
              <View key={i} style={[styles.backStripe, { width: size.width * 1.6 }]} />
            ))}
          </View>

          <Text style={styles.backGlyph}>?</Text>
        </>
      )}
    </Animated.View>
  );

  // Sem `onPress`, devolve exatamente como antes — nenhum `Pressable` extra
  // no meio pra armadilha do oponente (nunca consultável).
  if (!onPress) return content;

  return (
    <Pressable onPress={onPress} hitSlop={hitSlop}>
      {content}
    </Pressable>
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
  // Cor chega inline (RARITY_COLOR[card.rarity]) — o glifo em si é neutro.
  faceGlyph: {
    fontSize: 18,
    fontWeight: '900',
  },
});
