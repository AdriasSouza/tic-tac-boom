import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { CardFocusModal } from '@/components/ui/CardFocusModal';
import { getCard } from '@/engine/cards/registry';
import { useResponsiveLayout } from '@/hooks/useResponsiveLayout';
import {
  opponentOf,
  selectFullIntelRevealFor,
  selectHandOf,
  selectRevealedUids,
  useGameStore,
  type CardId,
  type Combatant,
} from '@/store/gameStore';
import { colors } from '@/theme/colors';
import { RARITY_COLOR } from '@/theme/rarity';

/* -------------------------------------------------------------------------- */
/*                                  CONSTANTES                                 */
/* -------------------------------------------------------------------------- */

/** Folga real entre slots — nunca sobrepõem, ao contrário do antigo `<MiniHand />`. */
const SLOT_GAP = 4;

/** Duração da saída (jogar) e da entrada (comprar), em ms. */
const EXIT_DURATION = 220;
const ENTER_DURATION = 200;

/** Quantos slots cabem sem precisar rolar — a partir daqui, scroll horizontal. */
const VISIBLE_SLOTS = 5;

/* -------------------------------------------------------------------------- */
/*                                    PROPS                                    */
/* -------------------------------------------------------------------------- */

export interface HandTrackerProps {
  /** De quem é a mão rastreada. */
  owner: Combatant;
  /**
   * `true` — mão LOCAL: sempre mostra a face (o leque de baixo já mostra
   * essas cartas por extenso). `revealedUids` ainda é consultado para o
   * DESTAQUE (ver `exposed` em `TrackerSlot`) — "isto o oponente já viu".
   *
   * `false` — mão do oponente: face só na carta cujo `uid` está em
   * `revealedUids` (ver ESPIADA em `registry.ts`); as demais mostram verso.
   */
  revealed?: boolean;
  style?: StyleProp<ViewStyle>;
}

interface DisplayCard {
  uid: string;
  cardId: CardId;
  exiting: boolean;
  /**
   * Congelado no instante em que a reconciliação detecta que o `uid` saiu da
   * mão viva — a partir daí a animação de saída usa ISTO, nunca mais
   * reconsulta `revealedUids`/a mão viva. Sem isto, uma checagem ao vivo que
   * dependesse de "o uid ainda está na mão" confundiria "saiu da mão" com
   * "deixou de ser revelada": no frame em que o store já não tem mais o uid,
   * essa checagem voltaria `false` e a carta revelada piscaria pra verso no
   * instante em que sai — exatamente quando a informação mais importa.
   */
  snapshot?: { faceUp: boolean; exposed: boolean };
}

/* -------------------------------------------------------------------------- */
/*                                  COMPONENTE                                 */
/* -------------------------------------------------------------------------- */

/**
 * Sucessor do `<MiniHand />`: fichas SEM sobreposição, para que a POSIÇÃO de
 * cada uma carregue identidade (ver o modelo de dados nos comentários de
 * `playerRevealedUids`/`revealedKeyFor` em `rules.ts`). Mora dentro do
 * `trackerHeader` do `<HpTracker />`, à direita do rótulo VOCÊ/CPU.
 *
 * Mantém uma lista LOCAL (`displayList`) reconciliada contra a mão do store,
 * em vez de renderizar `hand` direto — é o que permite a saída (jogar) e a
 * reorganização dos vizinhos acontecerem em SEQUÊNCIA, não ao mesmo tempo: um
 * `uid` que sumiu da mão não é removido daqui na hora, continua montado e
 * "encolhendo" (largura+margem animando a zero) por `EXIT_DURATION`, e só sai
 * de fato da lista local quando essa animação termina — os vizinhos só
 * deslizam para o lugar dele NESSE ritmo, acoplados à própria animação de
 * saída, nunca antes dela. Isto é deliberadamente diferente do `<CardHand />`
 * (lá a reorganização é concorrente com o fade — a ordem das cartas do
 * jogador não é informação secreta; aqui a posição É a informação).
 *
 * Uma carta nova (compra) sempre entra no fim da lista local — mesmo extremo
 * fixo que `drawCardsFor`/`HAND_SWAP` já usam para inserir no array da mão
 * no store (nunca no meio) — e aparece com um crescimento de largura
 * simétrico ao da saída.
 */
