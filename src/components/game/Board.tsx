import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';

import { Cell } from './Cell';
import { useLayoutMode } from '@/hooks/useLayoutMode';
import { colors } from '@/theme/colors';
import { BOARD_BOUNDS, MIN_PLAYABLE_BOARD } from '@/theme/layout';
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

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/* -------------------------------------------------------------------------- */
/*                                    PROPS                                    */
/* -------------------------------------------------------------------------- */

/** Payload de `onResolvedSize` — `null` quando não coube board nenhum. */
export interface BoardResolvedSize {
  boardSize: number;
  cellSize: number;
}

export interface BoardProps {
  style?: StyleProp<ViewStyle>;
  /**
   * Reporta o resultado do cálculo interno para cima — NÃO um canal para o
   * pai influenciar o resultado. O board continua a única fórmula: mede a
   * própria caixa, decide o próprio tamanho; isto só avisa qual foi a
   * decisão, para quem precisa saber (ex: `[mode].tsx` calculando quanta
   * margem sobra para aproximar as sidebars do tabuleiro sem arriscar
   * encolhê-lo — ver A2.1).
   */
  onResolvedSize?: (size: BoardResolvedSize | null) => void;
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
 *
 * O board é dono da própria fórmula de tamanho: mede a caixa que recebeu
 * (`onLayout`) e decide sozinho, via `useLayoutMode` + `BOARD_BOUNDS`, sem
 * receber um teto de fora. Isto NÃO garante que a caixa recebida seja grande
 * o bastante — dar ao board o espaço certo é responsabilidade de quem monta
 * o layout ao redor dele (ver `[mode].tsx`); esta é só a metade "quanto
 * render dado o que me deram", não a metade "quanto me deram".
 */
export function Board({ style, onResolvedSize }: BoardProps) {
  const [available, setAvailable] = useState({ width: 0, height: 0 });
  const isTargeting = useGameStore(selectIsTargeting);
  const { mode } = useLayoutMode();
  const { MAX_BOARD, GUTTER } = BOARD_BOUNDS[mode];

  /**
   * `onResolvedSize` guardado em ref, não em dependência de efeito.
   *
   * `[mode].tsx` pode perfeitamente passar uma arrow inline (ou até uma
   * função memoizada com `useCallback`) — de qualquer forma, este componente
   * não deveria precisar CONFIAR na disciplina de memoização do pai para não
   * entrar em loop. A ref lê sempre a versão mais nova do callback sem nunca
   * fazer parte da lista de dependências do efeito abaixo, então uma
   * identidade de função que muda a cada render do pai não dispara o efeito
   * de novo sozinha.
   */
  const onResolvedSizeRef = useRef(onResolvedSize);
  onResolvedSizeRef.current = onResolvedSize;

  /**
   * Mede as DUAS dimensões da caixa disponível.
   *
   * Medir só a largura era a causa raiz da sobreposição entre o tabuleiro e as
   * zonas vizinhas: num celular baixo, a linha central recebia (digamos) 180dp
   * de altura e 360dp de largura, o tabuleiro se dimensionava pelos 360 e
   * desenhava 240dp de lado dentro de um container de 180 — como o container
   * centraliza o conteúdo e nada em React Native recorta por padrão, os 60dp
   * de excesso simplesmente vazavam 30 para cima e 30 para baixo, por cima do
   * que estivesse lá. Nenhum `position:absolute` estava envolvido; era uma
   * caixa maior que o buraco onde ela deveria caber.
   */
  const handleLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setAvailable((prev) =>
      Math.abs(prev.width - width) < 1 && Math.abs(prev.height - height) < 1
        ? prev
        : { width, height },
    );
  }, []);

  /**
   * Resolve o tamanho de fora para dentro e depois RECONSTRÓI o lado do
   * tabuleiro a partir do inteiro da célula. Assim a moldura fecha exatamente
   * sobre o grid, sem sobra de meio pixel na borda direita/inferior.
   *
   * `hardCeiling` é o teto FÍSICO — a menor dimensão da caixa que de fato
   * recebemos — e SEMPRE vence. `clamp(target, 0, MAX_BOARD)` só resolve a
   * preferência (nunca negativa, nunca maior que `MAX_BOARD`); o `Math.min`
   * seguinte é quem garante que essa preferência nunca ultrapasse o espaço
   * físico. No Android isso não é só estética: a área que um pai com
   * `overflow` corta também para de responder a toque. Preferimos um board
   * pequeno demais (ou, no limite, nenhum — ver os `return null` abaixo) a um
   * board bonito que não pode ser tocado inteiro.
   */
  const layout = useMemo(() => {
    // A altura só entra na conta quando de fato foi medida (>0) — se o pai
    // não impuser altura nenhuma, um zero aqui zeraria o tabuleiro inteiro.
    const hardCeiling = Math.min(
      available.width,
      available.height > 0 ? available.height : Number.POSITIVE_INFINITY,
    );
    if (hardCeiling <= 0) {
      if (__DEV__) {
        console.warn(
          '[Board] sem espaço nenhum para desenhar — a linha de combate mediu uma caixa vazia.',
          { mode, availableW: available.width, availableH: available.height },
        );
      }
      return null;
    }

    const target = hardCeiling - GUTTER;
    const preferred = clamp(target, 0, MAX_BOARD);
    const outer = Math.min(preferred, hardCeiling);

    if (outer <= 0) {
      if (__DEV__) {
        console.warn(
          '[Board] orçamento de espaço da linha de combate estourou — nem a moldura mínima coube.',
          { mode, availableW: available.width, availableH: available.height, outer },
        );
      }
      return null;
    }

    const inner = outer - FRAME * 2; // área útil do grid
    const cellSize = Math.floor((inner - GRID_LINE * 4) / 3);

    if (cellSize <= 0) {
      if (__DEV__) {
        console.warn(
          '[Board] orçamento de espaço da linha de combate estourou — a moldura coube, a grade não.',
          { mode, availableW: available.width, availableH: available.height, outer },
        );
      }
      return null;
    }

    const gridSize = cellSize * 3 + GRID_LINE * 4;
    const boardSize = gridSize + FRAME * 2;

    if (__DEV__) {
      console.log('[Board] layout', {
        mode,
        availableW: available.width,
        availableH: available.height,
        outer,
        cellSize,
      });

      if (boardSize < MIN_PLAYABLE_BOARD) {
        console.warn(
          '[Board] boardSize abaixo do piso jogável — o orçamento de espaço da linha de combate ' +
            'ao redor do board está estourado (armadilhas + HUD + mão sobraram pouco para o board).',
          { mode, availableW: available.width, availableH: available.height, boardSize },
        );
      }
    }

    return { cellSize, gridSize, boardSize };
  }, [available, mode, MAX_BOARD, GUTTER]);

  /**
   * Reporta o resultado para cima — só quando `boardSize`/`cellSize` de fato
   * mudam de VALOR, nunca porque `layout` virou um objeto novo.
   *
   * `layout` é recriado pelo `useMemo` acima toda vez que `available` muda de
   * identidade — inclusive quando a mudança medida é pequena demais para
   * alterar o resultado final (ex: o próprio `[mode].tsx` aplicando um inset
   * nas sidebars, que encolhe a caixa medida sem encolher `boardSize`, pela
   * garantia do clamp). Depender de `layout` inteiro repetiria o report a
   * cada uma dessas remedições; depender dos dois números primitivos faz o
   * efeito disparar só quando a decisão de fato mudou.
   */
  useEffect(() => {
    onResolvedSizeRef.current?.(layout ? { boardSize: layout.boardSize, cellSize: layout.cellSize } : null);
    // Deps deliberadamente os dois PRIMITIVOS lidos do `layout`, não o objeto
    // `layout` inteiro — ver o comentário acima.
  }, [layout?.boardSize, layout?.cellSize]);

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
  /**
   * `flex:1` + `alignSelf:'stretch'` em vez de `width:'100%'`: para o
   * `onLayout` acima poder medir a ALTURA disponível, a raiz precisa preencher
   * a caixa do pai nos dois eixos. Com a altura derivada do conteúdo (o que
   * `width:'100%'` sozinho produz numa coluna), a medida seria a do próprio
   * tabuleiro — circular, e portanto inútil como limite.
   */
  root: {
    flex: 1,
    alignSelf: 'stretch',
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
