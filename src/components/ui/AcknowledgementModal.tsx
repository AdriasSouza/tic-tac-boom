import { useCallback, useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeOut, ZoomIn } from 'react-native-reanimated';

import { FlipCard } from './FlipCard';
import { PixelButton } from './PixelButton';
import { PixelPanel } from './PixelPanel';
import { colors } from '@/theme/colors';
import { useMatchPerspective } from '@/hooks/useMatchPerspective';
import { formatAcknowledgement, type AcknowledgementTone } from '@/i18n/logMessages';
import { canLocalAcknowledge, netAcknowledge } from '@/services/syncBridge';
import { selectPendingAcknowledgement, useGameStore } from '@/store/gameStore';

/** Cor de destaque por intenção do aviso. */
const TONE_COLOR: Record<AcknowledgementTone, string> = {
  DANGER: colors.danger,
  OPPONENT: colors.markO,
  INTEL: colors.winGlow,
};

/**
 * Pausa de confirmação manual: quando uma armadilha dispara, alguém joga uma
 * carta ou uma carta de espionagem revela informação, o jogo trava aqui até o
 * jogador clicar "ENTENDI". `canPlaceAt`/`resolveCardPlay`/a CPU já recusam
 * qualquer ação enquanto isto está montado — o modal só existe para dar ao
 * jogador a chance de LER antes do efeito mecânico aplicar de fato.
 *
 * Substitui um timer fixo de propósito: tempo na tela não garante leitura,
 * só que a tela ficou parada por tempo suficiente — e ainda exclui quem lê
 * mais devagar. Um clique explícito garante as duas coisas.
 *
 * Três modos, decididos por `pending.kind`:
 * - `INFO`       — texto e um destaque grande;
 * - `SPY_PICK`   — o jogador escolhe UMA carta e vira (ESPIONAGEM);
 * - `INTEL_FLIP` — o jogador vira e desvira quantas quiser (VISÃO ABSOLUTA).
 *
 * Tocar em qualquer ponto fora do painel também confirma — jogador impaciente
 * não precisa mirar no botão pequeno para avançar um aviso que já leu. Mesmo
 * gate de `canConfirm` do botão: na Espionagem, sem ter virado uma carta
 * ainda, o toque fora não faz nada (senão a escolha nunca aconteceria).
 */
