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

# Invariantes de domínio

Regra de domínio se garante no motor, não na camada acima. Se uma regra do jogo (de quem é a vez,
quem pode agir, o que é alvo válido) só é respeitada porque a UI não oferece o caminho, ela não
está implementada — está sendo evitada. Quatro ocorrências até aqui: um ancestral pré-quadrando a
geometria que só o `<Board />` deve decidir; um `aspectRatio` fazendo o mesmo em outra orientação;
`placeMark` sem checagem de dono do turno, protegido apenas por um `isLocalTurn()` que é `true`
permanente fora do modo online; e `resolveCardPlay` (Fase 3, `pendingInteraction`) sem checagem de
interação pendente — nada no motor impedia jogar uma 2ª carta enquanto a mira/escolha da 1ª estava
aberta, só `canDrag` (UI, `<CardItem />`) evitava o caminho. A guarda vive onde a regra vive.