export function HandTracker({ owner, revealed = false, style }: HandTrackerProps) {
  const hand = useGameStore(useMemo(() => selectHandOf(owner), [owner]));
  const revealedUids = useGameStore(useMemo(() => selectRevealedUids(owner), [owner]));
  const fullIntelRevealFor = useGameStore(selectFullIntelRevealFor);
  // VISÃO ABSOLUTA: campo PRÓPRIO, com prazo — deliberadamente separado de
  // `revealedUids` (ESPIADA/ESPIONAGEM, sem prazo, por `uid`). `true` quando
  // ALGUÉM revelou a mão DESTE `owner` e essa janela ainda está aberta.
  const fullIntelActive = fullIntelRevealFor !== null && opponentOf(fullIntelRevealFor) === owner;
  const { miniCardWidth, miniCardHeight, handTrackerRowHeight } = useResponsiveLayout();

  const [displayList, setDisplayList] = useState<DisplayCard[]>(() =>
    hand.map(({ uid, cardId }) => ({ uid, cardId, exiting: false })),
  );

  useEffect(() => {
    setDisplayList((prev) => {
      const liveUids = new Set(hand.map((c) => c.uid));
      const prevUids = new Set(prev.map((c) => c.uid));

      const reconciled = prev.map((entry) => {
        if (entry.exiting || liveUids.has(entry.uid)) return entry;
        // Primeira reconciliação que já não encontra o uid na mão: congela o
        // estado de revelação AGORA, com os dados mais recentes que ainda o
        // incluíam — ver o comentário de `snapshot` acima.
        return {
          ...entry,
          exiting: true,
          snapshot: {
            faceUp: revealed || revealedUids.includes(entry.uid) || fullIntelActive,
            exposed: revealed && (revealedUids.includes(entry.uid) || fullIntelActive),
          },
        };
      });

      const added = hand
        .filter((c) => !prevUids.has(c.uid))
        .map(({ uid, cardId }) => ({ uid, cardId, exiting: false }));

      if (added.length === 0 && reconciled.every((entry, i) => entry === prev[i])) return prev;
      return [...reconciled, ...added];
    });
  }, [hand, revealedUids, revealed, fullIntelActive]);

  const handleExited = useCallback((uid: string) => {
    setDisplayList((prev) => prev.filter((c) => c.uid !== uid));
  }, []);

  const viewportWidth = VISIBLE_SLOTS * miniCardWidth + (VISIBLE_SLOTS - 1) * SLOT_GAP;

  /**
   * Consulta só-leitura de uma carta em miniatura (patch pós-Fase 7a) —
   * própria (sempre `faceUp`, `revealed=true`) ou do oponente já revelada
   * (`faceUp` só quando `revealedUids`/VISÃO ABSOLUTA). Nunca disponível pra
   * uma carta ainda de verso — `faceUp` já cobre isso.
   */
  const [focusedCardId, setFocusedCardId] = useState<CardId | null>(null);

  return (
    <>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={[{ height: handTrackerRowHeight, maxWidth: viewportWidth }, style]}
        contentContainerStyle={styles.content}
      >
        {displayList.map((entry) => {
          // Enquanto o uid segue na mão viva, a revelação é sempre
          // reconsultada ao vivo (reage na hora a uma Espiada nova); uma vez
          // "saindo", usa o que foi congelado — nunca as duas fontes ao
          // mesmo tempo.
          const live = {
            faceUp: revealed || revealedUids.includes(entry.uid) || fullIntelActive,
            exposed: revealed && (revealedUids.includes(entry.uid) || fullIntelActive),
          };
          const { faceUp, exposed } = entry.exiting ? entry.snapshot! : live;

          return (
            <TrackerSlot
              key={entry.uid}
              uid={entry.uid}
              cardId={entry.cardId}
              exiting={entry.exiting}
              faceUp={faceUp}
              exposed={exposed}
              width={miniCardWidth}
              height={miniCardHeight}
              onExited={handleExited}
              onPress={!entry.exiting && faceUp ? () => setFocusedCardId(entry.cardId) : undefined}
            />
          );
        })}
      </ScrollView>

      {focusedCardId && (
        <CardFocusModal cardId={focusedCardId} readOnly onCancel={() => setFocusedCardId(null)} />
      )}
    </>
  );
}

