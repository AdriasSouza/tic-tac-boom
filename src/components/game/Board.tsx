import { useCallback, useMemo, useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';

import { Cell } from './Cell';
import { colors } from '@/theme/colors';
import { selectIsTargeting, useGameStore } from '@/store/gameStore';

/* -------------------------------------------------------------------------- */
/*                                  CONSTANTES                                 */
/* -------------------------------------------------------------------------- */

/** Espessura do traço entre as células, em dp. Sempre inteiro. */
const GRID_LINE = 4;

/** Espessura da moldura externa (efeito de bisel chapado). */
const FRAME = 6;

/** Índices 0..8, criados uma vez só. */
const CELL_INDEXES = Array.from({ length: 9 }, (_, i) => i);

/* -------------------------------------------------------------------------- */
/*                                    PROPS                                    */
/* -------------------------------------------------------------------------- */

export interface BoardProps {
  /** Limite máximo do lado do tabuleiro em dp. */
  maxSize?: number;
  style?: StyleProp<ViewStyle>;
}

/* -------------------------------------------------------------------------- */
/*                                  COMPONENTE                                 */
/* -------------------------------------------------------------------------- */

/**
 * Grid 3x3 do jogo.
 *
 * Assina um único booleano (`selectIsTargeting`) para trocar a moldura no modo
 * mira. Nada mais: toda reatividade de jogo mora dentro de cada `<Cell />`, e
 * como a `Cell` é memoizada por `index`/`size`, um render do Board não propaga
 * para as células.
 *
 * O alinhamento usa aritmética inteira — em pixel art, célula com largura
 * fracionária (`33.333%`) faz o Android arredondar linhas de forma desigual e
 * o grid sai visivelmente torto.
 */
export function Board({ maxSize = 420, style }: BoardProps) {
  const [available, setAvailable] = useState(0);
  const isTargeting = useGameStore(selectIsTargeting);

  const handleLayout = useCallback((event: LayoutChangeEvent) => {
    const { width } = event.nativeEvent.layout;
    setAvailable((prev) => (Math.abs(prev - width) < 1 ? prev : width));
  }, []);

  /**
   * Resolve o tamanho de fora para dentro e depois RECONSTRÓI o lado do
   * tabuleiro a partir do inteiro da célula. Assim a moldura fecha exatamente
   * sobre o grid, sem sobra de meio pixel na borda direita/inferior.
   */
  const layout = useMemo(() => {
    const outer = Math.min(available, maxSize);
    if (outer <= 0) return null;

    const inner = outer - FRAME * 2; // área útil do grid
    const cellSize = Math.floor((inner - GRID_LINE * 4) / 3);
    if (cellSize <= 0) return null;

    const gridSize = cellSize * 3 + GRID_LINE * 4;
    return { cellSize, gridSize, boardSize: gridSize + FRAME * 2 };
  }, [available, maxSize]);

  return (
    <View style={[styles.root, style]} onLayout={handleLayout}>
      {layout && (
        <View
          style={[
            styles.frame,
            { width: layout.boardSize, height: layout.boardSize },
            // Modo mira: a moldura inteira muda de cor. Sinaliza que o
            // tabuleiro trocou de modo antes mesmo do olhar chegar nas células.
            isTargeting && styles.frameTargeting,
          ]}
        >
          {/* Bisel pixel art: 2 barras chapadas, sem gradiente. */}
          <View
            style={[styles.frameLight, isTargeting && styles.frameLightTargeting]}
            pointerEvents="none"
          />
          <View style={styles.frameShadow} pointerEvents="none" />

          {/*
            O fundo do grid É o traço. As células ficam por cima com `gap`,
            então as linhas são o próprio background aparecendo entre elas —
            uma borda só, nunca duas encostadas somando espessura.
          */}
          <View
            style={[
              styles.grid,
              { width: layout.gridSize, height: layout.gridSize, padding: GRID_LINE },
            ]}
          >
            {CELL_INDEXES.map((index) => (
              <Cell key={index} index={index} size={layout.cellSize} />
            ))}
          </View>
        </View>
      )}
    </View>
  );
}

export default Board;

/* -------------------------------------------------------------------------- */
/*                                   ESTILOS                                   */
/* -------------------------------------------------------------------------- */

const styles = StyleSheet.create({
  root: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  frame: {
    backgroundColor: colors.boardFrame,
    alignItems: 'center',
    justifyContent: 'center',
    // Sombra chapada e deslocada: o "drop shadow" típico de pixel art.
    // Nada de elevation/shadowRadius, que borra a aresta.
    borderWidth: 2,
    borderColor: colors.boardFrameShadow,
  },
  frameTargeting: {
    backgroundColor: '#6b5a1f',
    borderColor: colors.winGlow,
  },
  frameLight: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 3,
    backgroundColor: colors.boardFrameLight,
  },
  frameLightTargeting: {
    backgroundColor: colors.winGlow,
  },
  frameShadow: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 3,
    backgroundColor: colors.boardFrameShadow,
  },
  grid: {
    backgroundColor: colors.boardGrid,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: GRID_LINE,
  },
});
