import { useWindowDimensions } from 'react-native';

export interface ResponsiveGameLayout {
  /** Fator de escala geral (1 = tamanhos de referência, tela de `REFERENCE_HEIGHT`dp). */
  scale: number;
  /**
   * Altura do monitor CRT do Chaos Terminal quando NÃO colapsado. Ver
   * `terminalCollapsed` — quando ele é `true`, quem decide a altura de fato
   * exibida é o próprio `<ChaosTerminal />` (reduz para uma faixa fixa e
   * pequena), não este valor.
   */
  terminalHeight: number;
  /**
   * `true` em telas baixas (`height < 500`) — celular deitado é o caso real
   * que motiva isto, não qualquer `LayoutMode` por largura. Um celular
   * deitado é 'wide' ou 'regular' por largura (ver `useLayoutMode`), mas
   * continua tendo a altura de um celular; o terminal cheio (88–128dp) mais
   * HUD mais mão já comem quase toda essa altura antes da linha de combate
   * medir qualquer coisa. `<ChaosTerminal />` usa isto para colapsar para
   * ~56dp (só regra + contador) e abrir um toque que expande por cima do
   * jogo quando o jogador precisar ler o log completo.
   */
  terminalCollapsed: boolean;
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
  /** Lado de um bloco de HP na barra de status. */
  hpBlockSize: number;
  /**
   * Tamanho de uma carta em MINIATURA — os slots que representam as mãos dos
   * dois lados dentro da barra de status (ver `<HandTracker />`). Não são
   * cartas jogáveis: existem só para dizer "ele tem 4 cartas na mão" e, no
   * lado do oponente, quais posições já foram espiadas.
   */
  miniCardWidth: number;
  miniCardHeight: number;
  /**
   * Altura fixa da fileira do `<HandTracker />` (a linha do rótulo VOCÊ/CPU
   * em `<HUD />`, ver `HpTracker`).
   *
   * Fórmula DELIBERADAMENTE independente de `miniCardHeight`, e não "altura
   * automática pelo conteúdo": altura emergente foi a causa raiz de três
   * bugs de geometria na Parte A (ver `AGENTS.md`) — um ancestral que deixa o
   * próprio tamanho ser ditado pelo filho cria uma competição silenciosa por
   * espaço vertical, e uma mudança futura em `miniCardHeight` (o único
   * consumidor de `miniCardWidth`/`miniCardHeight` além deste, depois da
   * remoção do `<MiniHand />`) passaria a roubar altura do board sem
   * nenhum sinal. Calibrada à mão contra o range atual de `miniCardHeight`
   * (14–29dp conforme orientação/escala) com folga de +3 a +6dp nos quatro
   * cantos — se `miniCardHeight` crescer além disso no futuro, o sintoma é
   * um slot cortado, visível na hora, não um board encolhendo em silêncio.
   */
  handTrackerRowHeight: number;
  /**
   * `true` quando a tela é mais alta que larga.
   *
   * É a ÚNICA chave que decide a estrutura da área de combate, e substituiu um
   * breakpoint de largura fixa (`width >= 768`) por um bom motivo: o que
   * determina em qual eixo as armadilhas devem se deitar não é o tamanho
   * absoluto da tela, é qual dimensão está sobrando nela. Um tablet de 800dp
   * de largura em pé passava no breakpoint antigo e ganhava o layout de
   * desktop, colando as armadilhas nas laterais e espremendo o tabuleiro no
   * eixo em que ele ainda tinha folga. A proporção acerta os dois casos sem
   * precisar de número mágico nenhum.
   */
  isPortrait: boolean;
}

/**
 * Teto de largura do jogo, em dp.
 *
 * Num monitor ultrawide, um layout que ocupa 100% da largura afasta HP,
 * tabuleiro e armadilhas a ponto de nada mais estar no mesmo campo de visão —
 * o jogador passa a varrer a tela com o pescoço para ler o próprio estado.
 * Acima deste limite o jogo para de crescer e passa a ser centralizado, com o
 * fundo preto ocupando o resto.
 */
export const GAME_MAX_WIDTH = 1024;

/**
 * Altura de tela onde os tamanhos "base" do jogo (carta 84×118, terminal
 * 120dp, tabuleiro até 420dp) foram originalmente desenhados — próxima da de
 * um iPhone 14/Pixel 7 em pé. Serve de referência para o fator de escala.
 */
const REFERENCE_HEIGHT = 780;

const MIN_SCALE = 0.7;
const MAX_SCALE = 1.05;

/**
 * Abaixo desta altura de tela, `terminalCollapsed` vira `true`. 500 é bem
 * menor que a `REFERENCE_HEIGHT` (780) de propósito: só o caso realmente
 * apertado (celular deitado, ~400dp de altura) deve colapsar — um celular em
 * pé, mesmo compacto, tem altura de sobra pra não precisar disso.
 */
const TERMINAL_COLLAPSE_HEIGHT = 500;

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
  const isPortrait = height > width;

  const cardWidth = Math.round(84 * scale);
  const cardHeight = Math.round(118 * scale);

  return {
    scale,
    terminalHeight: Math.round(clamp(height * 0.15, 88, 128)),
    terminalCollapsed: height < TERMINAL_COLLAPSE_HEIGHT,
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
    // A barra de status agora divide a MESMA fileira entre HP, miniatura da
    // mão e indicador de turno dos DOIS lados. Com as medidas fixas de antes
    // (bloco de 18dp) essa soma não cabia na largura de um celular pequeno, e
    // o que cede primeiro num `flexDirection:'row'` é sempre o vizinho errado.
    // Escalar aqui, junto com todo o resto, mantém a fileira dentro da tela
    // sem nenhum componente precisar de um `flexShrink` de desempate.
    hpBlockSize: Math.round(15 * scale),
    // Mesmo raciocínio de orientação do bloco acima: em paisagem o `<HUD />`
    // passa a exibir HP e mão lado a lado (`flexDirection:'row'`, ver
    // `HUD.tsx`) com a largura do monitor sobrando para isso; em retrato elas
    // empilham numa coluna estreita por lado, e um ganho menor aqui evita que
    // a fileira de fichas sobreponha o próprio HP.
    miniCardWidth: Math.round(11 * scale * (isPortrait ? 1.3 : 1.85)),
    miniCardHeight: Math.round(15 * scale * (isPortrait ? 1.3 : 1.85)),
    // Constantes (24/33) escolhidas à mão contra o range atual de
    // `miniCardHeight` — ver o comentário do campo na interface acima.
    handTrackerRowHeight: Math.round((isPortrait ? 24 : 33) * scale),
    isPortrait,
  };
}