export default HandTracker;

/* -------------------------------------------------------------------------- */
/*                                    SLOT                                     */
/* -------------------------------------------------------------------------- */

interface TrackerSlotProps {
  uid: string;
  cardId: CardId;
  exiting: boolean;
  faceUp: boolean;
  /** Só relevante do lado LOCAL: "o oponente já sabe desta carta minha". */
  exposed: boolean;
  width: number;
  height: number;
  onExited: (uid: string) => void;
  /** Consulta só-leitura (patch pós-Fase 7a) — `undefined` enquanto a carta
   * não está de face (verso do oponente ainda não revelado) ou saindo. */
  onPress?: () => void;
}

const TrackerSlot = memo(function TrackerSlot({
  uid,
  cardId,
  exiting,
  faceUp,
  exposed,
  width,
  height,
  onExited,
  onPress,
}: TrackerSlotProps) {
  const card = getCard(cardId);
  const accent = faceUp ? RARITY_COLOR[card.rarity] : colors.boardFrameLight;

  // 0 = colapsada (fora), 1 = tamanho cheio. A MESMA progressão anima largura,
  // margem e opacidade juntas — é o que faz os vizinhos deslizarem no mesmo
  // ritmo do colapso, em vez de pularem pro lugar assim que a saída começa.
  const progress = useSharedValue(0);

  useEffect(() => {
    if (exiting) {
      progress.value = withTiming(
        0,
        { duration: EXIT_DURATION, easing: Easing.in(Easing.quad) },
        (finished) => {
          if (finished) runOnJS(onExited)(uid);
        },
      );
    } else {
      progress.value = withTiming(1, { duration: ENTER_DURATION, easing: Easing.out(Easing.quad) });
    }
    // Só `exiting`: `progress` é um shared value estável por instância, e
    // `onExited`/`uid` não mudam durante a vida deste componente (a `key` do
    // pai é o próprio `uid` — trocar de carta sempre desmonta e remonta).
  }, [exiting]);

  const animatedStyle = useAnimatedStyle(() => ({
    width: progress.value * width,
    marginRight: progress.value * SLOT_GAP,
    opacity: progress.value,
  }));

  return (
    <Animated.View
      style={[
        styles.slot,
        {
          height,
          borderColor: accent,
          backgroundColor: faceUp ? colors.bgPanel : colors.boardFrame,
        },
        exposed && styles.slotExposed,
        animatedStyle,
      ]}
    >
      {onPress ? (
        <Pressable onPress={onPress} style={styles.pressableFill}>
          <Text
            numberOfLines={1}
            style={[
              styles.slotGlyph,
              { color: faceUp ? accent : colors.winGlow, fontSize: Math.max(6, Math.round(height * 0.6)) },
            ]}
          >
            {faceUp ? card.name.charAt(0) : '?'}
          </Text>
        </Pressable>
      ) : (
        <Text
          numberOfLines={1}
          style={[
            styles.slotGlyph,
            { color: faceUp ? accent : colors.winGlow, fontSize: Math.max(6, Math.round(height * 0.6)) },
          ]}
        >
          {faceUp ? card.name.charAt(0) : '?'}
        </Text>
      )}
    </Animated.View>
  );
});

/* -------------------------------------------------------------------------- */
/*                                   ESTILOS                                   */
/* -------------------------------------------------------------------------- */

const styles = StyleSheet.create({
  content: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  slot: {
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  slotExposed: {
    borderColor: colors.winGlow,
    borderWidth: 2,
  },
  slotGlyph: {
    fontWeight: '900',
  },
  pressableFill: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
