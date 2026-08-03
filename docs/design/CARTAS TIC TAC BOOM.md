**1 \- Baralho Infinito e Probabilidades (RNG Determinístico)** 

O jogo não terá um baralho finito decrescente. As cartas são geradas dinamicamente sob demanda. 

Drop Rate (chance de cada tipo de carta aparecer quando as cartas forem distribuídas):

**Comum (50%):** Controle de tabuleiro. É a base do jogo. Metade das compras deve ser para manipular o tabuleiro (ex: Limpar, Travar, Demolir). Isso garante que os jogadores sempre tenham ferramentas de 1⚡ para esvaziar a mão e lutar pelo espaço. 

**Rara (25%):** Vantagem tática e manipulação de mão/tabureiro . Cartas de vantagem (ex: comprar mais, roubar, espiar). Aparecem o suficiente para acelerar a partida e criar intriga. 

**Épica (15%):** Impacto direto, dano e cura. Dano, cura e pular turno. Sendo 15%, um jogador verá uma dessas a cada 6 ou 7 cartas compradas. Isso é perfeito para que o dano direto seja um evento importante, não um ataque básico. 

**Lendária (6%):** Cartas de virada de jogo. Cartas muito fortes (ex: Mina, Visão Absoluta). Raras o suficiente para gerar a sensação de "sorte grande" quando compradas.  
   
**Boom\! (4%):** Eventos de caos puro. Essas cartas são para mudar completamente o estado do jogo (unico exemplo por enquanto é a carta tic tac boom\!). Com 4%, elas funcionam como eventos esporádicos que quebram a partida de surpresa, sem banalizar a mecânica principal. 

**2 \- Motor de Energia e Tipagens** 

**Regra de Recarga:** No início do jogo a energia deles é cravada em 3⚡ (não é cumulativa). a enegia vai ser recarregada por turno (Ex: gastei 3 de energia no meu turno, no turno do adversario eu recupero um de energia {independente de quantas cartas ele usar}, voltou pra minha vez, recupero mais um de energia e agora tenho duas {supomos que o adversario gastou 2 de energia e tinha 1 sobrando, na miha vez ele vai recuperar 1 de energia, e na dele ele recupera mais 1, logo ele vai ter 3 de energia naves dele de novo  
})

**Validação de Custo:** Na função `playCard`, valide se a energia atual suporta o custo da carta. Se sim, deduza o valor; se não, aborte.

**UI (`CardHand.tsx`):** 

Cartas com `cost > currentEnergy` devem ficar visualmente desabilitadas (escurecidas/opacidade reduzida) na mão do jogador ativo.

**3 \-  Refatoração do Baralho** 

Reescreva os registros implementando as novas raridades e custos:

Aqui está o mapeamento completo do arsenal do jogo, estruturado por ordem crescente de raridade e detalhando os custos e efeitos exatos de cada carta. 

**Cartas Comuns (50%)**

​Custo baixo, focadas em controle básico de território e limpeza de tabuleiro.

| Carta  | Custo  | Tipo | Efeito Exato  |
| :---- | :---- | :---- | :---- |
| Limpar  | 1⚡  | Feitiço | Remove o status de "interditada/bloqueada" de 1 célula específica do tabuleiro.  |
| Travar  | 1⚡  | Feitiço | Altera o estado de 1 célula vazia para "bloqueada", impedindo que peças (X/O) sejam jogadas nela.  |
| Demolir  | 1⚡  | Feitiço | Remove 1 peça (X ou O) já colocada no tabuleiro, tornando a célula vazia novamente. (não afeta a fila infinita, apenas apaga a peça) |

**Cartas Raras (25% de chance)**

Foco em manipulação de baralho, obtenção de informações críticas e disrupção do ritmo do inimigo.

