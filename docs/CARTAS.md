  # Especificação de cartas — Tic Tac Boom

  Fonte primária: [`docs/design/CARTAS TIC TAC BOOM.md`](design/CARTAS%20TIC%20TAC%20BOOM.md) (o
  "PDF" citado abaixo). Decisões de ambiguidade entre esse documento e a implementação anterior já
  fechadas: `CLAUDE.md`, na raiz do repo — tratadas como lei nesta spec, não reabertas aqui. Todas
  as Pendências da rodada anterior deste documento foram respondidas — ver o fim do arquivo.

  Este documento é **spec, não changelog**: descreve o que cada carta deve fazer daqui pra frente.
  Onde o comportamento ATUAL do motor (`src/engine/cards/`) diverge do que está descrito aqui, isso
  é dito explicitamente como "hoje" vs. o resto do texto (o alvo) — ver também
  `docs/MIGRACAO_CARTAS.md` para o comparativo carta a carta e a auditoria de consumidores dos ids
  renomeados.

  **IDs técnicos:**
  - Cartas que HOJE existem e mudam de nome (`hoje X`) têm um id NOVO confirmado — não é sugestão,
    é decisão desta rodada (ex: `DRAW_CARD` → `STUDY`). A Fase 1 precisa renomear o id no código,
    não só o texto exibido — ver a auditoria de consumidores em `docs/MIGRACAO_CARTAS.md`.
  - Cartas marcadas **(novo)** não existem ainda no código — os ids são SUGESTÃO, livres para
    ajuste na Fase 1, desde que a tabela de migração seja atualizada junto.

  Convenções usadas em cada entrada:
  - **Categoria (PDF):** o rótulo de sabor do próprio design doc (Feitiço, Compra, Informação,
    Manipulação, Tabuleiro, Combate, Punição, Armadilha, Evento) — eixo de FLAVOR, não decide nada
    no motor.
  - **Tipo (motor):** `ACTION` (resolve na hora) ou `TRAP` (vai virada na mesa, dispara depois) —
    eixo MECÂNICO, é o que o engine (`CardType`) de fato consulta.
  - **Anulável por armadilha:** ANTIMAGIA tem cobertura UNIVERSAL (qualquer carta não-Lendária/
    não-Boom — ver "Regras transversais"), então quase toda entrada abaixo diz "Sim, por
    ANTIMAGIA". O campo também lista PROTEÇÃO/RICOCHETE quando aplicável, já que essas duas têm
    escopo mais estreito e vale saber exatamente quais cartas cobrem.

  ---

  ## Comuns — 50%

  Controle básico de território. Custo baixo, para nunca faltar ferramenta de 1⚡ na mão.

  ### LIMPAR (`CLEAR_BLOCK`)
  - **Custo:** 1⚡ · **Categoria (PDF):** Feitiço · **Tipo (motor):** `ACTION`
  - **Efeito exato:** Remove QUALQUER efeito persistente de 1 célula específica escolhida pelo
    jogador — cobre tanto o bloqueio da regra caótica (`BLOCKED_CELL`) quanto o lacre da TRAVAR.
    Leitura LARGA confirmada: LIMPAR e TRAVAR são o par de controle da tier comum, e um 1⚡ que só
    pudesse ser desfeito por um épico de 2⚡ (PURIFICAR) quebraria essa economia.
  - **Abre modal:** Não. **Exige alvo no tabuleiro:** Sim — 1 célula, e só é alvo válido uma
    célula com algum efeito persistente ativo (bloqueio do caos OU lacre da TRAVAR).
  - **Anulável por armadilha:** Sim, por ANTIMAGIA (cobertura universal).
  - **Casos de borda:**
    - Mão do oponente vazia — não se aplica (carta não lê a mão de ninguém).
    - Mão cheia — não se aplica (não compra carta).
    - Tabuleiro sem alvo válido (nenhuma célula com efeito persistente) — carta fica
      indisponível para jogar (`canPlay` falso), não chega a ser selecionável.
  - **Nota de migração:** EFEITO ALTERADO. O `CLEAR_BLOCK` atual só cobre o bloqueio do caos —
    precisa ganhar a checagem do lacre da TRAVAR (que hoje só a `CLEANSE`/PURIFICAR de 1 célula
    fazia, antes dela virar tabuleiro-inteiro).

  ### TRAVAR (`LOCK_CELL`)
  - **Custo:** 1⚡ · **Categoria (PDF):** Feitiço · **Tipo (motor):** `ACTION`
  - **Efeito exato:** Lacra 1 célula vazia escolhida pelo jogador — o oponente não pode jogar peça
    nela. Duração: 2 turnos globais (cobre a fase de ação inteira do adversário; ver "Regras
    transversais").
  - **Abre modal:** Não. **Exige alvo no tabuleiro:** Sim — 1 célula vazia e ainda não lacrada.
  - **Anulável por armadilha:** Sim, por ANTIMAGIA (cobertura universal).
  - **Casos de borda:**
    - Mão do oponente vazia / mão cheia — não se aplicam.
    - Tabuleiro sem alvo válido (nenhuma célula vazia e destravada) — indisponível para jogar.

  ### VIDENTE (`HIGHLIGHT_OLDEST`, novo)
  - **Custo:** 1⚡ · **Categoria (PDF):** Informação · **Tipo (motor):** `ACTION`
  - **Efeito exato:** Destaca visualmente, só para o jogador que a jogou, qual peça do oponente
    é a próxima a sumir pela regra do infinito. Não altera a fila do "infinito" nem destrói nada —
    é leitura pura; o destaque em si É estado efêmero (`highlightedOldestFor`,
    `src/engine/rules.ts`), consultado só pela apresentação, nunca por outra regra do motor.
    Expira quando o turno de quem jogou termina, ou antes disso se a peça destacada sair do
    tabuleiro por outro caminho (auto-invalidação por identidade — mesma ideia do
    `forcedVanish`/AMALDIÇOAR).
  - **Abre modal:** Não (destaque na própria tela do tabuleiro). **Exige alvo no tabuleiro:** Não.
  - **Anulável por armadilha:** Sim, por ANTIMAGIA (cobertura universal). Não coberta por
    PROTEÇÃO (não lê/retira mão) nem por RICOCHETE (não é um efeito direcionado a você — é leitura
    do estado do TABULEIRO do oponente, não um ataque aos seus recursos).
  - **Casos de borda:**
    - **Tabuleiro sem alvo válido** (oponente com menos de 3 peças no tabuleiro): carta
      indisponível para jogar (patch pós-Fase 7a — antes bastava >=1 peça; ver "Rebalanceamento"
      abaixo para o motivo da virada).
    - Mão do oponente vazia / mão cheia — não se aplicam.
  - **Patch pós-Fase 7a — funciona contra AMALDIÇOAR e contra o surto RANDOM_FADE do terminal do
    caos:** "a peça que vai sumir" nem sempre é a cronologicamente mais antiga
    (`getPieceIndexes[0]`) — se AMALDIÇOAR já marcou uma peça específica (`forcedVanish.mode ===
    'CHOSEN'`) ou o surto RANDOM_FADE está ativo, VIDENTE revela a peça REAL que vai sumir, não a
    mais velha por ordem cronológica:
    - `CHOSEN` (AMALDIÇOAR): usa o índice marcado diretamente — determinístico, sem RNG.
    - `RANDOM`/`RANDOM_FADE`: o sorteio de verdade só acontece no instante da remoção
      (`getVanishingIndex`, `src/engine/rules.ts`) — para revelar isso ANTES, VIDENTE espia o
      canal `BOARD` do RNG sem consumi-lo de verdade (`snapshotRng()` → sorteia → `restoreRng()`,
      mesma técnica de PRESSÁGIO no baralho, abaixo). Efeito colateral ACEITO: se algo mais
      consumir o canal `BOARD` entre o VIDENTE e a remoção de verdade, a previsão fica
      desatualizada — raro, e do mesmo espírito "caótico" do resto do baralho.
  - **Rebalanceamento (análise de mesa, pós-Fase 2 e pós-Fase 7a):** RARA/2⚡ → COMUM/1⚡ (Fase 2,
    quando virou informação pura). `canPlay` endurecido de >=1 para >=3 peças do oponente no patch
    pós-Fase 7a: com menos de 3 peças a informação já era óbvia de graça olhando o tabuleiro, e
    "a próxima a sumir" não faz sentido nenhum antes da fila do infinito valer para o dono.
  - **Nota de migração:** carta NOVA — o `REVEAL_OLDEST` atual já não faz mais isto (marca e
    destrói de verdade — ver AMALDIÇOAR, agora nas Raras, sua sucessora direta).

  ### RENOVAR (`RENEW_PIECE`, novo — patch pós-Fase 7a)
  - **Custo:** 1⚡ · **Categoria (PDF):** Feitiço (Estratégia) · **Tipo (motor):** `ACTION`
  - **Efeito exato:** O jogador escolhe 1 das próprias peças no tabuleiro. O motor recarimba
    `turnPlaced` da peça para o turno atual — na prática, ela passa a ser lida como a "mais nova"
    da fila e será a última a sumir. O índice no tabuleiro não muda, só a idade na fila.
  - **Abre modal:** Não. **Exige alvo no tabuleiro:** Sim — 1 peça própria.
  - **Anulável por armadilha:** Sim, por ANTIMAGIA (cobertura universal).
  - **Casos de borda:**
    - **Indisponível com menos de 2 peças próprias no tabuleiro** — com 1 peça só, ela já é a mais
      nova de qualquer jeito, não há o que renovar.
    - Mão do oponente vazia / mão cheia — não se aplicam.
  - **Efeito colateral de graça:** se a peça escolhida estava marcada por AMALDIÇOAR
    (`forcedVanish.mode === 'CHOSEN'`) ou destacada por VIDENTE (`highlightedOldestFor`), renovar
    muda a identidade da peça (`owner`+`turnPlaced`) e a marca/destaque se auto-invalida sozinho —
    mesmo mecanismo que já protege DEMOLIR e o reshuffle do TIC TAC BOOM!, sem código extra.
  - **Nota de migração:** carta NOVA.

  ### RECICLAR (`MULLIGAN`, novo — patch pós-Fase 7a)
  - **Custo:** 1⚡ · **Categoria (PDF):** Utilidade / Mão · **Tipo (motor):** `ACTION`
  - **Efeito exato:** O jogador descarta 1 carta da própria mão (escolha manual, não RNG) e, em
    seguida, compra 1 carta nova do baralho infinito.
  - **Abre modal:** Sim — escolha de qual carta descartar, entre a PRÓPRIA mão (face-up, é a mão
    de quem escolhe). **Exige alvo no tabuleiro:** Não.
  - **Anulável por armadilha:** Sim, por ANTIMAGIA (cobertura universal). Não aciona PROTEÇÃO nem
    RICOCHETE — só afeta a própria mão do caster, não é um efeito direcionado ao oponente.
  - **Casos de borda:**
    - **Indisponível se a RECICLAR for a única carta na mão** — não haveria o que descartar.
    - Mão do oponente vazia / tabuleiro — não se aplicam.
  - **Nota de migração:** carta NOVA.

  ### DESLIZAR (`SLIDE_PIECE`, novo — patch pós-Fase 7a)
  - **Custo:** 1⚡ · **Categoria (PDF):** Feitiço (Território) · **Tipo (motor):** `ACTION`
  - **Efeito exato:** Move 1 das próprias peças para uma célula vazia ortogonalmente adjacente
    (cima, baixo, esquerda ou direita — sem diagonais). Não altera `turnPlaced` — é posição, não
    idade na fila (diferente de RENOVAR, acima).
  - **Abre modal:** Não. **Exige alvo no tabuleiro:** Sim, em 2 passos — primeiro a peça própria
    (só é alvo válido se tiver >=1 vizinho ortogonal vazio), depois a célula de destino (só os
    vizinhos vazios calculados no 1º passo, sem recalcular a regra na UI).
  - **Anulável por armadilha:** Sim, por ANTIMAGIA (cobertura universal).
  - **Casos de borda:**
    - **Indisponível se o jogador não tiver peças, ou se nenhuma delas tiver vizinho vazio.**
    - Mão do oponente vazia / mão cheia — não se aplicam.
  - **Nota de migração:** carta NOVA. Único card do baralho a abrir um `kind` de
    `pendingInteraction` genuinamente NOVO (`PICK_BOARD_CELL`) — `BOARD_TARGET` (o 1º passo) nunca
    pode ser pedido 2x em sequência por design (só o motor de resolução de carta o abre, nunca
    `effect()`), então "escolher célula → escolher OUTRA célula" precisa de um `kind` que nasça de
    `effect()` de verdade, fluindo pelo mesmo caminho genérico de reentrada que os outros 4 `kind`s
    (`PICK_ONE_FROM_HAND` etc.) já usam.

  ### TROPEÇAR (`TRIP_PIECE`, novo)
  - **Custo:** 1⚡ · **Categoria (PDF):** Feitiço (Território) · **Tipo (motor):** `ACTION`
  - **Efeito exato:** Espelho de DESLIZAR com o alvo invertido — move 1 peça do OPONENTE (não do
    caster) para uma célula vazia ortogonalmente adjacente (sem diagonais). Não altera
    `turnPlaced` — é posição, não idade na fila, igual DESLIZAR.
  - **Abre modal:** Não. **Exige alvo no tabuleiro:** Sim, em 2 passos — primeiro a peça do
    OPONENTE (só é alvo válido se tiver >=1 vizinho ortogonal vazio E disponível), depois a célula
    de destino (vizinhos calculados no 1º passo). Reaproveita `eligibleSlideDestinations`
    (`rules.ts`) que DESLIZAR também usa — as duas cartas nasceram já corrigidas para nunca
    oferecer uma célula travada por TRAVAR ou interditada pela regra de caos `BLOCKED_CELL` como
    destino (bug encontrado e corrigido nas duas ao mesmo tempo, ver Parte 1 do plano desta
    entrega).
  - **Anulável por armadilha:** Sim, por ANTIMAGIA (cobertura universal).
  - **Casos de borda:**
    - **Indisponível se o oponente não tiver peças, ou se nenhuma delas tiver vizinho vazio
      disponível.**
    - Mirar a própria peça (em vez da do oponente) é sempre alvo inválido.
  - **Nota de migração:** carta NOVA. Reaproveita o `kind: 'PICK_BOARD_CELL'` que DESLIZAR já abriu
    — nenhum `pendingInteraction` novo. CPU: heurística DEFENSIVA e não ofensiva (`findDisruptiveTrip`,
    `cpu.ts`) — TROPEÇAR nunca fecha linha pra CPU (move a peça do humano, não a própria), então o
    gatilho é desarmar uma ameaça de vitória iminente do humano (2 peças na linha + 1 célula vazia),
    tirando uma delas da linha.

  ### PRESSÁGIO (`SCRY_DECK`, novo — patch pós-Fase 7a)
  - **Custo:** 1⚡ · **Categoria (PDF):** Informação · **Tipo (motor):** `ACTION`
  - **Efeito exato:** Abre um modal mostrando as 3 próximas cartas do topo do baralho global, na
    ordem, SEM comprá-las — só uma olhada.
  - **Não é garantia de posse:** o baralho é uma fila ÚNICA, compartilhada pelos dois lados (ver
    "Mecanismo" abaixo) — não existe "a próxima carta DO jogador", só "a próxima carta a sair do
    canal `CARDS`". O texto da carta e o modal deixam isso explícito para não insinuar que as 3
    cartas mostradas necessariamente vão parar na mão de quem espiou.
  - **Abre modal:** Sim (visualização, sem seleção — botão único de confirmação). **Exige alvo no
    tabuleiro:** Não.
  - **Anulável por armadilha:** Sim, por ANTIMAGIA (cobertura universal).
  - **Casos de borda:** sem `canPlay` — sempre jogável.
  - **Mecanismo:** o baralho é infinito, não existe uma fila de "próximas cartas" pré-gerada — cada
    compra sorteia sob demanda do canal `CARDS` do RNG. Para "olhar sem consumir", o efeito espia:
    `snapshotRng()` → sorteia 3× (mesma função `drawCardId` de uma compra normal) → `restoreRng()`
    devolve o cursor exatamente ao ponto de antes, então a PRÓXIMA compra de verdade sai igual a se
    a espiada nunca tivesse acontecido. Reaproveita `kind: 'INTEL_FLIP'` (já existe para VISÃO
    ABSOLUTA — "reveladas automaticamente, sem seleção") em vez de inventar um `kind` de
    `pendingInteraction` novo: é leitura pura, não interação.
  - **Efeito colateral ACEITO, não bug:** se algo mais consumir o canal `CARDS` entre PRESSÁGIO e a
    próxima compra real (outro PROCRASTINAR, SAQUE, o Altar), a previsão fica desatualizada. Dito
    pelo próprio pedido do patch: "o que é ótimo e caótico".
  - **Nota de migração:** carta NOVA.

  ### BATERIA RESERVA (`BACKUP_BATTERY`, novo — patch de defesa)
  - **Custo:** 1⚡ · **Categoria (PDF):** Utilidade / Combate · **Tipo (motor):** `ACTION`
  - **Efeito exato:** Ativa um escudo de 1 uso: o PRÓXIMO dano que o jogador ativo sofreria —
    qualquer que seja a origem (ATAQUE, MINA, SAQUE II refletido, dano de rodada perdida) — é
    absorvido por completo em vez de reduzir o HP. A checagem vive direto em `takeDamage`
    (`gameStore.ts`), antes de qualquer clamp de HP: contraparte barata de CURA (3⚡, conserta dano
    já sofrido) — esta previne 1 dano futuro por 1⚡.
  - **Abre modal:** Não. **Exige alvo no tabuleiro:** Não.
  - **Anulável por armadilha:** Sim, por ANTIMAGIA (cobertura universal).
  - **Casos de borda:**
    - Jogável mesmo com HP cheio — o escudo protege dano futuro, não repõe HP perdido.
    - **Indisponível com o escudo já ativo** — não empilha, uma 2ª Bateria enquanto a 1ª está de pé
      seria desperdício. `canPlay` bloqueia em vez de deixar jogar e desperdiçar.
  - **Nota de migração:** carta NOVA.

  ---

  ## Raras — 25%

  Vantagem tática: manipulação de mão, informação, disrupção de ritmo.

  ### ESTUDAR (`STUDY` — hoje `DRAW_CARD`)
  > **Raridade pós-Fase 7a: ÉPICA** (esta entrada segue listada em Raras por localização
  > histórica do documento — ver "Épicas", abaixo, para o resto das cartas dessa faixa).
  - **Custo:** 2⚡ · **Categoria (PDF):** Compra · **Tipo (motor):** `ACTION`
  - **Efeito exato:** Compra 2 cartas do deck infinito.
  - **Abre modal:** Não. **Exige alvo no tabuleiro:** Não.
  - **Anulável por armadilha:** Sim, por ANTIMAGIA (cobertura universal).
  - **Casos de borda:**
    - Mão do oponente vazia — não se aplica.
    - **Mão cheia:** decisão já fechada em `CLAUDE.md` (3) — compra até a mão encher e o excedente
      é descartado, com a UI avisando o jogador. Se a mão já estiver em 5/5 antes de jogar, a carta
      fica indisponível (não há o que comprar).
    - Tabuleiro — não se aplica.
  - **Nota de migração:** RENOMEADA. Mesma mecânica de hoje (`DRAW_CARD`/"PROCRASTINAR") — muda
    nome exibido E id técnico (`DRAW_CARD` → `STUDY`), porque o nome "PROCRASTINAR" passa a
    descrever uma carta NOVA e completamente diferente (draft, ver abaixo) — mantê-lo aqui
    confundiria as fases seguintes, que se referem às cartas pelo nome.

  ### PROCRASTINAR (`CARD_DRAFT`, novo)
  - **Custo:** 1⚡ (patch pós-Fase 7a — antes 2⚡) · **Categoria (PDF):** Compra · **Tipo (motor):** `ACTION`
  - **Efeito exato:** Abre modal com 3 cartas sorteadas do deck. O jogador escolhe 1 posição às
    CEGAS para a mão; as outras 2 são descartadas sem entrar em jogo.
  - **Abre modal:** Sim (escolha entre 3 posições OCULTAS — patch pós-Fase 7a). **Exige alvo no
    tabuleiro:** Não.
  - **Anulável por armadilha:** Sim, por ANTIMAGIA (cobertura universal).
  - **Casos de borda:**
    - Mão do oponente vazia — não se aplica.
    - Mão cheia: como a carta jogada já sai da mão antes do efeito resolver e o draft entrega
      exatamente 1 carta em troca, o tamanho da mão nunca ultrapassa o que já era antes de jogar —
      nunca estoura `HAND_LIMIT`, não precisa de aviso de excedente.
    - Tabuleiro — não se aplica.
  - **Nota de migração:** carta NOVA — não existe hoje. `DRAW_CARD` (que tinha esse nome antes)
    virou ESTUDAR.
  - **Patch pós-Fase 7a — opções ficam OCULTAS:** a versão original mostrava as 3 cartas reveladas
    antes da escolha (contradizendo o próprio nome — "procrastinar" sugere apostar no que vier, não
    escolher a melhor das 3 vistas). Agora o modal mostra só o verso/posição de cada slot
    (`revealed={false}` em `<InteractionModal />`) — o `CardId` de cada opção continua trafegando
    no `pendingInteraction` (a UI/rede já conhecem a identidade, só a APRESENTAÇÃO esconde), então
    isto é mudança de apresentação, não de contrato do motor.

  ### ESPIADA (`PEEK_RANDOM`)
  - **Custo:** 1⚡ · **Categoria (PDF):** Informação · **Tipo (motor):** `ACTION`
  - **Efeito exato:** Abre modal mostrando o verso de todas as cartas do oponente. O jogador
    escolhe 1 posição oculta para revelar a face. A carta continua na mão do oponente — a
    revelação persiste enquanto ela lá estiver, SEM prazo (contraste deliberado com VISÃO
    ABSOLUTA — ver "Regras transversais").
  - **Abre modal:** Sim (escolha de posição). **Exige alvo no tabuleiro:** Não.
  - **Anulável por armadilha:** Sim, por PROTEÇÃO (categoria "lê ou retira cartas da mão" — ver a
    entrada de PROTEÇÃO) e por ANTIMAGIA (cobertura universal).
  - **Casos de borda:**
    - **Mão do oponente vazia:** carta fica indisponível para jogar (nada para espiar).
    - Mão cheia / tabuleiro — não se aplicam.
  - **Nota de migração:** EFEITO ALTERADO. Hoje (`PEEK_RANDOM`) a revelação é por RNG, sem modal
    nem escolha do jogador — passa a ser escolha manual. O modelo de persistência
    (`revealedUids`, sem expiração) já está implementado (ver `<HandTracker />`,
    `src/engine/rules.ts:revealedKeyFor`) e não muda.

  ### PROTEÇÃO (`SHIELD_TRAP`)
  - **Custo:** 1⚡ · **Categoria (PDF):** Armadilha · **Tipo (motor):** `TRAP`
  - **Efeito exato:** Virada na mesa. Engatilha automaticamente contra a PRÓXIMA carta do
    oponente que LEIA OU RETIRE cartas da sua mão — uma categoria, não uma lista fixa de 2 ids.
    Cobre hoje: SAQUE, SAQUE II, SABOTAGEM, ESPIADA, ESPIONAGEM, TROCAR. PERMUTA CAÓTICA também
    leria a mão inteira, mas é Lendária — ignora armadilha por conta própria, PROTEÇÃO nem chega a
    ser consultada. Definir por categoria (não por lista) é deliberado: a Parte B ainda vai
    adicionar cartas, e uma lista enumerada apodrece — a armadilha pararia de cobrir cartas novas
    sem nenhum sinal de que isso aconteceu.
  - **Abre modal:** Não. **Exige alvo no tabuleiro:** Não (arma sem mira).
  - **Anulável por armadilha:** Sim, por ANTIMAGIA (cobertura universal — armar PROTEÇÃO é, ela
    mesma, "a próxima carta do oponente" do ponto de vista de quem tem ANTIMAGIA armada).
  - **Casos de borda:** não se aplicam edge cases de mão/tabuleiro — é reativa, só age quando
    disparada.
  - **Nota de migração:** MANTIDA (gatilho ampliado). Hoje cobre só SAQUE e ESPIONAGEM (lista fixa
    de 2 ids no `triggerCondition`); passa a ser definida por categoria, cobrindo as 6 cartas
    listadas acima automaticamente.

  ### SAQUE (`HAND_RAID`)
  - **Custo:** 2⚡ · **Categoria (PDF):** Manipulação · **Tipo (motor):** `ACTION`
  - **Efeito exato:** Rola 50/50 no canal `CARDS` do RNG. **Falha (50%):** destrói 1 carta
    aleatória da mão do oponente. **Sucesso (50%):** abre modal para o jogador escolher qual carta
    oculta da mão do oponente roubar para a própria mão.
  - **Abre modal:** Sim, só no ramo de sucesso (escolha de qual carta roubar). **Exige alvo no
    tabuleiro:** Não.
  - **Anulável por armadilha:** Sim, por PROTEÇÃO (categoria "lê/retira da mão"), por RICOCHETE
    (roubo é um dos efeitos de inversão bem definida — atinge o próprio autor, ver "Regras
    transversais") e por ANTIMAGIA (cobertura universal).
  - **Casos de borda:**
    - **Mão do oponente vazia:** carta fica indisponível para jogar.
    - Mão cheia (do CASTER, no ramo de roubo): impossível estourar — a carta jogada já libera 1
      slot antes do roubo entrar.
    - Tabuleiro — não se aplica.
  - **Nota de migração:** EFEITO ALTERADO em dois pontos: (1) falha passa a destruir 1 carta
    (hoje não faz nada), (2) sucesso passa a abrir modal de escolha em vez de sortear.

  ### TROCAR (`SINGLE_CARD_TRADE`, novo)
  - **Custo:** 2⚡ · **Categoria (PDF):** Manipulação · **Tipo (motor):** `ACTION`
  - **Efeito exato:** Abre modal mostrando o verso da mão do oponente. O jogador seleciona 1 carta
    da própria mão e escolhe 1 carta oculta do oponente — as duas trocam de mão diretamente
    (sem RNG).
  - **Abre modal:** Sim (seleção dos dois lados da troca). **Exige alvo no tabuleiro:** Não.
  - **Anulável por armadilha:** Sim, por PROTEÇÃO (categoria "lê/retira da mão" — a troca lê a mão
    do oponente antes de completar) e por ANTIMAGIA (cobertura universal). **Não** por RICOCHETE
    (ver nota abaixo).
  - **Casos de borda:**
    - **Mão do oponente vazia:** carta fica indisponível (nada para trocar).
    - Precisa de mais alguma carta na própria mão além da própria TROCAR — senão não há o que
      oferecer; fica indisponível também nesse caso.
    - Mão cheia / tabuleiro — não se aplicam (troca é 1 por 1, tamanho da mão não muda).
  - **Nota de migração:** carta NOVA — o `CARD_TRADE` atual (troca 1 carta ALEATÓRIA de cada lado,
    sem modal) vira PERMUTA CAÓTICA, não esta. Ver a nota de "ressurreição de uid" na entrada de
    PERMUTA CAÓTICA.
  - **RICOCHETE, fora do escopo (patch pós-Fase 7a):** este documento já descreveu, em versões
    anteriores, uma inversão e depois um fallback "só anula" pra esta interação com RICOCHETE — a
    arquitetura nunca sustentou a inversão de verdade (`resolveCounterTraps` dispara ANTES da
    interação abrir, antes até do passo 1 acontecer, então não existe "a carta escolhida" nesse
    instante para inverter), e o fallback "só anula, sem devolver nada" deixou de ser o
    comportamento desejado de RICOCHETE em geral. Decisão do usuário: em vez de inventar uma troca
    cega sem escolha nenhuma ou abrir uma interação nova dentro do veto síncrono de armadilha
    (arquitetura que não existe hoje), TROCAR simplesmente **saiu do escopo de RICOCHETE** — a
    carta resolve normal contra ela. Ver `docs/NOTAS_TECNICAS.md`.

  ### DEMOLIR (`BREAK_PIECE`)
  - **Custo:** 2⚡ · **Categoria (PDF):** Feitiço · **Tipo (motor):** `ACTION`
  - **Efeito exato:** Escolhe qualquer peça no tabuleiro (própria ou do oponente) e a destrói. Não
    afeta a fila do "infinito" — só apaga a peça, a célula volta a ficar vazia. É a ferramenta de
    destruição IMEDIATA do baralho — ver AMALDIÇOAR (rara) para a variante lenta/forçada.
  - **Abre modal:** Não. **Exige alvo no tabuleiro:** Sim — 1 célula ocupada, de qualquer dono.
  - **Anulável por armadilha:** Sim, por ANTIMAGIA (cobertura universal).
  - **Casos de borda:**
    - Mão do oponente vazia / mão cheia — não se aplicam.
    - Tabuleiro sem alvo válido (nenhuma célula ocupada) — indisponível para jogar.
  - **Rebalanceamento (análise de mesa):** COMUM/1⚡ → RARA/2⚡. Diferente de LIMPAR/TRAVAR (que
    impedem jogada mas têm contraresposta — o oponente pode limpar, travar de volta, ou o caos
    travar a célula por acidente), DEMOLIR converte uma peça bloqueada diretamente em vitória sem
    resposta possível depois de resolvida — categoria diferente, cara demais pra comum de 1⚡.

  ### ANOMALIA (`QUEUE_SHUFFLE`, novo)
  - **Custo:** 2⚡ · **Categoria (PDF):** Tabuleiro · **Tipo (motor):** `ACTION`
  - **Efeito exato:** Altera a fila de peças do oponente — a próxima peça dele a sumir (ao colocar
    a 4ª) passa a ser escolhida aleatoriamente pelo sistema, em vez da mais velha por ordem de
    colocação. Forma uma família coerente com AMALDIÇOAR (rara): ANOMALIA aleatoriza a fila
    inteira sem escolher nada; AMALDIÇOAR força uma peça ESPECÍFICA escolhida pelo jogador. Uma
    é caos, a outra é precisão — mantenha essa distinção na implementação (mesmo helper de "força
    a próxima da fila", parametrizado por índice aleatório vs. índice escolhido).
  - **Abre modal:** Não. **Exige alvo no tabuleiro:** Não (afeta a fila inteira do oponente, não
    uma célula).
  - **Anulável por armadilha:** Sim, por ANTIMAGIA (cobertura universal). **Não** por RICOCHETE
    (patch pós-Fase 7a: escopo estreitado pra HP/energia/mão-baralho — ANOMALIA mexe na fila de
    sumiço de PEÇAS, fora disso; ver "Regras transversais").
  - **Casos de borda:**
    - Tabuleiro sem alvo válido (oponente com menos de 1 peça): sem peça nenhuma na fila,
      presumo que a carta ainda pode ser jogada (o efeito só passa a valer quando ele tiver peças
      o bastante para a regra do infinito entrar em ação) — **não confirmado, assumido por
      consistência com o motor não travar efeitos "adiados".**
    - Mão do oponente vazia / mão cheia — não se aplicam.
  - **Nota de migração:** carta NOVA — sem equivalente hoje.

  ### AMALDIÇOAR (`OBSOLESCENCE` — hoje `REVEAL_OLDEST`; renomeada de OBSOLESCÊNCIA no patch pós-Fase 7a)
  - **Custo:** 2⚡ · **Categoria (PDF):** Tabuleiro · **Tipo (motor):** `ACTION`
  - **Efeito exato:** O jogador seleciona 1 peça do oponente. O sistema marca essa peça como "a
    mais velha" da fila — ela só sumirá quando o dono colocar a peça que estoura o limite de 3,
    pela regra normal do infinito, sobrepondo a regra padrão de "mais velha por ordem
    cronológica". NÃO é destruição imediata: é mais lenta e mais fraca que uma destruição direta,
    DE PROPÓSITO — destruição imediata de 1 peça já existe e custa 2⚡ (DEMOLIR). Forma família com
    ANOMALIA (rara) — ver a nota lá.
  - **Feedback visual (patch pós-Fase 7a):** o dono da peça marcada (o defensor) vê um flicker
    ambíguo circulando entre as PRÓPRIAS peças no tabuleiro — nunca aponta a peça real. É ruído
    cosmético puramente local (`Math.random()`, não o RNG determinístico — mesma técnica do giro
    de TIC TAC BOOM!), então não sincroniza entre os dois clientes online e não vaza informação
    nenhuma. VIDENTE (comum, acima) é a única forma de um jogador ver através dessa ambiguidade —
    mas só quem MIRA o oponente com VIDENTE, nunca o próprio defensor sobre si mesmo (VIDENTE só
    lê peças do oponente de quem a joga).
  - **Abre modal:** Não. **Exige alvo no tabuleiro:** Sim — 1 célula ocupada pelo oponente.
  - **Anulável por armadilha:** Sim, por ANTIMAGIA (cobertura universal). **Não** por RICOCHETE
    (patch pós-Fase 7a: mesma razão de ANOMALIA — mexe na fila de sumiço de PEÇAS, fora do escopo
    novo; ver "Regras transversais").
  - **Casos de borda:**
    - **Tabuleiro sem alvo válido** (oponente com menos de 3 peças no tabuleiro): indisponível
      para jogar (patch pós-Fase 7a — antes bastava >=1 peça; marcar antes da fila do infinito
      valer para o dono não fazia sentido).
    - Mão do oponente vazia / mão cheia — não se aplicam.
  - **Nota de migração:** RENOMEADA + EFEITO ALTERADO. Sucessora direta do `REVEAL_OLDEST` atual
    ("VIDENTE" hoje, que marca-e-destrói de verdade via `doomedCell` no início do turno seguinte)
    — muda nome exibido E id técnico (`REVEAL_OLDEST` → `OBSOLESCENCE`), E o mecanismo de
    destruição precisa migrar de "matar direto" para "forçar a posição na fila do infinito" — são
    coisas DIFERENTES no motor atual, isto não é só trocar rótulo. Mudança de raridade/custo
    também: RARA/2⚡ → ÉPICA/3⚡ nessa migração original. O nome "VIDENTE" passa a ser outra carta,
    pura informação (Comuns).
  - **Rebalanceamento (análise de mesa):** ÉPICA/3⚡ → RARA/2⚡. Depois do redesenho acima (parou
    de matar direto, virou "força posição na fila"), ficou fraca para o preço de épica que ainda
    ocupava — nivelada de volta para rara, junto com VIDENTE/DEMOLIR/ANTIMAGIA/RICOCHETE/
    ESPIONAGEM na mesma rodada.
  - **Renomeada no patch pós-Fase 7a:** o nome "OBSOLESCÊNCIA" causava confusão — o jogador
    esperava saber QUAL peça sua estava marcada, quando a intenção sempre foi a incerteza (ver
    "Feedback visual", acima). "AMALDIÇOAR" comunica melhor que uma peça foi afetada sem revelar
    qual. O `id` técnico (`OBSOLESCENCE`) não mudou — só o nome exibido e a descrição.

  ### ANTIMAGIA (`ANTI_SPELL_TRAP`, novo)
  - **Custo:** 2⚡ · **Categoria (PDF):** Armadilha · **Tipo (motor):** `TRAP`
  - **Efeito exato:** Virada na mesa. Anula a PRÓXIMA carta jogada pelo oponente que NÃO seja
    Lendária nem Boom — cobertura UNIVERSAL por exclusão de raridade, não por categoria de carta
    (a leitura "só Feitiço" foi descartada: deixaria a armadilha cobrindo 4 cartas de 1-2⚡, uma
    troca ruim demais pra ninguém jogar). O oponente perde a energia gasta mesmo com o efeito
    anulado. Cobre tanto cartas `ACTION` quanto o ARMAR de outra `TRAP` não-lendária (ex: pode
    anular o armar de PROTEÇÃO ou RICOCHETE do oponente). Não anula o armar nem o detonar de MINA
    (`CLAUDE.md`, 4) — lendárias/Boom são sempre imunes, mesmo quando a própria carta imune é uma
    armadilha (ver "Regras transversais").
  - **Abre modal:** Não. **Exige alvo no tabuleiro:** Não.
  - **Anulável por armadilha:** Sim, por outra ANTIMAGIA do oponente, no momento de ARMAR (é ela
    própria Rara, não-lendária/Boom) — ver "Regras transversais" sobre o helper de imunidade.
  - **Casos de borda:** reativa, sem edge case de mão/tabuleiro próprio.
  - **Nota de migração:** carta NOVA.
  - **Rebalanceamento (análise de mesa):** RARA/1⚡ → RARA/2⚡. Responder a quase qualquer efeito
    do oponente por 1⚡ destoava do resto do tier — mesmo ajuste aplicado a RICOCHETE, sua
    contraparte reativa.

  ### RICOCHETE (`REFLECT_TRAP`, novo)
  - **Custo:** 2⚡ · **Categoria (PDF):** Armadilha · **Tipo (motor):** `TRAP`
  - **Efeito exato:** Virada na mesa. Dispara contra efeitos do oponente direcionados a você ou
    aos seus recursos DIRETOS — HP, energia ou mão/baralho (categoria, não uma lista fixa de
    ids). Hoje cobre ATAQUE, SAQUE, SAQUE II e APAGÃO — sempre INVERTE (nunca só cancela; ver
    "Regras transversais"). Efeitos que mexem em PEÇAS do tabuleiro (AMALDIÇOAR, ANOMALIA) ou
    que são interativos demais pra inverter no instante do veto (TROCAR) ficam de fora do escopo
    de propósito — escopo estreitado no patch pós-Fase 7a, decisão do usuário.
  - **Abre modal:** Não. **Exige alvo no tabuleiro:** Não.
  - **Anulável por armadilha:** Sim, por ANTIMAGIA (cobertura universal, no momento de armar).
  - **Casos de borda:** reativa, sem edge case de mão/tabuleiro próprio.
  - **Nota de migração:** carta NOVA.
  - **Rebalanceamento (análise de mesa):** RARA/1⚡ → RARA/2⚡. Mesma razão de ANTIMAGIA — resposta
    a quase qualquer efeito por 1⚡ destoava do resto do tier.
  - **Escopo estreitado (patch pós-Fase 7a):** antes cobria "mão, HP, peças, fila" — na prática
    cancelava (sem inverter) AMALDIÇOAR/ANOMALIA/TROCAR, o que destoava do espírito da carta
    ("o efeito volta pro autor", não "só desperdiça a carta do oponente"). As 3 saíram do escopo;
    as 4 que sobraram já tinham inversão definida — não sobra mais nenhum caso de "só cancela".

  ### ESPIONAGEM (`INTEL_REVEAL`, novo)
  - **Custo:** 2⚡ · **Categoria (PDF):** Informação · **Tipo (motor):** `ACTION`
  - **Efeito exato:** Abre modal mostrando o verso de todas as cartas do oponente. O jogador
    escolhe 2 para revelar e obter a informação — as cartas permanecem com o oponente, nada é
    descartado.
  - **Abre modal:** Sim (escolha de até 2 posições). **Exige alvo no tabuleiro:** Não.
  - **Anulável por armadilha:** Sim, por PROTEÇÃO (categoria "lê/retira da mão" — lê, mesmo sem
    retirar) e por ANTIMAGIA (cobertura universal).
  - **Casos de borda:**
    - **Mão do oponente vazia:** indisponível para jogar.
    - **Mão do oponente com só 1 carta:** o PDF exige explicitamente que o modal não trave
      esperando uma 2ª seleção inexistente — a seleção fica limitada ao tamanho real da mão
      (`array.length`), permite escolher só 1 e resolve normalmente.
    - Mão cheia (do caster) / tabuleiro — não se aplicam.
  - **Nota de migração:** carta NOVA — o `SPY_CARD` atual ("ESPIONAGEM" hoje) já não faz isto (ele
    revela E descarta) e virou SABOTAGEM.
  - **Rebalanceamento (análise de mesa):** ÉPICA/2⚡ → RARA/2⚡ (custo mantido, só o tier muda).
    Revelar 2 cartas sem descartar nada destoava do resto das épicas (dano, cura, punições
    severas) — nivelada para o tier de informação/manipulação onde ESPIADA e SAQUE já estão.

  ### CÁPSULA DO TEMPO (`TIME_CAPSULE`, novo — patch de defesa)
  > **Raridade/custo pós-Fase 7a: LENDÁRIA/3⚡** (era RARA/1⚡ — esta entrada segue listada em
  > Raras por localização histórica do documento; ver "Lendárias", abaixo, para o resto das
  > cartas dessa faixa). Driblar uma morte garantida e ainda sair com 2 cartas de bônus é forte
  > demais pra entrar na mesa por 1⚡.
  - **Custo:** 3⚡ (patch de ritmo — antes 1⚡) · **Categoria (PDF):** Armadilha · **Tipo (motor):** `TRAP`
  - **Efeito exato:** Virada na mesa. Gatilho passivo: se o HP do dono chegar a 0, a armadilha
    intercepta ANTES de encerrar a partida — ele sobrevive com 1 HP, compra 2 cartas imediatamente,
    e a armadilha é consumida no processo.
  - **Abre modal:** Não. **Exige alvo no tabuleiro:** Não.
  - **Anulável por armadilha:** Sim, por ANTIMAGIA, no momento de ARMAR.
  - **Casos de borda:**
    - Não protege contra perder a RODADA por linha fechada — o resultado da rodada continua valendo
      normalmente, a Cápsula só impede o HP de chegar a 0 (mesmo que o dano daquela rodada seja
      exatamente o que zeraria).
  - **Nota de migração:** carta NOVA. **Mecanismo (única exceção arquitetural do baralho):** não
    tem `triggerCondition` nem participa do barramento de eventos (`dispatchEvent`) que as outras
    armadilhas usam — não existe um `GameEvent` de "dano prestes a ser letal" (`DAMAGE_TAKEN` nunca
    é disparado, de propósito, para uma armadilha não reagir ao próprio estrago). A regra vive
    direto em `takeDamage` (`gameStore.ts`), a ÚNICA interceptação de dano letal do jogo — mora
    onde é garantida (`AGENTS.md`, "Invariantes de domínio"), não forçada num evento que nunca
    existiu de verdade.

  ### FIO DE ARAME (`TRIPWIRE`, novo — patch de defesa)
  - **Custo:** 1⚡ · **Categoria (PDF):** Armadilha · **Tipo (motor):** `TRAP`
  - **Efeito exato:** Virada na mesa. Dispara contra a PRÓXIMA peça que o oponente colocar,
    qualquer célula (mesmo evento que MINA consome, `PIECE_PLACED`, sem restringir à casa central).
    A peça é colocada normalmente, mas quem a colocou perde 2⚡ — ou toda a energia restante, se
    tiver menos que isso.
  - **Abre modal:** Não. **Exige alvo no tabuleiro:** Não.
  - **Anulável por armadilha:** Sim, por ANTIMAGIA, no momento de ARMAR.
  - **Casos de borda:** reativa, sem edge case de mão/tabuleiro próprio — o clamp da energia
    drenada (nunca abaixo de 0) já cobre o caso do oponente ter menos de 2⚡.
  - **Nota de migração:** carta NOVA.

  ---

  ## Épicas — 15%

  Impacto direto: dano, cura, punições severas, informação pesada.

  ### PURIFICAR (`CLEANSE`)
  - **Custo:** 2⚡ · **Categoria (PDF):** Feitiço · **Tipo (motor):** `ACTION`
  - **Efeito exato:** Limpa absolutamente todos os efeitos persistentes (bloqueio do caos, lacre
    da TRAVAR) de TODAS as células do tabuleiro de uma vez. (`CLAUDE.md`, 1 — decisão já fechada:
    esta é a versão "tabuleiro inteiro", não a de 1 célula — ver LIMPAR, comum, pra essa.)
  - **Abre modal:** Não. **Exige alvo no tabuleiro:** Não (afeta o tabuleiro inteiro, não uma
    célula).
  - **Anulável por armadilha:** Sim, por ANTIMAGIA (cobertura universal).
  - **Casos de borda:**
    - **Tabuleiro sem nenhum efeito persistente ativo:** indisponível para jogar (nada para
      limpar) — **confirmado na Fase 2**, por consistência com o resto do baralho: DEMOLIR fica
      indisponível sem peça no tabuleiro, LIMPAR fica indisponível sem efeito persistente na célula
      alvo. Nenhuma carta de tabuleiro é jogável sem um alvo/efeito para agir em cima; PURIFICAR
      não seria exceção.
    - Mão do oponente vazia / mão cheia — não se aplicam.
  - **Nota de migração:** EFEITO ALTERADO (1 célula → tabuleiro inteiro) e mudança de
    raridade/custo (COMUM/1⚡ → ÉPICA/2⚡).

  ### ESTUDAR II (`STUDY_II` — hoje `DRAW_CARD_BIG`)
  > **Raridade/custo pós-Fase 7a: LENDÁRIA/3⚡** (esta entrada segue listada em Épicas por
  > localização histórica do documento — ver "Lendárias", abaixo, para o resto das cartas dessa
  > faixa).
  - **Custo:** 3⚡ (patch pós-Fase 7a — antes 2⚡) · **Categoria (PDF):** Compra · **Tipo (motor):** `ACTION`
  - **Efeito exato:** Compra 3 cartas do topo do deck infinito.
  - **Abre modal:** Não. **Exige alvo no tabuleiro:** Não.
  - **Anulável por armadilha:** Sim, por ANTIMAGIA (cobertura universal).
  - **Casos de borda:**
    - **Mão cheia:** mesma regra de ESTUDAR — compra até encher, excedente descartado, UI avisa
      (`CLAUDE.md`, 3).
    - Mão do oponente vazia / tabuleiro — não se aplicam.
  - **Nota de migração:** RENOMEADA. Mesma mecânica de hoje (`DRAW_CARD_BIG`/"PROCRASTINAR II") —
    muda nome exibido E id técnico (`DRAW_CARD_BIG` → `STUDY_II`), mesmo motivo de ESTUDAR: o nome
    "PROCRASTINAR II" agora é outra carta.

  ### SAQUE II (`HAND_RAID_II`, novo)
  - **Custo:** 3⚡ · **Categoria (PDF):** Manipulação · **Tipo (motor):** `ACTION`
  - **Efeito exato:** Mesmo formato de SAQUE, com probabilidades diferentes. Rola 25/75. **Falha
    (25%):** destrói 1 carta aleatória do oponente. **Sucesso (75%):** abre modal para escolher
    qual carta roubar.
  - **Abre modal:** Sim, só no ramo de sucesso. **Exige alvo no tabuleiro:** Não.
  - **Anulável por armadilha:** Sim, por PROTEÇÃO, por RICOCHETE (roubo — inversão bem definida)
    e por ANTIMAGIA (cobertura universal) — mesma cobertura de SAQUE.
  - **Casos de borda:** idênticos aos de SAQUE.
  - **Nota de migração:** carta NOVA — sem equivalente hoje (o motor só tem a variante 50/50).

  ### PROCRASTINAR II (`CARD_DRAFT_TIERED`, novo)
  - **Custo:** 2⚡ (patch pós-Fase 7a — antes 3⚡) · **Categoria (PDF):** Compra · **Tipo (motor):** `ACTION`
  - **Efeito exato:** Abre modal com 5 cartas ocultas selecionadas pelo jogo — 2 comuns, 2 épicas
    e 1 lendária, com 100% de garantia dessa distribuição (não passa pelo sorteio normal de
    raridade). O jogador escolhe 1 para a mão; as outras 4 são descartadas.
  - **Abre modal:** Sim (escolha entre 5, com raridade pré-determinada). **Exige alvo no
    tabuleiro:** Não.
  - **Anulável por armadilha:** Sim, por ANTIMAGIA (cobertura universal).
  - **Casos de borda:**
    - Mão cheia: mesmo raciocínio de PROCRASTINAR — troca 1 por 1, nunca estoura.
    - Mão do oponente vazia / tabuleiro — não se aplicam.
  - **Nota de migração:** carta NOVA. A distribuição fixa de raridade (2/2/1) é um sorteio
    PARALELO ao `drawCardId`/`RARITY_POOL` normal — precisa de uma função própria na Fase 1, não
    reaproveita o sorteio ponderado padrão.

  ### SABOTAGEM (`SABOTAGE` — hoje `SPY_CARD`)
  - **Custo:** 3⚡ · **Categoria (PDF):** Manipulação · **Tipo (motor):** `ACTION`
  - **Efeito exato:** Abre modal mostrando o verso da mão do oponente. O jogador escolhe 1 carta
    oculta; ela é revelada (só para quem jogou) e imediatamente descartada da mão do oponente.
  - **Abre modal:** Sim (escolha de qual descartar). **Exige alvo no tabuleiro:** Não.
  - **Anulável por armadilha:** Sim, por PROTEÇÃO (categoria "lê/retira da mão") e por ANTIMAGIA
    (cobertura universal).
  - **Casos de borda:**
    - **Mão do oponente vazia:** indisponível para jogar.
    - Mão cheia (do caster) / tabuleiro — não se aplicam (esta carta não adiciona nada à mão de
      quem joga).
  - **Nota de migração:** RENOMEADA + EFEITO ALTERADO. Sucessora direta do `SPY_CARD` atual
    ("ESPIONAGEM" hoje, que revela+descarta 1 carta ALEATÓRIA, sem modal) — muda nome exibido E id
    técnico (`SPY_CARD` → `SABOTAGE`), aleatório vira escolha manual, custo sobe de 2⚡ para 3⚡. O
    nome "ESPIONAGEM" passa a ser outra carta, pura informação (ver Raras/Épicas).

  ### REBOBINAR (`REBOBINAR`)
  - **Custo:** 3⚡ · **Categoria (PDF):** Punição · **Tipo (motor):** `ACTION`
  - **Efeito exato:** O oponente TEM o turno normalmente — recupera energia, joga cartas, arma
    armadilhas — mas não pode colocar peça (X/O) no tabuleiro nessa vez. Mecanismo próprio no motor,
    distinto de `extraTurnPending` (que pula a alternância de turno inteira): dois campos
    independentes, `playerPlacementBlocked`/`machinePlacementBlocked` (booleans, um por combatente —
    **não** um `Combatant | null` único como a primeira leitura desta entrada sugeria; ver
    `docs/NOTAS_TECNICAS.md`, 5º critério da auditoria de campos transitórios), consultados só pela
    guarda que permite colocar peça (`canPlaceAt`) — todo o resto do turno do oponente (mão, energia,
    armadilhas) segue normal. Sem `canPlay`: sempre jogável, inclusive contra um alvo já bloqueado
    (dois turnos seguidos é jogada tática legítima) e mesmo com o PRÓPRIO caster bloqueado (jogar
    aqui não desbloqueia quem joga).
  - **Abre modal:** Não. **Exige alvo no tabuleiro:** Não.
  - **Anulável por armadilha:** Sim, por ANTIMAGIA (cobertura universal).
  - **Casos de borda:** não se aplicam edge cases de mão/tabuleiro.
  - **Nota de migração:** carta NOVA. Ver TURNO_EXTRA logo abaixo — as duas foram confirmadas como
    mecanismos DIFERENTES, não uma duplicata renomeada.
  - **Implementada na Fase 2.5.** O pré-requisito identificado na Fase 2 (`endTurn` sem consumidor)
    foi resolvido ali mesmo: `endTurn` agora exige `combatant` e valida turno/status/pausa/confirmação
    (mesma guarda de `placeMark`), tem consumidor humano (botão "passar a vez" no `GameHeader`, com
    confirmação — a ação é irreversível), consumidor de CPU (`playCPUTurn` chama `endTurn` quando
    `chooseCpuMove` não decide nada, inclusive por estar bloqueada) e consumidor de rede (`netEndTurn`,
    ação `END_TURN`).

  ### TURNO EXTRA (`TURNO_EXTRA` — hoje `EXTRA_TURN`)
  - **Custo:** 3⚡ · **Categoria (PDF):** sem categoria própria no PDF (carta preservada por
    `CLAUDE.md`, não vem do design doc) · **Tipo (motor):** `ACTION`
  - **Efeito exato:** Você coloca DUAS peças seguidas no seu próprio turno — o oponente não joga
    no meio. Diferente de REBOBINAR: aqui é VOCÊ (quem jogou a carta) que ganha a ação extra, não
    o oponente que perde a dele. Com a fila de 3 peças, colocar a segunda pode fechar uma linha e,
    ao mesmo tempo, apagar sua própria peça mais antiga — uma decisão de verdade, não só ganho de
    tempo.
  - **Abre modal:** Não. **Exige alvo no tabuleiro:** Não.
  - **Anulável por armadilha:** Sim, por ANTIMAGIA (cobertura universal).
  - **Casos de borda:** não se aplicam edge cases de mão/tabuleiro. Não empilha — jogar duas
    seguidas desperdiçaria a segunda (mesma guarda de `canPlay` do `EXTRA_TURN` atual).
  - **Nota de migração:** RENOMEADA, sem mudança de mecânica. `CLAUDE.md` (2) — "a carta antiga é
    renomeada para TURNO_EXTRA e representa a versão anterior de REBOBINAR". Confirmado nesta
    rodada: **MANTER esta carta**, não cortar (P5) — o mecanismo (`extraTurnPending`/`beginTurn`, o
    mesmo owner joga de novo) já É exatamente isto, hoje; o custo de mantê-la é só renomear id e
    nome exibido. REBOBINAR (acima) é quem exige engine novo, e esse custo existe INDEPENDENTE de
    TURNO_EXTRA continuar existindo ou não — cortar TURNO_EXTRA não reduz o trabalho de construir
    REBOBINAR.
    **P11 resolvido — SEM refil entre as duas colocações.** A energia continua de onde parou na
    primeira jogada; a carta concede só o direito extra de colocar peça, nenhum bônus de energia.
    Motivo: com refil, a carta custaria 3⚡ e devolveria 3⚡ — se pagaria sozinha e ainda daria uma
    peça de brinde, contradizendo o modelo econômico do item "Energia" acima (a pressão de "gastar
    tudo tem custo real depois" é o ponto central da regra de +1/turno com teto 3). **Implicação de
    implementação:** hoje o refil vem de `beginTurn` chamando `refillEnergy` — se a segunda
    colocação de TURNO_EXTRA reusar `beginTurn` tal como está, ganha o refil de graça e reintroduz
    o problema. A Fase 1 precisa de um caminho que conceda a segunda colocação SEM passar pelo
    refil (ver nota na seção "Energia", abaixo — é a mesma tarefa de reescrever `refillEnergy` para
    a regra nova, não uma tarefa separada).

  ### ATAQUE (`DIRECT_DAMAGE`)
  - **Custo:** 3⚡ · **Categoria (PDF):** Combate · **Tipo (motor):** `ACTION`
  - **Efeito exato:** Causa 1 ponto de dano direto ao oponente.
  - **Abre modal:** Não. **Exige alvo no tabuleiro:** Não.
  - **Anulável por armadilha:** Sim, por RICOCHETE (dano — inversão bem definida, atinge o próprio
    autor) e por ANTIMAGIA (cobertura universal).
  - **Casos de borda:** não se aplicam edge cases de mão/tabuleiro.
  - **Nota de migração:** sem mudança. MANTIDA.

  ### CURA (`HEAL_SELF`)
  - **Custo:** 3⚡ · **Categoria (PDF):** Combate · **Tipo (motor):** `ACTION`
  - **Efeito exato:** Restaura 1 ponto de HP do jogador ativo, até o limite de 5 HP.
  - **Abre modal:** Não. **Exige alvo no tabuleiro:** Não.
  - **Anulável por armadilha:** Sim, por ANTIMAGIA (cobertura universal) — não por RICOCHETE (não é
    efeito direcionado ao oponente).
  - **Casos de borda:**
    - HP já no máximo (5): indisponível para jogar.
    - Mão do oponente vazia / mão cheia / tabuleiro — não se aplicam.
  - **Nota de migração:** sem mudança. MANTIDA.

  ### APAGÃO (`BLACKOUT`, novo — patch de defesa)
  - **Custo:** 2⚡ · **Categoria (PDF):** Combate / Defesa · **Tipo (motor):** `ACTION`
  - **Efeito exato:** Drena toda a energia restante do oponente no exato momento em que a carta é
    jogada — denial puro. É a resposta a um oponente guardando 3⚡ para VISÃO ABSOLUTA/CURA no
    próximo turno.
  - **Abre modal:** Não. **Exige alvo no tabuleiro:** Não.
  - **Anulável por armadilha:** Sim, por RICOCHETE (drenar energia do oponente é um efeito
    direcionado — a inversão zera a energia de quem LANÇOU em vez do alvo original) e por
    ANTIMAGIA (cobertura universal).
  - **Casos de borda:** indisponível se o oponente já estiver com 0⚡ — nada para drenar.
  - **Nota de migração:** carta NOVA.

  ---

  ## Lendárias — 6%

  Ameaças de fim de jogo. **Imunes a armadilha** — nenhuma TRAP desta spec pode impedir o armar
  nem o efeito de uma carta lendária (ver "Regras transversais").

  ### VISÃO ABSOLUTA (`FULL_INTEL`)
  - **Custo:** 3⚡ · **Categoria (PDF):** Informação · **Tipo (motor):** `ACTION`
  - **Efeito exato:** Revela a face de TODAS as cartas da mão do oponente ATÉ O FIM DO TURNO —
    prazo real, que expira sozinho independente de as cartas saírem da mão ou não. Contraste
    DELIBERADO com ESPIADA: barata-e-permanente (1⚡, 1 carta, dura até a carta sair da mão) vs.
    cara-total-e-fugaz (3⚡, mão inteira, dura só até o fim do turno). Não unificar os dois
    mecanismos de persistência — são eixos de design diferentes, não uma simplificação pendente.
  - **Abre modal:** Sim, hoje mostra um resumo (contagem); a spec pede reveal completo de cada
    carta, com expiração. **Exige alvo no tabuleiro:** Não.
  - **Anulável por armadilha:** Não (Lendária, imune por regra transversal).
  - **Casos de borda:**
    - **Mão do oponente vazia:** indisponível para jogar.
    - Mão cheia (do caster) / tabuleiro — não se aplicam.
  - **Nota de migração:** EFEITO ALTERADO. Hoje o efeito só loga a CONTAGEM da mão do oponente e
    mostra um `acknowledge` — nunca implementou reveal por carta nem expiração. Precisa de estado
    PRÓPRIO com temporizador (turno em que a revelação cai) — NÃO reaproveitar
    `playerRevealedUids`/`machineRevealedUids` (monotônico, sem limpeza, feito pra ESPIADA).
  - **Nota para a Fase 3 (contrato `pendingInteraction`):**
    1. O modal revela TODAS as cartas de uma vez, automaticamente, ao abrir — sem clique de
       seleção nenhum. É EXIBIÇÃO, não interação: não precisa de um `kind` próprio de
       `pendingInteraction`, só de um modal de leitura (mostra e espera confirmação, como o
       `AcknowledgementModal` de hoje já faz). Simplifica o contrato da Fase 3, que não
       precisa prever um formato de "seleção" para esta carta.
    2. **A persistência da revelação fica EM ABERTO, para revisitar no rebalanceamento (depois
       das 29 cartas).** Duas opções:
       - (a) expira no fim do turno, como a spec já diz acima — mantém o contraste
         "barata-e-permanente" (ESPIADA) vs. "cara-total-e-fugaz" (esta carta);
       - (b) persiste como ESPIADA (`playerRevealedUids`/`machineRevealedUids`), e o que
         passa a diferenciar as duas cartas é a AMPLITUDE (mão inteira vs. 1 carta), não
         mais a duração.
       Implementar (a) na Fase 3 — é o que está especificado hoje — mas isolar o mecanismo de
       expiração (o temporizador em si) o suficiente para trocar por (b) mais tarde sem
       reescrever a carta: o `effect` decide QUAL carta revelar, o temporizador é um
       mecanismo separado que decide QUANDO a revelação para de valer, e só esse segundo
       mecanismo muda entre (a) e (b).
    3. **Registro explícito:** o comportamento observado hoje — "revela só enquanto o modal
       está aberto, some depois" — NÃO é um temporizador com bug. É o efeito de revelação
       nunca ter sido implementado (só o resumo/contagem existe, ver "Nota de migração"
       acima); o que parece "expiração" é só o modal fechando. A Fase 3 constrói a revelação
       (e o temporizador de verdade) do zero, não conserta um mecanismo existente.

  ### PERMUTA CAÓTICA (`HAND_SWAP` — hoje `CARD_TRADE`)
  - **Custo:** 3⚡ · **Categoria (PDF):** Manipulação · **Tipo (motor):** `ACTION`
  - **Efeito exato:** Troca a mão inteira do jogador pela mão inteira do oponente, sem RNG e sem
    seleção — as duas mãos trocam de dono por completo.
  - **Abre modal:** Não. **Exige alvo no tabuleiro:** Não.
  - **Anulável por armadilha:** Não (Lendária, imune) — inclusive PROTEÇÃO/RICOCHETE, que
    cobririam "leitura de mão"/"troca" em qualquer outra raridade.
  - **Casos de borda:**
    - Mão do oponente vazia — troca ainda ocorre normalmente (o jogador fica sem cartas, o
      oponente recebe a mão inteira dele); **não confirmado se isso deveria ser bloqueado por ser
      estrategicamente unilateral** — não tratado como pendência por não ter indício de que o PDF
      quisesse restringir.
    - Mão cheia — não se aplica (é troca de conjunto inteiro, não soma).
    - Tabuleiro — não se aplica.
  - **Nota de migração:** RENOMEADA + EFEITO ALTERADO. `CARD_TRADE` atual ("TROCAR", que troca 1
    carta ALEATÓRIA de cada lado) vira esta carta — muda nome exibido E id técnico (`CARD_TRADE` →
    `HAND_SWAP`), efeito (1 carta aleatória → mão inteira sem RNG) e raridade/custo (RARA/2⚡ →
    LENDÁRIA/3⚡). "TROCAR" passa a nomear outra carta (Raras, modal, 1 carta só).

    **Ressurreição de `uid` revelado ao trocar de mão:** como a revelação por `uid`
    (`playerRevealedUids`/`machineRevealedUids`) não tem limpeza (é preguiçosa: só considera um
    uid revelado enquanto ele está na mão viva de quem o carrega), uma carta que muda de mão via
    PERMUTA CAÓTICA carrega o `uid` antigo para a mão nova. Se aquele `uid` já estava marcado
    revelado, ele chega "ressuscitado" como revelado no destino — mesmo que o novo dono NUNCA a
    tenha espiado. Na maioria dos casos isso está semanticamente certo (quem já viu a carta antes
    de ela mudar de mão continua conhecendo-a), mas não foi verificado caso a caso. Mesma nota
    vale para SAQUE/SAQUE II (rouba 1 carta) e TROCAR (troca 1 carta) — ver
    `docs/NOTAS_TECNICAS.md` para o texto completo e a ação prevista para a Fase 4.

  ### MINA (`BOMB_TRAP`)
  - **Custo:** 3⚡ · **Categoria (PDF):** Armadilha · **Tipo (motor):** `TRAP`
  - **Efeito exato:** Virada na mesa. Se o oponente colocar uma peça na casa central do tabuleiro,
    ele sofre 1 de dano (rebaixado de 2 no patch pós-Fase 7a — o resto do efeito, abaixo, já era
    punição suficiente sozinho) e o turno dele é encerrado imediatamente.
  - **Abre modal:** Não. **Exige alvo no tabuleiro:** Não (arma sem mira; o gatilho é fixo, a casa
    central).
  - **Anulável por armadilha:** Não (Lendária, imune) — inclusive contra ANTIMAGIA: `CLAUDE.md`
    (4) fixa explicitamente que a imunidade cobre TANTO o armar quanto o detonar da MINA, mesmo
    ela sendo, ela própria, uma armadilha.
  - **Casos de borda:** reativa, sem edge case de mão/tabuleiro próprio.
  - **Nota de migração:** sem mudança na mecânica. Dano rebaixado de 2 para 1 no patch pós-Fase 7a.

  ### PARADOXO (`PARADOX`, novo — patch de defesa, a carta mais complexa do baralho)
  - **Custo:** 2⚡ · **Categoria (PDF):** Armadilha · **Tipo (motor):** `TRAP`
  - **Efeito exato:** Virada na mesa. Se o oponente jogar uma carta de custo 3⚡ (hoje: ATAQUE,
    CURA, SAQUE II, ESTUDAR II, PERMUTA CAÓTICA, SABOTAGEM, TURNO EXTRA, REBOBINAR, VISÃO
    ABSOLUTA, MINA), o efeito dele acontece normalmente e o PARADOXO copia o MESMO efeito de
    graça para o próprio dono — gatilha DEPOIS do efeito original terminar de resolver, não ao
    armar.
  - **Abre modal:** Não. **Exige alvo no tabuleiro:** Não.
  - **Anulável por armadilha:** Não (Lendária, imune ao armar E ao disparar).
  - **Casos de borda:**
    - Se a carta copiada for ATAQUE (dano): o Paradoxo inverte o alvo da cópia — quem jogou também
      toma o dano, além do dono do Paradoxo já ter tomado o original.
    - Se a carta copiada for uma ARMADILHA (MINA): armar nunca executa efeito nenhum — a cópia é
      armar uma equivalente para o dono do Paradoxo, respeitando o limite de 3 armadilhas na mesa.
      Sem espaço, o Paradoxo ainda dispara (é consumido), só a cópia em si não cabe.
  - **Nota de migração:** carta NOVA.
  - **Mecanismo — sem tabela por carta:** a distinção de "como copiar" é só por `type` do motor, não
    por identidade da carta (nenhuma lista tipo `RICOCHET_INVERSIONS` para manter):
    - Original `TRAP` → arma uma cópia idêntica no array de armadilhas do dono do Paradoxo.
    - Original `ACTION` → chama o MESMO `effect()` da carta original de novo, com o `caster`
      invertido para o dono do Paradoxo. Isso já produz sozinho, sem nenhum código específico por
      carta: CURA cura o dono do Paradoxo; ATAQUE acerta quem jogou; ESTUDAR II compra 3 para ele;
      PERMUTA CAÓTICA desfaz a própria troca (é uma operação simétrica entre as duas mãos — rodar
      2× cancela); VISÃO ABSOLUTA revela a mão de quem jogou para o dono do Paradoxo.
  - **Mecanismo — cópia de carta que abriria modal (SABOTAGEM, o ramo de escolha de SAQUE II):** o
    Paradoxo NUNCA abre um modal de verdade para o próprio dono. `resolveInteraction`
    (`gameStore.ts`) exige que quem responde a uma interação seja `state.turn` — e o dono do
    Paradoxo está fora da própria vez no instante em que o gatilho dispara (é a vez de quem jogou a
    carta de 3⚡). Em vez disso, um helper genérico (`autoResolveInteraction`) sorteia uma escolha
    válida via RNG e reexecuta o `effect()` internamente — do lado de fora, o Paradoxo nunca devolve
    uma interação pendente, é uma armadilha reativa comum, de resultado único.
  - **Pré-requisito de engine (afeta MINA também):** antes deste patch, a via que aplica o
    resultado de uma armadilha REATIVA (`dispatchEvent`, diferente do veto síncrono de
    ANTIMAGIA/PROTEÇÃO) só entendia um subconjunto manual (`patch`/`log`/`notice`/`damage`) —
    incapaz de `heal`/`draw`/`energyDrain`/`acknowledge`, que uma cópia de CURA/ESTUDAR
    II/FIO DE ARAME/SABOTAGEM produz. Essa via passou a reusar o mesmo pipeline completo
    (`applyCardEffectResult`) que o veto síncrono e a jogada normal já usavam — MINA não muda de
    comportamento (o resultado dela já cabia no subconjunto antigo), só ganha a mesma robustez das
    outras duas vias de graça.

  ---

  ## Boom! — 4%

  Custo zero, caos puro. Ignoram QUALQUER armadilha (mesma imunidade das lendárias).

  ### TIC TAC BOOM! (`CHAOS_ROULETTE`)
  - **Custo:** 0⚡ · **Categoria (PDF):** Evento · **Tipo (motor):** `ACTION`
  - **Efeito exato:** O tabuleiro vira uma slot machine 3×3: as 3 colunas giram e param em
    sequência, com uma animação e o texto TIC / TAC / BOOM! aparecendo a cada parada. O sistema
    sorteia novas posições no tabuleiro para X e O, dando chance de fechar uma fileira (horizontal
    ou diagonal) e pontuar. Restrição: nunca pode resultar em mais de 3 peças X ou 3 peças O no
    tabuleiro ao mesmo tempo. **Sistema SEPARADO do surto automático do relógio global**: o surto
    periódico continua sendo o mecanismo de sempre (`BLOCKED_CELL`/`RANDOM_FADE`/etc.) — só a
    CARTA ganha a slot machine. Confirmado deliberadamente: transformar o relógio ambiente numa
    slot machine periódica destruiria o tabuleiro sozinho, tirando a agência do jogador; a slot
    machine precisa continuar sendo um evento raro (4%) e memorável, não o ritmo de fundo do jogo.
  - **Abre modal:** Não (animação em tela cheia, não um modal de confirmação). **Exige alvo no
    tabuleiro:** Não.
  - **Anulável por armadilha:** Não (Boom, imune).
  - **Casos de borda:** sem `canPlay` — sempre jogável, em qualquer estado de tabuleiro (o próprio
    sorteio respeita o limite de 3 peças por símbolo).
  - **Nota de migração:** EFEITO ALTERADO (reforma completa). Hoje (`CHAOS_ROULETTE`) só dispara um
    surto de regra caótica — a MESMA "roleta" automática do relógio global periódico
    (`triggerTerminalGlitch`), não a slot machine de posições descrita aqui. Os dois sistemas
    precisam se separar na Fase 1: o relógio global mantém seu mecanismo atual; a carta ganha um
    mecanismo próprio, novo, do zero.

  ### ALTAR DE SACRIFÍCIO (`ALTAR_OF_SACRIFICE`)
  > **Raridade/custo pós-Fase 7a: LENDÁRIA/1⚡** (era BOOM/0⚡ — ver nota no fim desta entrada;
  > continua listada em "Boom!" abaixo por localização histórica do documento).
  - **Custo:** 1⚡ (patch pós-Fase 7a — antes 0⚡) · **Categoria (PDF):** Evento · **Tipo (motor):** `ACTION`
  - **Efeito exato:** Abre modal para o jogador escolher 2 cartas da mão (quaisquer, exceto a
    combinação BOOM+BOOM — ver abaixo) para sacrificar. A fusão segue a escada `COMUM → RARA →
    ÉPICA → LENDÁRIA → BOOM` (`CLAUDE.md`, 5): fundir 2 cartas da MESMA raridade sobe 1 grau;
    fundir 2 de raridades diferentes nivela pela MENOR e sobe 1 grau (`min(a,b) + 1`); fundir 2
    lendárias garante uma Boom. A carta resultante é SORTEADA aleatoriamente dentre as cartas da
    raridade-alvo, pelo canal `CARDS` do RNG — igual a uma compra normal, sem segundo modal de
    escolha. Deliberado: deixar o jogador ESCOLHER qualquer lendária transformaria o Altar num
    tutor de custo baixíssimo e mataria a identidade de aposta que uma carta Boom deve ter.

    **Matemática superada — não ressuscitar:** a seção 4 do PDF ("UX/UI do Altar") descreve outra
    matemática de fusão ("chance de subir DUAS raridades se as cartas já forem raras/épicas"). Essa
    matemática está SUPERADA pela decisão 5 do `CLAUDE.md` (`min(a,b) + 1`, sempre 1 grau, nunca
    2) — se uma sessão futura reler o PDF cru sem ler este documento, corre o risco de reimplementar
    a regra antiga. A única matemática válida é a escada de 1 grau descrita acima.

    **BOOM + BOOM já não é mais um ritual válido (patch pós-Fase 7a):** antes, sacrificar duas
    cartas Boom saturava no topo da escada e devolvia Boom (`fuseRarity`, que continua correta
    para todas as OUTRAS combinações — inclusive Lendária+Lendária→Boom, que não é exceção). Agora
    essa combinação específica é RECUSADA: o motor (2º passo do `effect`, `registry.ts`) devolve
    `null` e a interação é reembolsada — o jogador recebe as 2 cartas e a energia de volta. A UI
    (`<AltarModal />`) também recusa a atribuição antes de chegar a esse ponto, com feedback visual
    (flash vermelho no slot).
  - **Abre modal:** Sim — 3 formas equivalentes de atribuição, todas resolvendo pelo mesmo caminho
    (patch pós-Fase 7a adicionou a 3ª): arrastar uma carta da mão até um slot; tocar um slot vazio
    e depois numa carta; ou tocar uma carta e depois num slot vazio (nova — antes só a ordem
    slot-depois-carta funcionava com toque). **Exige alvo no tabuleiro:** Não.
  - **Anulável por armadilha:** Não (Lendária, imune — `isImmuneToTraps` cobre Lendária E Boom, sem
    mudança de comportamento na troca de raridade).
  - **Casos de borda:**
    - **Menos de 2 outras cartas na mão** (além do próprio Altar): indisponível para jogar — o
      modal não abre para um ritual impossível de completar.
    - Mão do oponente vazia / tabuleiro — não se aplicam (afeta só a própria mão).
  - **Nota de migração (Fase 6b, concluída):** EFEITO IMPLEMENTADO por completo. A invocação da
    carta fundida (sorteio pelo canal `CARDS`, dentro da raridade calculada por `fuseRarity`, e
    entrega na mão de quem sacrificou) está em vigor — `ALTAR_OF_SACRIFICE.effect` devolve
    `{ interaction: { kind: 'SACRIFICE_DRAG', ... } }` no 1º passo e o `patch`/`log`/`notice`
    (`CARD_ALTAR_INVOKED`) da carta invocada no 2º. O mecanismo antigo (`lastAltarPrompt`,
    `sacrificeCards`, `netSacrificeCards`, `SACRIFICE_CARDS`) foi removido por inteiro, sem deixar
    cruft — era redundante com `pendingInteraction`, que já cobria o mesmo caso desde a Fase 3.
  - **Migração para `pendingInteraction` (Fase 3 → Fase 6b, concluída):** a Fase 3 introduziu o
    `kind` `SACRIFICE_DRAG` na union de `PendingInteraction` (drag-and-drop entre 2 slots, sem
    modal de confirmação por carta) mas deliberadamente adiou a migração do Altar, cobrindo o
    mecanismo só por fixture sintética até então. A Fase 6b fez a migração de fato: `<AltarModal />`
    agora lê `pendingInteraction`/chama `netResolveInteraction`/`netCancelInteraction` em vez do
    mecanismo próprio — o que fecha de graça a 5ª ocorrência do padrão "regra de domínio só
    respeitada porque a UI não oferece o caminho" (ver `AGENTS.md`) e corrige, como efeito
    colateral, um `handleCancel` que antes nunca devolvia a carta ao cancelar.
  - **Rebalanceamento (análise de mesa, patch pós-Fase 7a):** BOOM/0⚡ → LENDÁRIA/1⚡. Custo zero
    tornava o Altar um "grátis, tente a sorte" sem nenhuma fricção — 1⚡ dá ao jogador um motivo
    para pensar antes de arriscar a fusão, sem descaracterizar a identidade de aposta da carta.

  ---

  ## Regras transversais

  ### Energia
  `CLAUDE.md` (1), lei: cada jogador começa a partida com 3⚡. Ao final de QUALQUER turno (seu ou
  do oponente), ambos os jogadores ganham +1⚡, com teto de 3⚡ — energia não gasta permanece entre
  turnos, nunca ultrapassa 3⚡.

  **Estado atual do motor diverge desta regra:** `refillEnergy()` (`src/store/gameStore.ts`) hoje
  CRAVA a energia de quem está começando o turno num valor FIXO de `STARTING_ENERGY` (3), e não
  mexe na energia do outro combatente. Não é "+1 com teto 3 para os dois lados a cada turno que
  termina" — é "reset flat para 3 só para quem está começando a jogar agora". O efeito prático
  difere: hoje é impossível começar um turno com menos de 3⚡; na regra nova, gastar tudo pode
  deixar você com menos de 3⚡ no início do turno seguinte, dependendo de quantos turnos se
  passaram. Isto é uma mudança de motor pendente para a Fase 1, não uma ambiguidade — a regra em
  si já está fechada acima.

  **Tarefa única, não duas:** TURNO_EXTRA (ver Épicas, acima, P11) precisa que a segunda colocação
  de peça NÃO passe pelo refil de energia — hoje ela reusa `beginTurn`, que chama `refillEnergy` e
  daria energia cheia de graça pra segunda jogada. Como a Fase 1 já vai reescrever `refillEnergy`
  do zero para a regra "+1 aos dois lados, teto 3" (o item acima), trate as duas mudanças como UMA
  tarefa só — mexer duas vezes no mesmo ponto (uma pra regra nova, outra pra abrir uma exceção pro
  TURNO_EXTRA) é retrabalho evitável.

  **Implementado na Fase 1 (parte 1).** `refillEnergy` foi substituída por `regenEnergy` (pura, em
  `src/engine/rules.ts`, teto em `ENERGY_CAP` — constante própria, separada de `STARTING_ENERGY`
  por serem perguntas diferentes que hoje só coincidem em valor). `beginTurn` (`gameStore.ts`) ganhou
  um parâmetro `regenEnergyStep` que `placeMark` passa como `!keepsTurn` — a segunda colocação de
  TURNO_EXTRA pula o regen, exatamente como a P11 decidiu.

  **Decisão explícita registrada aqui (não só no diff):** `startNextRound` também trocou o antigo
  `refillEnergy(nextTurn)` (cravava 3⚡ só para quem perdeu a rodada e vai começar a próxima) por
  `regenEnergy(state.playerEnergy, state.machineEnergy)` — o mesmo tratamento simétrico de qualquer
  outro fim de turno. Efeito prático: **perder uma rodada não zera mais a energia acumulada** — quem
  perdeu pode começar a próxima rodada com menos de 3⚡ se já estava gasto, ou mais que 3 nunca
  (teto continua valendo). Aprovado explicitamente nesta rodada: perder uma rodada é uma consequência
  de tabuleiro (dano), não deveria também resetar uma vantagem econômica que o jogador já tinha
  acumulado por jogar bem as energias anteriores.

  A validação de custo (deduzir energia ao jogar, abortar se insuficiente) e o esmaecimento visual
  de cartas caras demais na mão (`CardHand.tsx`) já correspondem ao que o PDF pede — sem mudança
  necessária aí.

  ### Resolução de armadilhas (FIFO)
  PDF, Regra de Ouro 1: em conflito de armadilhas simultâneas, o motor resolve a MAIS ANTIGA
  primeiro. **Já implementado hoje**: armadilhas armadas entram no fim do array
  `playerTraps`/`machineTraps` (`[...traps, nova]`) e o loop de disparo (`resolveCounterTraps`)
  percorre o array em ordem — a mais antiga (índice 0) é sempre checada primeiro. Nenhuma mudança
  necessária.

  **Extensão explícita (Fase 5, auditoria): a mesma exclusividade vale para traps REATIVAS, não
  só para o veto síncrono de `resolveCounterTraps`.** PROTEÇÃO/ANTIMAGIA/RICOCHETE reagem a
  `CARD_ABOUT_TO_RESOLVE` e sempre foram exclusivas (`resolveCounterTraps` para na primeira que
  casar). MINA reage a `PIECE_PLACED` por um caminho DIFERENTE — o loop genérico de
  `dispatchEvent` (`gameStore.ts`) — que, até a Fase 5, NÃO parava no primeiro match: deixava
  qualquer outra trap do mesmo defensor cujo `triggerCondition` também batesse disparar também
  pro mesmo evento. Inofensivo até aqui só porque MINA é a única trap reativa a `PIECE_PLACED`
  hoje. Decisão: a Regra de Ouro 1 vale IGUAL pra esse grupo — a mais antiga que casar dispara
  sozinha, as outras nem são avaliadas para aquele evento. Implementado com um `break` no loop de
  `dispatchEvent`; testado com fixtures sintéticas (duas traps reagindo ao mesmo `PIECE_PLACED`)
  em `gameStore.test.ts`.

  ### Custo de armar vs. ativar
  PDF, Regra de Ouro 3: o custo de uma armadilha é para ARMÁ-LA, nunca para a ativação. **Já
  implementado hoje**: `cost` é debitado em `resolveCardPlay` no momento de jogar a carta (armar,
  para TRAPs); o disparo posterior (`triggerCondition` + `effect`) não deduz energia nenhuma.
  Nenhuma mudança necessária.

  ### Imunidade de lendárias e Boom a armadilhas
  PDF: cartas Lendárias "não podem ser paradas por armadilhas"; cartas Boom "também ignoram
  qualquer armadilha". `CLAUDE.md` (4) estende explicitamente essa imunidade à MINA (lendária, e
  ela própria uma armadilha) contra ANTIMAGIA: Antimagia não anula nem o ARMAR nem o DETONAR da
  MINA.

  **Estado atual do motor:** esta imunidade NÃO é uma regra geral implementada hoje — é só um
  efeito colateral de `SHIELD_TRAP` (PROTEÇÃO) ter uma lista fixa de 2 ids (`HAND_RAID`,
  `SPY_CARD`) no `triggerCondition`, que por acaso não inclui nenhuma lendária/Boom. Não existe
  ainda um `triggerCondition` genérico que LEIA a raridade da carta-alvo e recuse cobrir
  Lendária/Boom automaticamente — isso passa a importar de verdade a partir do momento em que
  ANTIMAGIA (cobertura universal por exclusão de raridade) e RICOCHETE existirem: sem uma checagem
  de raridade centralizada, cada armadilha nova precisaria lembrar de excluir Lendária/Boom
  manualmente, o mesmo tipo de risco de esquecimento que motivou centralizar
  `isAIController`/`handKeyFor` no motor. Recomendação para a Fase 1: um helper único
  (`isImmuneToTraps(rarity)`) consultado por QUALQUER `triggerCondition` de armadilha nova —
  ANTIMAGIA em particular, já que sua cobertura É definida por essa exclusão.

  ### ANTIMAGIA — cobertura universal por exclusão
  Definida por exclusão de raridade, não por categoria de carta: anula a PRÓXIMA carta do
  oponente — ação ou arma de armadilha — que NÃO seja Lendária nem Boom. O oponente perde a
  energia gasta mesmo com o efeito anulado. Cobre também outras armadilhas não-lendárias no
  momento de armar (ex: pode anular o armar de PROTEÇÃO, RICOCHETE, ou uma ANTIMAGIA adversária).

  ### RICOCHETE — categoria estreita, sempre inverte (escopo revisado no patch pós-Fase 7a)
  Dispara contra efeitos do oponente direcionados a você ou aos seus recursos DIRETOS — HP,
  energia ou mão/baralho (categoria, não uma lista fixa de exemplos). Hoje: ATAQUE, SAQUE,
  SAQUE II, APAGÃO — as 4 sempre INVERTEM, o efeito volta pro próprio autor.

  **Fora do escopo de propósito**, sem tag `targetsOpponentResource` nenhuma:
  - **AMALDIÇOAR e ANOMALIA** — mexem na fila de sumiço de PEÇAS do tabuleiro, não em HP/energia/
    mão. Resolvem normal contra RICOCHETE armada (ela nem é consultada).
  - **TROCAR** — é interativa (escolha em 2 passos) e RICOCHETE dispara ANTES da escolha existir;
    não haveria "a carta escolhida" pra inverter sem inventar uma troca cega sem escolha nenhuma
    ou abrir uma interação nova dentro do veto síncrono de armadilha. Decisão do usuário: deixar
    de fora em vez de qualquer uma das duas.

  Antes deste patch a categoria era mais larga ("mão, HP, peças, fila") e existia uma regra de
  fallback ("quando a inversão não é bem definida, RICOCHETE só anula, como ANTIMAGIA") que
  cobria AMALDIÇOAR/ANOMALIA/TROCAR. O fallback foi removido junto — hoje toda carta que dispara
  RICOCHETE tem inversão definida; não sobra nenhum caso de "só cancela, sem devolver nada".

  ### PROTEÇÃO/ANTIMAGIA/RICOCHETE nomeiam a carta anulada (patch pós-Fase 7a)
  Antes deste patch, disparar qualquer uma das três só dizia "uma armadilha disparou" — nem o
  terminal (`ChaosTerminal`) nem o modal de confirmação (`TRAP_TRIGGERED`) diziam CONTRA QUAL carta
  do oponente. Agora as três levam o `CardId` da carta cancelada/refletida no `log` (`value:
  event.cardId`, mesmo padrão que `TRAP_ARMED` já usava para nomear a própria armadilha), e o modal
  de confirmação cita o nome dela na descrição. Sem risco de vazar segredo indevido: a carta
  cancelada JÁ estava sendo jogada às claras (o barramento só entrega `CARD_ABOUT_TO_RESOLVE` no
  instante em que ela ia resolver) — nomeá-la não revela nada que o oponente não estivesse prestes
  a descobrir de qualquer forma.

  ### Limite de mão e compras de 2/3 cartas
  `CLAUDE.md` (3), lei: mão máxima de 5. Se uma compra faria a mão passar de 5, compra até encher
  e o excedente é descartado, com a UI avisando o jogador.

  **Estado atual do motor:** `drawCardsFor` já para de comprar ao atingir `HAND_LIMIT` (o laço tem
  `hand.length < HAND_LIMIT` na condição) — o efeito líquido de "parar de comprar" e "comprar tudo
  e descartar o excedente" é idêntico no estado final da mão. O que falta é só a UI avisando o
  jogador que uma compra foi cortada — não existe hoje.

  ### Escada de raridade do Altar de Sacrifício
  `CLAUDE.md` (5), lei: `COMUM → RARA → ÉPICA → LENDÁRIA → BOOM`. Fundir 2 cartas da mesma
  raridade sobe 1 grau. Fundir 2 de raridades diferentes nivela pela MENOR das duas e sobe 1 grau
  (`min(a, b) + 1`). Fundir 2 lendárias garante uma Boom. Boom + Boom = Boom (nunca "estoura" o
  teto da escada). A carta resultante é sorteada aleatoriamente dentro da raridade calculada, pelo
  canal `CARDS` — sem segundo modal de escolha (ver ALTAR DE SACRIFÍCIO, acima, e a nota sobre a
  matemática alternativa do PDF que este documento marca como superada).

  ### RNG determinístico e deck infinito
  O deck não tem fim — cada compra sorteia uma carta nova sob demanda, com a taxa de raridade
  50/25/15/6/4 (`RARITY_DRAW_WEIGHT`, já bate com o PDF) sorteada em dois estágios (raridade
  primeiro, carta dentro da faixa depois) para a proporção entre faixas não depender de quantas
  cartas cada faixa tem. **Critério de aceitação da Fase 1** (já vale hoje, deve continuar
  valendo com as cartas novas): todo esse sorteio precisa sair do canal `CARDS` do RNG semeado
  (`getChannel('CARDS')`), nunca de `Math.random()` — é o que garante que a seed reproduz a
  partida inteira, incluindo quais cartas cada lado comprou.

  ---

  ## Pendências

  Vazio. Todas as 11 pendências levantadas nas duas rodadas anteriores (P1–P11) foram respondidas
  e incorporadas ao texto acima — ver TURNO_EXTRA (Épicas) para P11 e a nota "Tarefa única, não
  duas" em "Energia" (Regras transversais) para a implicação de implementação que ela gerou.
