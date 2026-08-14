import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown, FadeOutUp } from 'react-native-reanimated';

import type { Combatant } from '@/engine/rules';
import { useMatchPerspective } from '@/hooks/useMatchPerspective';
import { formatCardsReceivedNotice } from '@/i18n/logMessages';
import { colors } from '@/theme/colors';
import { selectLastCardsDrawnFor, useGameStore, type CardsDrawnNotice } from '@/store/gameStore';

/** Quanto tempo o aviso fica na tela antes de sair sozinho. */
const VISIBLE_MS = 2200;

/**
 * Faixa efêmera "VOCÊ RECEBEU: ..." — puramente informativa, nunca bloqueia
 * jogada nem toque no tabuleiro (`pointerEvents="none"` na árvore inteira,
 * mesma garantia de `<NoticeToast />`).
 *
 * `target` decide QUAL combatente este toast mostra e ONDE ele aparece —
 * `<CardsReceivedToast target="PLAYER" />` e `target="MACHINE"` são duas
 * instâncias independentes, cada uma assinando o próprio slot
 * (`lastCardsDrawnFor[target]`, `selectLastCardsDrawnFor`). Duas instâncias
 * (não uma só reagindo a "quem quer que seja") porque a compra automática
 * credita os dois lados NA MESMA pilha síncrona — os dois avisos podem
 * precisar aparecer ao mesmo tempo, e um slot/posição compartilhados
 * colidiriam visualmente. Local embaixo (perto da própria mão); o outro lado
 * em cima (ele não vê a mão dele na tela) — mesma lógica de dois
 * `<HpTracker />`, um por lado.
 */
export function CardsReceivedToast({ target }: { target: Combatant }) {
  const notice = useGameStore(selectLastCardsDrawnFor(target));
  const perspective = useMatchPerspective();
  const [visible, setVisible] = useState<CardsDrawnNotice | null>(null);
  const isLocal = target === perspective.localCombatant;

  const noticeId = notice?.id ?? null;
  useEffect(() => {
    if (!notice) {
      setVisible(null);
      return;
    }
    setVisible(notice);

    const timer = setTimeout(() => setVisible(null), VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [noticeId, notice]);

  if (!visible) return null;

  const text = formatCardsReceivedNotice(target, visible.cardIds, perspective);

  return (
    <View
      style={[styles.layer, isLocal ? styles.layerLocal : styles.layerRemote]}
      pointerEvents="none"
    >
      <Animated.View
        key={visible.id}
        entering={FadeInDown.springify().damping(16).mass(0.7)}
        exiting={FadeOutUp.duration(220)}
        style={styles.toast}
      >
        <View style={styles.bevel} />
        <Text style={styles.text} numberOfLines={2}>
          {text}
        </Text>
      </Animated.View>
    </View>
  );
}

export default CardsReceivedToast;

const styles = StyleSheet.create({
  layer: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  layerLocal: {
    justifyContent: 'flex-end',
    // Acima do leque de cartas, sem cobrir o tabuleiro.
    paddingBottom: '20%',
  },
  layerRemote: {
    justifyContent: 'flex-start',
    // Entre o `<ConnectionSyncBanner />` (14%) e o `<NoticeToast />` (32%).
    paddingTop: '22%',
  },
  toast: {
    maxWidth: 300,
    backgroundColor: colors.bgDeep,
    borderWidth: 2,
    borderColor: colors.terminalGreen,
    paddingHorizontal: 14,
    paddingVertical: 8,
    overflow: 'hidden',
  },
  bevel: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 3,
    backgroundColor: colors.terminalGreen,
  },
  text: {
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1.2,
    textAlign: 'center',
    color: colors.terminalGreen,
  },
});