| Carta  | Custo  | Tipo | Efeito Exato  |
| :---- | :---- | :---- | :---- |
| **Estudar**  | **2⚡**  | **Compra**  | **O jogador saca 2 cartas do deck.** |
| Procrastinar  | **2⚡**  | **Compra**  | **Abre modal com 3 cartas aleatórias geradas pelo deck. O jogador escolhe 1 para a mão; as outras 2 são descartadas.**  |
| Espiada  | 1⚡  | Informação  | Abre modal mostrando o verso de todas as cartas do inimigo. O jogador escolhe 1 carta oculta da mão inimiga para revelar a face temporariamente. A carta permanece na mão do inimigo.  |
| Proteção  | 1⚡  | Armadilha  | Armadilha (Oculta). Engatilhada automaticamente se o oponente disparar "Saque" ou "Espionagem" contra você, anulando o efeito inimigo e destruindo a armadilha.  |
| Saque  | 2⚡  | Manipulação  | Rola RNG 50/50 antes da ação. **Destruição (50%):** Destrói 1 carta aleatória da mão inimiga. **Roubo (50%):** Abre modal para o jogador escolher qual carta oculta quer roubar para sua própria mão.  |
| Trocar  | 2⚡  | Manipulação  | Abre modal da mão inimiga. O jogador seleciona 1 carta da própria mão e escolhe 1 oculta do inimigo para efetuar a troca direta.  |
| Vidente  | 2⚡  | Informação  | Destaca visualmente para o jogador ativo qual é a peça "mais velha" do inimigo (a próxima que sumirá quando ele jogar a 4ª peça).  |
| Anomalia  | 2⚡  | Tabuleiro  | Altera a fila do oponente. A próxima peça inimiga a sumir ao colocar a 4ª será escolhida aleatoriamente pelo sistema, e não a mais velha.  |
| Antimagia  | 1⚡  | Armadilha  | **(Oculta)** Anula a carta de Feitiço/Efeito do oponente. Ele gasta a energia, mas a carta falha.  |
| Ricochete  | 1⚡  | Armadilha  | (Oculta) Se o oponente usar um efeito direcionado a você (Roubo, Dano, Troca), o efeito é invertido e atinge o próprio oponente.  |

**Cartas Épicas (15% de chance)**

Cartas de alto impacto que alteram o estado da partida, causam danos ou punições severas.

| Carta | Custo | Tipo | Efeito Exato  |
| :---- | :---- | :---- | :---- |
| Espionagem  | 2⚡  | Informação  | Abre modal mostrando o verso de todas as cartas do inimigo. O jogador escolhe 2 cartas para revelar e obter a informação. A carta permanece com o inimigo.  Se o jogador ativar a *Espionagem* e o oponente tiver apenas 1 carta, o jogo **não pode quebrar ou travar no modal** aguardando a seleção de uma segunda carta que não existe. A função deve ler o tamanho do *array* da mão do inimigo (`array.length`) e limitar a seleção ao máximo disponível. |
| Purificar  | 2⚡  | Feitiço  | Limpa absolutamente todos os efeitos persistentes (bloqueios, etc.) de *todas* as células do tabuleiro.  |
| Estudar II  | 2⚡  | Compra  | O jogador saca 3 cartas do topo do deck.  |
| Saque II | 3⚡  | Manipulação  | Rola RNG 50/50 antes da ação. **Destruição (25%):** Destrói 1 carta aleatória da mão inimiga. **Roubo (75%):** Abre modal para o jogador escolher qual carta oculta quer roubar para sua própria mão.  |
| Procrastinar II | 3⚡  | **Compra**  | Abre o modal com cartas ocultas selecionadas pelo jogo, o jogador escolhe uma entre 5 cartas com 100% de chance de vir de uma raridade especifica (2 comuns, 2 épicas e 1 lendaria) |
| Sabotagem  | 3⚡  | Manipulação  | Abre modal da mão inimiga. O jogador escolhe 1 carta oculta; ela é revelada e imediatamente descartada da mão do oponente.  |
| Rebobinar  | 3⚡  | Punição  | O oponente perde a fase de colocar a peça (X/O) no tabuleiro durante o próximo turno dele.  |
| Obsolescência  | 3⚡  | Tabuleiro  | O jogador seleciona 1 peça inimiga. O sistema marca esta peça como a "mais velha". Ela será forçadamente a próxima a sumir.  |
| Ataque  | 3⚡  | Combate  | Subtrai 1 ponto de HP do oponente.  |
| Cura  | 3⚡  | Combate  | Restaura 1 ponto de HP do jogador ativo (limite máximo de 5 HP).  |

