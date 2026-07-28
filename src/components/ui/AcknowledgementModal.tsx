import { memo } from 'react';
import { Modal, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeOut, ZoomIn } from 'react-native-reanimated';

import { PixelButton } from './PixelButton';
import { PixelPanel } from './PixelPanel';
import { getCard } from '@/engine/cards/registry';
import { selectPendingAcknowledgement, useGameStore, type CardId } from '@/store/gameStore';
import { colors } from '@/theme/colors';

/**
 * Pausa de confirmação manual: quando uma armadilha dispara ou uma carta de
 * espionagem revela informação, o jogo trava aqui até o jogador clicar
 * "ENTENDI". `canPlaceAt`/`resolveCardPlay`/a CPU já recusam qualquer ação
 * enquanto isto está montado — o modal só existe para dar ao jogador a
 * chance de LER antes do efeito mecânico (dano, patch) aplicar de fato.
 *
 * Substitui um timer fixo de propósito: tempo na tela não garante leitura,
 * só que a tela ficou parada por tempo suficiente — e ainda exclui quem lê
 * mais devagar. Um clique explícito garante as duas coisas.
 */
export function AcknowledgementModal() {
  const pending = useGameStore(selectPendingAcknowledgement);
  const acknowledge = useGameStore((s) => s.acknowledgePending);

  if (!pending) return null;

  return (
    <Modal
      visible
      transparent
      animationType="none" // as animações são do Reanimated, na UI thread
      onRequestClose={acknowledge} // botão físico de voltar no Android = confirmar
      statusBarTranslucent
    >
      {/* `key` pelo id: se a próxima confirmação da fila entrar assim que
          esta for fechada, força remonte e a animação de entrada roda do
          zero para ela — nunca uma transição "fantasma" entre as duas. */}
      <Animated.View
        key={pending.id}
        entering={FadeIn.duration(160)}
        exiting={FadeOut.duration(140)}
        style={styles.backdrop}
      >
        <Animated.View entering={ZoomIn.springify().damping(13).mass(0.8)} style={styles.holder}>
          <PixelPanel accent={colors.danger} contentStyle={styles.panelContent}>
            <Text style={styles.subtitle}>{pending.subtitle}</Text>

            <View style={styles.artSlot}>
              <Text style={styles.artGlyph}>{pending.title.charAt(0)}</Text>
            </View>

            <Text style={styles.title}>{pending.title}</Text>
            <Text style={styles.description}>{pending.description}</Text>

            {pending.revealedCards.length > 0 && (
              <View style={styles.chipsRow}>
                {pending.revealedCards.map((cardId, i) => (
                  <RevealedCardChip key={`${cardId}-${i}`} cardId={cardId} />
                ))}
              </View>
            )}

            <PixelButton
              label="ENTENDI"
              onPress={acknowledge}
              accent={colors.danger}
              style={styles.button}
            />
          </PixelPanel>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

export default AcknowledgementModal;

/* -------------------------------------------------------------------------- */
/*                              MINIATURA DE CARTA                             */
/* -------------------------------------------------------------------------- */
/* Usada só por Visão Absoluta (revela a mão inteira) — a carta principal já
   tem seu próprio destaque grande acima; isto é a lista compacta do resto.  */

const RevealedCardChip = memo(function RevealedCardChip({ cardId }: { cardId: CardId }) {
  const card = getCard(cardId);
  const accent = card.type === 'ACTION' ? colors.markX : colors.markO;

  return (
    <View style={[styles.chip, { borderColor: accent }]}>
      <Text style={[styles.chipGlyph, { color: accent }]}>{card.name.charAt(0)}</Text>
      <Text style={styles.chipName} numberOfLines={1}>
        {card.name}
      </Text>
    </View>
  );
});

/* -------------------------------------------------------------------------- */
/*                                   ESTILOS                                   */
/* -------------------------------------------------------------------------- */

const ART_SIZE = 76;
const CHIP_WIDTH = 64;

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(2,4,7,0.88)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  holder: {
    width: '100%',
    maxWidth: 340,
  },
  panelContent: {
    padding: 20,
    alignItems: 'center',
  },
  subtitle: {
    color: colors.danger,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 3,
    textAlign: 'center',
  },
  artSlot: {
    width: ART_SIZE,
    height: ART_SIZE,
    borderWidth: 3,
    borderColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bgDeep,
    marginTop: 12,
  },
  artGlyph: {
    color: colors.danger,
    fontSize: 34,
    fontWeight: '900',
  },
  title: {
    marginTop: 12,
    color: colors.text,
    fontSize: 16,
    fontWeight: '900',
    letterSpacing: 2,
    textAlign: 'center',
  },
  description: {
    marginTop: 6,
    color: colors.text,
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
    opacity: 0.85,
  },
  chipsRow: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 8,
    marginTop: 14,
  },
  chip: {
    width: CHIP_WIDTH,
    alignItems: 'center',
    borderWidth: 2,
    paddingVertical: 6,
    backgroundColor: colors.bgDeep,
  },
  chipGlyph: {
    fontSize: 16,
    fontWeight: '900',
  },
  chipName: {
    marginTop: 2,
    color: colors.text,
    fontSize: 7,
    letterSpacing: 0.5,
    fontWeight: '700',
  },
  button: {
    alignSelf: 'stretch',
    marginTop: 20,
  },
});