export function AcknowledgementModal() {
  const pending = useGameStore(selectPendingAcknowledgement);

  /* O descritor guardado é um FATO em coordenadas do motor (`subject:
     'MACHINE'`). As palavras nascem aqui, já do ponto de vista deste aparelho
     — é o que faz o MESMO evento aparecer como "VOCÊ JOGOU" num cliente e "O
     OPONENTE JOGOU" no outro, em vez de chamar de CPU a pessoa do outro lado. */
  const perspective = useMatchPerspective();

  /* --- Padrão de autoridade -------------------------------------------------
     Só UM cliente publica o `ACKNOWLEDGE`: o autor da ação que criou esta
     pausa (ver `getAcknowledgementAuthority`). Se os dois publicassem, a fila
     seria consumida duas vezes e uma revelação inteira sumiria da tela sem
     ninguém ver.

     O cliente sem autoridade não fica travado: quando o `ACKNOWLEDGE` do
     outro chega pela rede, a ponte chama `acknowledgePending()` aqui também,
     `pendingAcknowledgement` vira `null` e este componente desmonta sozinho —
     sem nenhuma interação local. É por isso que a leitura de `pending` já é a
     única condição de exibição: a "trava de estado global" liberar É o
     fechamento do modal.                                                    */
  const { isOnline } = perspective;

  // Recalculado a cada render em vez de assinado: a autoridade deriva do log
  // de ações (estado de módulo da ponte), e o que dispara o re-render é a
  // própria chegada de `pending`. Assinar exigiria espelhar o log num store.
  const hasAuthority = canLocalAcknowledge();

  const acknowledge = useCallback(() => {
    // `netAcknowledge` aplica localmente E replica — e ele mesmo recusa
    // publicar se este cliente não for a autoridade.
    netAcknowledge();
  }, []);

  /**
   * Índices já virados. Estado LOCAL: virar uma carta não muda nada na
   * partida — é leitura, não jogada —, então nada disso precisa passar pela
   * store nem participar do determinismo do replay.
   */
  const [flipped, setFlipped] = useState<number[]>([]);

  // Cada confirmação da fila começa com todas as cartas viradas para baixo. A
  // fila pode trocar de item sem desmontar o modal (uma armadilha logo depois
  // de uma espionagem), então zerar aqui é obrigatório.
  const pendingId = pending?.id ?? null;
  useEffect(() => {
    setFlipped([]);
  }, [pendingId]);

  const isSpyPick = pending?.kind === 'SPY_PICK';

  const handleFlip = useCallback(
    (index: number) => {
      setFlipped((current) => {
        if (current.includes(index)) {
          // ESPIONAGEM não desvira: a escolha é definitiva, senão o jogador
          // simplesmente viraria uma, leria, desviraria e tentaria a próxima —
          // e a carta viraria "revele a mão inteira" com passos a mais.
          return isSpyPick ? current : current.filter((i) => i !== index);
        }
        return isSpyPick ? [index] : [...current, index];
      });
    },
    [isSpyPick],
  );

  if (!pending) return null;

  const text = formatAcknowledgement(pending, perspective);
  const accent = TONE_COLOR[text.tone];
  // Conteúdo revelado é informação PRIVADA de quem jogou a carta — no online,
  // só o `subject` vê a grade de cartas. O outro lado ainda vê o modal (o
  // motor pausa os dois via `pendingAcknowledgement`), só que com o texto
  // genérico que `formatAcknowledgement` já devolve pra esse caso — nunca a
  // grade. Fora do online (`isOnline: false`) ninguém perde nada: os dois
  // lados sempre foram a mesma pessoa (hot-seat) ou a IA (sem modal nenhum).
  const isSubject = pending.subject === perspective.localCombatant;
  const hasCards = pending.revealedCards.length > 0 && (!perspective.isOnline || isSubject);
  // Na Espionagem o botão só libera depois da escolha: confirmar sem virar
  // nada desperdiçaria a carta em silêncio.
  const hasFlippedIfRequired = !isSpyPick || flipped.length > 0;
  // No online, quem não tem autoridade não confirma nada — só lê e espera o
  // outro liberar. Fora do online `hasAuthority` é sempre `true`.
  const canConfirm = hasFlippedIfRequired && hasAuthority;

  const buttonLabel = !hasAuthority
    ? 'AGUARDANDO O OPONENTE'
    : hasFlippedIfRequired
      ? 'ENTENDI'
      : 'ESCOLHA UMA CARTA';

  return (
    <Modal
      visible
      transparent
      animationType="none" // as animações são do Reanimated, na UI thread
      onRequestClose={canConfirm ? acknowledge : undefined}
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
        {/* Full-screen, DEPOIS do backdrop mas ANTES do painel na árvore: o
            painel (renderizado a seguir) fica visualmente por cima e captura
            os toques nos próprios botões/cartas primeiro — só a área vazia
            ao redor cai aqui. */}
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={canConfirm ? acknowledge : undefined}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        />

        <Animated.View entering={ZoomIn.springify().damping(13).mass(0.8)} style={styles.holder}>
          <PixelPanel accent={accent} contentStyle={styles.panelContent}>
            <Text style={[styles.subtitle, { color: accent }]}>{text.subtitle}</Text>

            {/* O brasão grande só faz sentido quando ELE é a informação. Com
                cartas para virar, ele roubaria a altura de que a grade
                precisa — e em tela pequena empurraria o botão para fora. */}
            {!hasCards && (
              <View style={[styles.artSlot, { borderColor: accent }]}>
                <Text style={[styles.artGlyph, { color: accent }]}>
                  {text.title.charAt(0)}
                </Text>
              </View>
            )}

            <Text style={styles.title}>{text.title}</Text>
            <Text style={styles.description}>{text.description}</Text>

            {hasCards && (
              // Rola quando a mão do oponente é grande — sem isto, 5 cartas
              // em duas fileiras empurram o botão de confirmar para fora da
              // tela num celular baixo.
              <ScrollView
                style={styles.cardsScroll}
                contentContainerStyle={styles.cardsRow}
                showsVerticalScrollIndicator={false}
              >
                {pending.revealedCards.map((cardId, index) => (
                  <FlipCard
                    key={`${cardId}-${index}`}
                    cardId={cardId}
                    // VISÃO ABSOLUTA (`INTEL_FLIP`): decisão da Fase 3 — exibição
                    // automática, sem seleção. Todas já vêm viradas pra cima ao
                    // abrir; `handleFlip`/`onPress` seguem existindo (não afetam
                    // este `kind`) pela mesma razão que a Fase 3 decidiu não vale
                    // a complexidade de desligar uma prop sem consumidor real
                    // (ver `isSelected` em `docs/NOTAS_TECNICAS.md`).
                    revealed={pending.kind === 'INTEL_FLIP' || flipped.includes(index)}
                    // Espionagem: depois da escolha, as outras congelam.
                    disabled={isSpyPick && flipped.length > 0 && !flipped.includes(index)}
                    onPress={() => handleFlip(index)}
                  />
                ))}
              </ScrollView>
            )}

            <PixelButton
              label={buttonLabel}
              onPress={acknowledge}
              disabled={!canConfirm}
              accent={accent}
              style={styles.button}
            />

            {/* Sem isto, quem não tem autoridade veria só um botão desabilitado
                e concluiria que o jogo travou. O aviso transforma a espera em
                informação. */}
            {isOnline && !hasAuthority && (
              <Text style={styles.waitHint}>
                O oponente precisa confirmar para a partida continuar.
              </Text>
            )}
          </PixelPanel>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

export default AcknowledgementModal;

/* -------------------------------------------------------------------------- */
/*                                   ESTILOS                                   */
/* -------------------------------------------------------------------------- */

const ART_SIZE = 76;

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
    // Teto relativo à tela: um painel com 5 cartas para virar não pode
    // ultrapassar a altura disponível num aparelho pequeno.
    maxHeight: '90%',
  },
  panelContent: {
    padding: 18,
    alignItems: 'center',
  },
  subtitle: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 3,
    textAlign: 'center',
  },
  artSlot: {
    width: ART_SIZE,
    height: ART_SIZE,
    borderWidth: 3,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bgDeep,
    marginTop: 12,
  },
  artGlyph: {
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
  cardsScroll: {
    alignSelf: 'stretch',
    marginTop: 14,
    // Sem isto a lista mede pelo conteúdo e ignora o `maxHeight` do painel:
    // 5 cartas em duas fileiras empurrariam o botão para fora do modal.
    flexShrink: 1,
  },
  cardsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 8,
  },
  button: {
    alignSelf: 'stretch',
    marginTop: 18,
  },
  waitHint: {
    marginTop: 8,
    color: colors.textDim,
    fontSize: 9,
    letterSpacing: 1,
    textAlign: 'center',
  },
});