**Cartas Lendárias (6% de chance)**

Ameaças de fim de jogo que exigem resposta imediata ou mudam completamente o panorama. (não podem ser paradas por armadilhas)

| Carta  | Custo | Tipo | Efeito Exato  |
| :---- | :---- | :---- | :---- |
| Visão Absoluta  | 3⚡  | Informação  | Revela a face de todas as cartas da mão do oponente até o fim do turno.  |
| Permuta Caótica  | 3⚡  | Manipulação  | Troca a sua mão inteira pela mão inteira do oponente.  |
| Mina  | 3⚡  | Armadilha  | **(Oculta)** Se o oponente colocar uma peça na casa central do tabuleiro, ele sofre 2 de dano no HP e o turno dele é encerrado imediatamente.  |

**Cartas Boom\! (4% de chance)**

Eventos anômalos que custam zero energia, mas afetam as regras fundamentais da partida. (Também ignoram qualquer armadilha)

| Carta  | Custo  | Tipo  | Efeito Exato  |
| :---- | :---- | :---- | :---- |
| TIC TAC BOOM\!  | 0⚡  | Evento  | Faz o tabuleiro se comportar como uma Slot Machine 3x3, as colunas vão girar e parar com uma animação, a primeira parou, vai aparecer na tela TIC, a segunda parou vai aparecer TAC, a terceira parou e aparece BOOM\! (para criar aquela expectativa pelo resultado). Ela sorteia novas posições no tabuleiro, para cada símbolo dando uma chance para ou o X ou o O marcar ponto caso feche uma fileira na horizontal, ou diagonal.Cuidados: não pode ter mais de 3 X ou O.   |
| Altar de Sacrifício  | 0⚡  | Evento  | Abre modal para descartar 2 cartas. Fundir cartas iguais sobe 1 grau de raridade. Fundir cartas diferentes nivela pela menor e sobe 1 grau. Fundir Lendárias garante uma Boom\!.  |

**4 \- UX/UI do Altar de Sacrifício** 

Prepare o componente `AltarModal.tsx` com uma abordagem de usabilidade híbrida (Mobile/Desktop friendly):

* Deve conter *slots* vazios de sacrifício.  
* **Interação Híbrida:** O jogador pode usar *Drag & Drop* para puxar a carta da mão para o slot, **OU** clicar em um slot vazio para destacá-lo e, em seguida, clicar na carta desejada na mão para transferi-la automaticamente.  
* **Mecânica base:** Descartar 2 cartas (qualquer) gera 1 de raridade superior garantida, com chance de subir duas raridades se as cartas descartadas já forem raras/épicas. (Implementaremos a matemática exata depois, apenas deixe a interface e o estado preparados para receber as cartas escolhidas e disparar a rede).

### **📝 Regras de Ouro do Motor (Para referência)**

1. **Resolução de Armadilhas (FIFO): Se houver conflito de armadilhas simultâneas (ex: Antimagia e Ricochete ativas), o motor resolve a mais antiga primeiro.**  
2. **Economia Estrita: 3⚡ por turno, sem acúmulo. A UI impedirá visualmente o uso de cartas cujo custo exceda a energia atual.**  
3. **Custo das armadilhas: O custo da armadilha é para armá-la e não para a sua ativação.**  
4. **Para manter o aspecto estrategico das cartas de espionagem é necessario que a interface mostre para o jogador qual carta de qual posição foi descartada, por exemplo, o inimigo tem 3 cartas, eu revelei a primeria dele, eu preciso que se ele use a segunda carta, o campo que mostra a mão dele oculta deve mostrar a carta do indice 2 com um efeito que mostre que ela está saindo. assim eu sei que a carta de indice 1 ainda não foi usada**

.

