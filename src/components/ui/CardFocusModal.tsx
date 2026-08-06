import { memo } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeOut, ZoomIn } from 'react-native-reanimated';

import { PixelButton } from './PixelButton';
import { PixelPanel } from './PixelPanel';
import { getCard } from '@/engine/cards/registry';
import { RARITY_LABEL } from '@/engine/cards/definitions';
import { RARITY_COLOR } from '@/theme/rarity';
import { type CardId } from '@/store/gameStore';
import { colors } from '@/theme/colors';

export interface CardFocusModalProps {
  cardId: CardId;
  /** Se o botão de confirmar deve estar habilitado (turno, fase, `canPlay` da carta, espaço na mesa). */
  canConfirm: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

/**
 * Modo foco: alternativa ao arrastar, pensada para mouse/web.
 *
 * Um toque na carta (ver `<CardItem />`) abre isto em vez de exigir arrastar
 * até a metade superior da tela — arrastar com o cursor não é um gesto
 * natural fora de touch. Mostra a carta ampliada com a descrição completa e
 * dois botões:
 *
 * - **CANCELAR** — fecha sem gastar a carta.
 * - **USAR/ARMAR** — resolve a carta. Se ela exigir alvo, quem decide o que
 *   acontece a seguir é o `<CardHand />` (arma `pendingAction` e devolve o
 *   tabuleiro ao modo mira); TRAPs sempre armam direto.
 */
function CardFocusModalComponent({ cardId, canConfirm, onCancel, onConfirm }: CardFocusModalProps) {
  const card = getCard(cardId);
  const accent = card.type === 'ACTION' ? colors.markX : colors.markO;
  const confirmLabel = card.type === 'TRAP' ? 'ARMAR' : 'USAR';
  const rarityColor = RARITY_COLOR[card.rarity];

  return (
    <Modal
      visible
      transparent
      animationType="none" // as animações são do Reanimated, na UI thread
      onRequestClose={onCancel} // botão físico de voltar no Android = cancelar
      statusBarTranslucent
    >
      <Animated.View
        entering={FadeIn.duration(160)}
        exiting={FadeOut.duration(140)}
        style={styles.backdrop}
      >
        {/* Tocar fora do painel também cancela — a mesma ergonomia dos
            outros modais informativos, e mais um jeito de sair sem procurar
            o botão certo. */}
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onCancel}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        />

        <Animated.View entering={ZoomIn.springify().damping(15).mass(0.7)} style={styles.holder}>
          <PixelPanel accent={accent} contentStyle={styles.panelContent}>
            <Text style={[styles.type, { color: accent }]}>
              {card.requiresTarget ? '◎ ' : ''}
              {card.type}
            </Text>

            <View style={[styles.artSlot, { borderColor: accent }]}>
              {/* TODO(fase 5): <Image source={cardSprite(card.id)} /> */}
              <Text style={[styles.artGlyph, { color: accent }]}>{card.name.charAt(0)}</Text>
            </View>

            <Text style={styles.name}>{card.name}</Text>

            {/* Raridade e custo lêem juntos como metadados da carta — os dois
                só são legíveis por extenso aqui: na mão (`<CardItem />`) a
                raridade é uma barra colorida de 3dp e o custo, quando cabe,
                vira uma tag igual a esta, sem texto de raridade nenhum. Esta
                é a tela onde o jogador PARA pra decidir, então é onde os dois
                rótulos cabem por extenso. Mesmo idioma visual: retângulo
                chapado, sem `borderRadius` (README: pixel art sem borrão). */}
            <View style={styles.metaRow}>
              <View style={[styles.rarityTag, { borderColor: rarityColor }]}>
                <Text style={[styles.rarityText, { color: rarityColor }]}>
                  {RARITY_LABEL[card.rarity]}
                </Text>
              </View>
              <View style={[styles.rarityTag, { borderColor: colors.winGlow }]}>
                <Text style={[styles.rarityText, { color: colors.winGlow }]}>
                  {card.cost}⚡
                </Text>
              </View>
            </View>

            <Text style={styles.description}>{card.description}</Text>

            <View style={styles.actions}>
              <PixelButton
                label="CANCELAR"
                onPress={onCancel}
                variant="ghost"
                style={styles.action}
              />
              <PixelButton
                label={confirmLabel}
                onPress={onConfirm}
                accent={accent}
                disabled={!canConfirm}
                style={styles.action}
              />
            </View>
          </PixelPanel>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

export const CardFocusModal = memo(CardFocusModalComponent);
export default CardFocusModal;

const ART_SIZE = 96;

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
    maxWidth: 320,
  },
  panelContent: {
    padding: 20,
    alignItems: 'center',
  },
  type: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 3,
  },
  artSlot: {
    width: ART_SIZE,
    height: ART_SIZE,
    borderWidth: 3,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bgDeep,
    marginTop: 14,
  },
  artGlyph: {
    fontSize: 44,
    fontWeight: '900',
  },
  name: {
    marginTop: 14,
    color: colors.text,
    fontSize: 16,
    fontWeight: '900',
    letterSpacing: 2,
    textAlign: 'center',
  },
  metaRow: {
    marginTop: 8,
    flexDirection: 'row',
    gap: 8,
  },
  rarityTag: {
    borderWidth: 2,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  rarityText: {
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 2,
  },
  description: {
    marginTop: 8,
    color: colors.text,
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
    opacity: 0.85,
  },
  actions: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    gap: 10,
    marginTop: 20,
  },
  action: {
    flex: 1,
  },
});
