@AGENTS.md

1. Energia — regra de recarga
Cada jogador começa a partida com 3 de energia. Ao final de qualquer turno, ambos os jogadores ganham +1 de energia, com teto de 3 de energia. A energia não gasta permanece entre turnos. A energia nunca passa de 3.

2. Cartas que mudaram de significado entre README e PDF
Nome	implementado hoje	novo	Faça
REBOBINAR	EXTRA_TURN — sua jogada não passa a vez	Punição — oponente perde a fase de colocar peça	A carta antiga é renomeada para TURNO_EXTRA e representa a versão anterior de REBOBINAR.
PURIFICAR	remove uma interdição	remove todos os efeitos persistentes do tabuleiro	A versão nova de PURIFICAR remove todos os efeitos persistentes do tabuleiro.

TROCA	HAND_SWAP — troca a mão inteira	Trocar (rara) troca 1 carta; Permuta Caótica (lendária) troca a mão inteira	A carta atual vira Permuta Caótica.
SAQUE	50% rouba, senão destrói	Saque 50/50 e Saque II 25/75	O roubo abre modal de escolha em vez de ser aleatório.

3. Compra com a mão cheia
Mão máxima de 5 cartas. Se um efeito de compra (Estudar, Estudar II,
Procrastinar) sacar mais cartas do que cabem, a mão enche até 5 e o
excedente é descartado. A UI avisa quando isso acontece.

4. Mina e Antimagia
Antimagia não anula a Mina — nem ao armar, nem ao detonar. Mina é
lendária, e cartas lendárias ignoram armadilhas.

5. Escada de raridade (Altar de Sacrifício)
COMUM → RARA → ÉPICA → LENDÁRIA → BOOM.
Cartas de mesma raridade: resultado = raridade + 1.
Cartas de raridades diferentes: resultado = min(a, b) + 1.
LENDÁRIA + LENDÁRIA = BOOM.
BOOM + BOOM = BOOM.

6. Deck infinito e RNG
Todo sorteio de carta — raridade e carta dentro da raridade — sai do canal
CARDS do RNG semeado. Math.random() só existe em generateSeed(). A mesma
seed reproduz a mesma sequência de cartas.

7. Identidade de cartas na mão
Toda carta na mão tem uid estável e único; índice de array nunca é identidade.
Carta que entra na mão entra sempre pelo fim (push), nunca no meio nem no
início. O rastreamento posicional da mão do oponente depende disso.

8. Testes da engine
src/engine/ é TypeScript puro e não importa React. Toda carta nova ou
alterada vem com teste na mesma entrega, não numa fase posterior.