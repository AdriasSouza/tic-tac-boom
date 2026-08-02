import type { LayoutMode } from '@/hooks/useLayoutMode';

/**
 * Tabelas de dimensão por `LayoutMode`, compartilhadas entre `<Board />`,
 * `<TrapZone />` e `app/game/[mode].tsx`.
 *
 * Moraram uma em cada componente até a A2.1: `<Board />` exportava
 * `BOARD_BOUNDS`, `<TrapZone />` exportava `TRAP_ZONE_BOUNDS`, e `[mode].tsx`
 * importava dos dois. Com um terceiro consumidor precisando das mesmas
 * tabelas (o cálculo do inset das sidebars, que depende do `GUTTER` do board
 * E do `sidebarWidth` da zona ao mesmo tempo), `[mode].tsx` estaria
 * importando constante de dois componentes IRMÃOS — cada um vira uma
 * dependência lateral do outro por tabela interposta, em vez de os três
 * dependerem de uma única fonte comum. Aqui, ao lado de `useLayoutMode` (a
 * classificação da qual as duas tabelas são função), nenhum componente
 * importa de outro componente.
 */

/**
 * Teto e respiro do lado do tabuleiro, por `LayoutMode`.
 *
 * `<Board />` é o único CONSUMIDOR que decide geometria com isto — não é um
 * teto externo imposto a ele, é a tabela que ele mesmo usa internamente,
 * só compartilhada para quem precisa LER o mesmo `GUTTER` sem duplicar o
 * número (ver o cálculo de inset em `[mode].tsx`).
 *
 * - `MAX_BOARD` cresce por modo: 420 no celular (valor de referência de
 *   sempre, calibrado junto com carta/HUD), 520 no tablet, 640 no desktop —
 *   é o número que resolve o "sobra espaço não usado": antes o teto era 420
 *   em QUALQUER tela, então um monitor com centenas de dp de altura sobrando
 *   na área de combate não tinha para onde o board crescer.
 * - `GUTTER` é o respiro entre a moldura do board e a borda da caixa que o
 *   mede — sem ele, quando `outer` bate exatamente na largura ou altura
 *   disponível, a moldura encosta na borda do próprio container. Cresce um
 *   pouco por modo, acompanhando o respiro que o resto do layout já usa
 *   nesses tamanhos.
 *
 * Não há piso aqui. Um piso "no cálculo" (`clamp(target, MIN_BOARD, ...)`)
 * nunca sobrevive ao passo seguinte, que sempre limita o resultado ao espaço
 * físico medido — um clamp que não clampa. `MIN_PLAYABLE_BOARD`, abaixo,
 * assume o papel real que um piso deveria ter: não fabricar espaço que não
 * existe, só DENUNCIAR quando o espaço real ficou abaixo do jogável.
 */
export const BOARD_BOUNDS: Record<LayoutMode, { MAX_BOARD: number; GUTTER: number }> = {
  compact: { MAX_BOARD: 420, GUTTER: 16 },
  regular: { MAX_BOARD: 520, GUTTER: 24 },
  wide: { MAX_BOARD: 640, GUTTER: 32 },
};

/**
 * Abaixo disto, `cellSize` cai perto ou abaixo do alvo de toque de ~44dp — o
 * board ainda renderiza, mas deixou de ser confortavelmente jogável.
 *
 * Dois consumidores:
 * - `Board.tsx` usa para AVISAR (`console.warn`) quando o orçamento de espaço
 *   da linha de combate ao redor do board estourou.
 * - `[mode].tsx` usa como PORTÃO do inset de hug das sidebars (A2.1): um
 *   dispositivo que já reprovou no piso básico de jogabilidade está numa
 *   categoria de limitação conhecida (ver README) que precisa de correção
 *   estrutural (altura de HUD/mão), não cosmética — apertar ainda mais um
 *   eixo (largura) de um layout que já falhou no outro (altura) não ajuda em
 *   nada, só desloca a quebra. Ver o comentário de `insetPerSide` lá.
 */
export const MIN_PLAYABLE_BOARD = 180;

/**
 * Largura da coluna e lado dos slots da zona de armadilhas, por `LayoutMode`.
 *
 * A zona é sidebar em TODOS os modos (nunca mais empilhada acima/abaixo do
 * tabuleiro), então o que varia por tela não é orientação — é só QUANTO
 * espaço de largura cada faixa de dispositivo pode ceder sem espremer o
 * board, que é exatamente o que `useLayoutMode` classifica.
 *
 * `hitSlop`: em `compact` o slot (32dp) fica abaixo do alvo de toque de
 * ~44dp. A zona não tem interação hoje — mas cartas como Antimagia,
 * Ricochete e Proteção vão precisar inspecionar uma armadilha por toque, e um
 * `hitSlop` custa zero agora e vira retrabalho depois. Calculado para trazer
 * o alvo efetivo a 44dp; zero nos modos onde o slot já é grande o bastante.
 */
export const TRAP_ZONE_BOUNDS: Record<LayoutMode, { sidebarWidth: number; slotSize: number; hitSlop: number }> = {
  compact: { sidebarWidth: 40, slotSize: 32, hitSlop: 6 },
  regular: { sidebarWidth: 56, slotSize: 46, hitSlop: 0 },
  wide: { sidebarWidth: 72, slotSize: 60, hitSlop: 0 },
};
