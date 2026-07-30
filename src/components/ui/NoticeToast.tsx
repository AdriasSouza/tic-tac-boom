import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown, FadeOutUp } from 'react-native-reanimated';

import { useMatchPerspective } from '@/hooks/useMatchPerspective';
import { formatNotice, resolveNoticeTone } from '@/i18n/logMessages';
import { colors } from '@/theme/colors';
import { selectLastNotice, useGameStore, type Notice, type NoticeTone } from '@/store/gameStore';

/** Quanto tempo o aviso fica na tela antes de sair sozinho. */
const VISIBLE_MS = 2600;

const TONE_COLOR: Record<NoticeTone, string> = {
  GOOD: colors.winGlow,
  BAD: colors.danger,
  NEUTRAL: colors.markO,
};

/**
 * Faixa efêmera sobre o tabuleiro.
 *
 * Cobre o meio-termo entre o log do terminal (histórico que exige o jogador
 * estar olhando para lá) e o modal de confirmação (que pausa o jogo): fatos
 * que o jogador precisa VER, mas que não valem interromper a partida — "A CPU
 * DESTRUIU SUA CARTA MINA", "CASA 2x3 LACRADA".
 *
 * Reage ao `id` de `lastNotice`, e não ao texto: dois avisos idênticos
 * seguidos (dois saques na mesma carta) ainda precisam piscar duas vezes, e
 * comparar conteúdo não distinguiria os dois.
 *
 * `pointerEvents="none"` em toda a árvore: flutua sobre o tabuleiro e jamais
 * pode roubar um toque de célula ou um arrasto de carta.
 */
export function NoticeToast() {
  const notice = useGameStore(selectLastNotice);
  // O aviso guardado é um FATO; o texto e a cor nascem aqui, já do ponto de
  // vista deste aparelho — quem rouba vê verde, quem é roubado vê vermelho,
  // a partir do mesmo evento.
  const perspective = useMatchPerspective();
  const [visible, setVisible] = useState<Notice | null>(null);

  const noticeId = notice?.id ?? null;
  useEffect(() => {
    // Mesmo raciocínio do `<ExtraTurnBanner />`: `startMatch`/`startNextRound`
    // zeram `lastNotice` de volta a `null`. Sem este `else`, um toast ainda na
    // tela no instante do reset ficaria preso — o `else` de baixo é o que
    // garante que "a store voltou a `null`" também esconde a UI local.
    if (!notice) {
      setVisible(null);
      return;
    }
    setVisible(notice);

    // Timer re-armado a cada aviso novo: um aviso que chega durante o anterior
    // substitui a contagem em vez de somar duas, senão o segundo sairia cedo
    // demais ao herdar o tempo restante do primeiro.
    const timer = setTimeout(() => setVisible(null), VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [noticeId, notice]);

  if (!visible) return null;

  const text = formatNotice(visible, perspective);
  const accent = TONE_COLOR[resolveNoticeTone(visible, perspective, visible.tone)];

  return (
    <View style={styles.layer} pointerEvents="none">
      <Animated.View
        // Remonta a cada aviso: força a animação de entrada a rodar de novo
        // mesmo quando um substitui o outro sem passar por "nenhum".
        key={visible.id}
        entering={FadeInDown.springify().damping(16).mass(0.7)}
        exiting={FadeOutUp.duration(220)}
        style={[styles.toast, { borderColor: accent }]}
      >
        <View style={[styles.bevel, { backgroundColor: accent }]} />
        <Text style={[styles.text, { color: accent }]} numberOfLines={2}>
          {text}
        </Text>
      </Animated.View>
    </View>
  );
}

export default NoticeToast;

const styles = StyleSheet.create({
  layer: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'flex-start',
    // Abaixo do topo para não colidir com o header nem com o terminal.
    paddingTop: '32%',
    paddingHorizontal: 24,
  },
  toast: {
    maxWidth: 320,
    backgroundColor: colors.bgDeep,
    borderWidth: 2,
    paddingHorizontal: 16,
    paddingVertical: 10,
    overflow: 'hidden',
  },
  bevel: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 3,
  },
  text: {
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1.5,
    textAlign: 'center',
  },
});
