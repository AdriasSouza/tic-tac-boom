@AGENTS.md

1. Energia — regra de recarga
Cada jogador começa a partida com 3 de energia. Ao final de qualquer turno, ambos os jogadores ganham +1 de energia, com teto de 3 de energia. A energia não gasta permanece entre turnos. A energia nunca passa de 3.

2. Cartas que mudaram de significado entre README e PDF
Nome	implementado hoje	novo	Faça
REBOBINAR	EXTRA_TURN — sua jogada não passa a vez	Punição — oponente perde a fase de colocar peça	A carta antiga é renomeada para TURNO_EXTRA e representa a versão anterior de REBOBINAR.
PURIFICAR	remove uma interdição	remove todos os efeitos persistentes do tabuleiro	A versão nova de PURIFICAR remove todos os efeitos persistentes do tabuleiro.

TROCA	HAND_SWAP — troca a mão inteira	Trocar (rara) troca 1 carta; Permuta Caótica (lendária) troca a mão inteira	A carta atual vira Permuta Caótica.
SAQUE	50% rouba, senão destrói	Saque 50/50 e Saque II 25/75	O roubo abre modal de escolha em vez de ser aleatório.

3. Limite de mão vs. cartas que compram 2–3

README diz mão máxima de 5. Estudar II saca 3. O que acontece se a mão tem 4? Escolha uma: (a) compra até encher e o excedente é descartado, (b) a carta não pode ser jogada com a mão cheia, (c) sobe o teto de mão pra 7. Recomendo (a) + a UI avisando, é o menos frustrante.
R: Escolho a opção a com a UI Avisando

4. Armadilhas: "lendárias e Boom ignoram armadilhas" vs. Mina

Mina é lendária e é armadilha. A regra "não podem ser paradas por armadilhas" se aplica a ela sendo alvo de Antimagia? Sugestão: sim — Antimagia não anula o armar nem o detonar de uma Mina.
R: Sim a antimagia não anula nem o armar nem o detonar da mina

5. Escada de raridade do Altar

Defina explicitamente: COMUM → RARA → ÉPICA → LENDÁRIA → BOOM. "Fundir diferentes nivela pela menor e sobe 1" = min(a,b) + 1. "Fundir lendárias garante uma Boom" = consistente com a escada. Boom + Boom = ? (sugestão: continua Boom).
R: Boom + Boom = Boom.

6. Deck infinito e RNG determinístico

O README diz que a seed reproduz a partida inteira. Deck infinito com drop rate por raridade precisa continuar saindo do canal CARDS do RNG semeado, não de Math.random(). Isso vira critério de aceitação da Fase 1.