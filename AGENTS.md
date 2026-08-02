# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v57.0.0/ before writing any code.

# Invariantes de layout

Só o `<Board />` decide a geometria do tabuleiro. Nenhum ancestral da área de jogo aplica
`aspectRatio`, `maxWidth` ou `maxHeight`. Duas vezes já aconteceu de um ancestral pré-quadrar a
caixa (um `maxWidth`/`maxHeight` externo, depois um `aspectRatio` num container `row`) e o board
quadrar de novo por cima — o segundo cálculo nunca é o bug, é sintoma de um ancestral que não
devia estar decidindo forma nenhuma. O ancestral entrega espaço bruto (`flex:1` +
`alignSelf:'stretch'`); o `<Board />` mede as duas dimensões via `onLayout` e resolve o quadrado
sozinho.
