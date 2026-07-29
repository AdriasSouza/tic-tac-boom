import { useWindowDimensions } from 'react-native';

export interface ResponsiveGameLayout {
  /** Fator de escala geral (1 = tamanhos de referência, tela de `REFERENCE_HEIGHT`dp). */
  scale: number;
  /** Altura do monitor CRT do Chaos Terminal. */
  terminalHeight: number;
  /**
   * Teto do lado do tabuleiro. É só um LIMITE SUPERIOR — o `<Board />` ainda
   * encolhe mais que isso se a altura de tela sobrando for menor (ver
   * `Board.tsx`, que mede largura E altura disponíveis).
   */
  boardMaxSize: number;
  /** Largura/altura de uma carta na mão. */
  cardWidth: number;
  cardHeight: number;
  /**
   * Distância horizontal entre cartas vizinhas no leque, mantendo a mesma
   * proporção de sobreposição do tamanho de referência. O `<CardHand />` ainda
   * aperta mais que isso se a mão cheia não couber na largura da tela.
   */
  fanSpacing: number;
  /** Altura reservada para a faixa da mão (carta + folga vertical do arco). */
  handAreaHeight: number;
  /** Lado dos slots da zona de armadilhas. */
  trapSlotWidth: number;
  trapSlotHeight: number;
  /**
   * `true` em telas largas (desktop/tablet em paisagem) — o layout troca de
   * empilhado (tudo em coluna) para as zonas de armadilha nas LATERAIS do
   * tabuleiro, liberando altura para a mão de cartas em vez de desperdiçar a
   * largura sobrando num monitor.
   */
  isWide: boolean;
}

/**
 * Abaixo disto o layout é sempre empilhado, não importa a altura. Números
 * redondos de breakpoint de web (tablet paisagem/desktop começam por aqui);
 * a maioria dos celulares em retrato nunca chega perto disto mesmo diagonal
 * grande, então não há ambiguidade prática entre "celular" e "largo".
 */
const WIDE_BREAKPOINT = 768;

/**
 * Altura de tela onde os tamanhos "base" do jogo (carta 84×118, terminal
 * 120dp, tabuleiro até 420dp) foram originalmente desenhados — próxima da de
 * um iPhone 14/Pixel 7 em pé. Serve de referência para o fator de escala.
 */
const REFERENCE_HEIGHT = 780;

const MIN_SCALE = 0.7;
const MAX_SCALE = 1.05;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Fonte única do dimensionamento responsivo do jogo.
 *
 * Sem isto, cada componente (terminal, tabuleiro, mão) inventaria sua própria
 * conta a partir de `useWindowDimensions()` — e em telas pequenas (iPhone SE,
 * Android compacto) a soma dessas contas independentes ultrapassava a altura
 * da tela, empurrando a mão de cartas (a última da coluna) para fora da área
 * visível. Escalar tudo a partir do MESMO fator mantém as proporções entre os
 * elementos e reduz a chance de qualquer um sozinho "comer" espaço demais.
 *
 * Deriva de `height`, não de `width`: é a dimensão que mais aperta no layout
 * empilhado deste jogo (header + terminal + HUD + tabuleiro + armadilhas +
 * mão, um embaixo do outro) — largura quase sempre sobra em modo retrato.
 *
 * O clamp nas duas pontas é o que impede os dois extremos ruins: sem piso, um
 * aparelho muito baixo produziria cartas ilegíveis; sem teto, um tablet
 * transformaria a mão num painel gigante desproporcional ao tabuleiro.
 */
export function useResponsiveLayout(): ResponsiveGameLayout {
  const { width, height } = useWindowDimensions();

  const scale = clamp(height / REFERENCE_HEIGHT, MIN_SCALE, MAX_SCALE);

  const cardWidth = Math.round(84 * scale);
  const cardHeight = Math.round(118 * scale);

  return {
    scale,
    terminalHeight: Math.round(clamp(height * 0.15, 88, 128)),
    boardMaxSize: Math.round(clamp(Math.min(width, height) * 0.6, 240, 420)),
    cardWidth,
    cardHeight,
    // Mesma razão que já existia entre o espaçamento (48) e a largura da carta
    // (84) de referência — a sobreposição do leque não muda de "aparência",
    // só de escala.
    fanSpacing: Math.round(cardWidth * (48 / 84)),
    // Folga vertical só para o arco do leque (as cartas das pontas descem uns
    // 14dp). O destaque da carta em mira sobe PARA FORA desta faixa e não
    // precisa de reserva — reservar espaço para ele desperdiçava altura que,
    // numa tela baixa, faltava para o tabuleiro.
    handAreaHeight: cardHeight + Math.round(30 * scale),
    trapSlotWidth: Math.round(40 * scale),
    trapSlotHeight: Math.round(54 * scale),
    isWide: width >= WIDE_BREAKPOINT,
  };
}
