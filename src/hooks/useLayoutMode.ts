import { useWindowDimensions } from 'react-native';

export type LayoutMode = 'compact' | 'regular' | 'wide';

export interface LayoutModeInfo {
  mode: LayoutMode;
  width: number;
  height: number;
}

/** Abaixo disto, sempre `'compact'` — celular em pé. */
const COMPACT_MAX_WIDTH = 600;

/** Abaixo disto (e a partir do teto acima), `'regular'` — tablet, janela média. */
const REGULAR_MAX_WIDTH = 900;

/**
 * Abaixo desta altura, o modo nunca sobe além de `'regular'` — mesmo que a
 * largura sozinha classificasse como `'wide'`.
 *
 * Existe para o caso do celular deitado: um iPhone em paisagem tem ~900dp de
 * largura (classificaria como desktop) mas ~400dp de altura (o recurso
 * escasso continua sendo o de um celular). Sem este teto, esse aparelho
 * herdaria bounds pensados para monitor.
 *
 * Hoje isso quase não afeta o cálculo de tamanho do tabuleiro em si — o
 * `clamp(Math.min(width,height), ...)` do `<Board />` já usa a MENOR dimensão,
 * então a altura curta já domina a conta independente do `mode`. Quem vai
 * depender de verdade desta classificação são as próximas tarefas que ainda
 * não existem: onde posicionar as zonas de armadilha (A2) e o HpTracker (A3)
 * — decisões de ARRANJO, não de tamanho do board, que precisam saber "isto é
 * um celular deitado" e não "isto é um monitor".
 */
const WIDE_MIN_HEIGHT = 700;

/**
 * Classificação de tela em 3 categorias — `useResponsiveLayout` já resolve
 * ESCALA (um número contínuo) e ORIENTAÇÃO (retrato/paisagem); este hook
 * resolve uma pergunta diferente: "que FAIXA de dispositivo é este". `<Board
 * />` usa isso para escolher piso/teto de tamanho; tarefas futuras vão usá-lo
 * para decidir arranjo (onde armadilhas e HP moram na tela).
 */
export function useLayoutMode(): LayoutModeInfo {
  const { width, height } = useWindowDimensions();

  let mode: LayoutMode = width < COMPACT_MAX_WIDTH ? 'compact' : width < REGULAR_MAX_WIDTH ? 'regular' : 'wide';

  if (mode === 'wide' && height < WIDE_MIN_HEIGHT) {
    mode = 'regular';
  }

  return { mode, width, height };
}
