# Notas técnicas

Anotações pontuais que não cabem num comentário de código nem merecem virar
uma seção do README, mas que uma tarefa futura precisa encontrar. Cada
entrada linka o arquivo/carta a que se refere; quando a tarefa que a
resolve rodar, ela deve puxar daqui (e a nota pode sair deste arquivo).

## Ressurreição de `uid` revelado ao trocar de mão (SAQUE, TROCAR, Permuta Caótica)

**Contexto:** o `<HandTracker />` (Parte A/A3) marca uma carta como "revelada"
por `uid` (`playerRevealedUids`/`machineRevealedUids`, ver `revealedKeyFor` em
`src/engine/rules.ts`) e nunca limpa essa marca — a leitura preguiçosa
("`uid` revelado E ainda na mão") é o que evita ter que lembrar de limpar em
cada lugar que remove carta da mão.

**O que isso produz:** `HAND_RAID` (SAQUE) e `CARD_TRADE` (TROCAR), e a futura
Permuta Caótica (sucessora da antiga TROCA/`HAND_SWAP`, ver `CLAUDE.md`),
MOVEM uma carta de uma mão para a outra sem trocar o `uid` — a mesma carta
roubada/trocada carrega o `uid` antigo para a mão nova. Se aquele `uid` já
estava marcado como revelado (porque alguém o espiou enquanto ainda estava na
mão de origem), ele chega "ressuscitado" como revelado na mão de destino —
inclusive se o destino for a mão de quem NUNCA o espiou.

**Por que na maioria dos casos está certo:** se a carta passou pela minha mão
e eu a vi (jogando SAQUE/TROCAR eu mesmo, ou tendo minha mão espiada antes de
uma delas me tirar essa carta), eu de fato já conheço aquela carta — a
"ressurreição" só está reafirmando algo que já era verdade.

**Onde pode estar errado (não verificado caso a caso):** um cenário como "A
espiou uma carta de B; B usa TROCAR e a mesma carta muda de mão para A" faria
A ver a PRÓPRIA carta marcada como 'exposta ao oponente' mesmo depois dela ter
saído da mão de B — o destaque (`exposed` em `HandTracker.tsx`) ficaria
tecnicamente correto (B viu aquela carta uma vez), mas pode ler estranho na
tela dependendo de como SAQUE/TROCAR forem re-especificados na Fase 4.

**Ação para a Fase 4:** ao revisar/reimplementar estas três cartas, decidir
explicitamente se o `uid` deve continuar revelado ao mudar de mão ou se o
efeito de troca/roubo deveria emitir um `uid` novo (cortando a revelação de
propósito). Não é um bug bloqueante hoje — é uma decisão de design que ainda
não foi tomada.

## VISÃO ABSOLUTA (`FULL_INTEL`) — mecânica de temporizador não implementada

**Contexto:** `FULL_INTEL` (registry.ts) hoje só loga a contagem da mão do
oponente e mostra um `acknowledge` de "HAND_REVEALED" — o texto da carta
("vire quantas cartas quiser da mão do oponente") nunca ganhou seleção por
carta nem persistência nenhuma.

**Por que não foi implementada junto com o `<HandTracker />` (A3):** é uma
mecânica DIFERENTE da revelação por `uid` que o resto deste documento
descreve. A revelação da ESPIADA (`PEEK_RANDOM`) não tem prazo — dura
enquanto a carta durar na mão. A Visão Absoluta, pelo PDF de design, revela a
mão inteira e EXPIRA (prazo explícito, ao fim do turno) — precisaria de um
temporizador próprio (turno global em que a revelação cai), não do mesmo
`revealedKeyFor` monotônico usado hoje.

**Ação para a Fase 0/4:** ao especificar esta carta na spec completa
(`docs/CARTAS.md`), decidir o mecanismo de expiração (turno de quem jogou?
turno global? contagem de jogadas?) e se ele reaproveita
`playerRevealedUids`/`machineRevealedUids` com uma limpeza condicional, ou se
merece um campo de estado próprio (mais provável, dado que o resto deste
documento já mostra os riscos de reaproveitar um array sem limpeza para uma
mecânica com prazo).

## `resolveCounterTraps` virou um segundo caminho de resolução (Fase 2)

**Contexto:** até a Fase 1, `resolveCounterTraps` (`gameStore.ts`) só aplicava
`patch` + `log` de uma armadilha que cancelou uma carta — um desvio estreito
dentro de `resolveCardPlay`. A Fase 2 (ANTIMAGIA cobrindo o armar de outra
armadilha, RICOCHETE invertendo dano) precisou que ela também: (a) processasse
`damage`/`heal`/`draw` do resultado, igual `applyResult` já fazia pra cartas
normais; (b) fosse chamada de um SEGUNDO ponto em `resolveCardPlay` (o ramo de
ARMAR de `TRAP`, não só o ramo de ação).

**Por que isso importa:** `resolveCounterTraps` agora resolve uma fração cada
vez maior do que `resolveCardPlay`/`applyResult` já resolvem — mas são dois
caminhos de código INDEPENDENTES, não um só parametrizado. Nada garante que
os dois concordem em casos de borda que `applyResult` já trata com cuidado e
`resolveCounterTraps` não checa hoje: `HAND_LIMIT` (se uma inversão futura de
RICOCHETE precisar comprar carta, `drawCardsFor` já para sozinho no limite,
mas ninguém avisa a UI como `applyResult` normalmente avisaria), HP no teto
(`healTarget`/`takeDamage` já fazem seu próprio clamp, isso é seguro), e
principalmente **fim de rodada**: se uma inversão de RICOCHETE algum dia
mexesse no `board` (não mexe hoje — `RICOCHET_INVERSIONS` só cobre dano e
roubo de carta), `resolveCounterTraps` NÃO re-checa `findWinner` como
`applyResult` faz explicitamente — uma vitória produzida dentro de uma
armadilha reativa passaria batido.

**Ação para a Fase 3:** essa fase já mexe no fluxo de resolução de carta (pelo
contrato `pendingInteraction`). Ao mexer, avaliar se `resolveCounterTraps`
deveria virar uma chamada a `applyResult`/uma função compartilhada
parametrizada por "quem é o caster daqui pra frente", em vez de duplicar a
lista de efeitos pós-patch à mão — ou se a duplicação atual é deliberada
(armadilha reativa é conceitualmente mais restrita que carta normal, e talvez
devesse continuar sendo). Não é bug hoje (`RICOCHET_INVERSIONS` não produz
nenhum caso que a lacuna acima afetaria), é risco de DIVERGÊNCIA silenciosa
se um efeito futuro de armadilha crescer sem essa checagem.

**Resolvido na Fase 3 — unificado, não mantido separado.** A Fase 3 introduziu
um TERCEIRO consumidor do mesmo `CardEffectResult` (`resolveInteraction`, o
passo final de uma interação pendente) — três cópias da mesma lista de "o que
fazer depois do patch" deixou de ser sustentável. `applyCardEffectResult(caster,
cardId, result, basePatch)` (`gameStore.ts`) foi extraído como o ÚNICO lugar
que faz `findWinner` recheck, `consumesTurn`/avanço de turno, `log`/`notice`/
`damage`/`heal`/`draw`/`triggersChaosGlitch`/`opensAltar`/`acknowledge` — usado
por `resolveCardPlay` (caminho imediato), `resolveInteraction` (passo final) e
`resolveCounterTraps`. A lacuna que este documento apontava (`resolveCounterTraps`
não rechecava `findWinner`/`consumesTurn`/`opensAltar`) fecha de graça: os três
chamadores agora passam pelo mesmo código, não por três listas mantidas à mão.
**Restrição nova, deliberada:** uma armadilha reativa NUNCA pode produzir
`result.interaction` — `resolveCounterTraps` não trata esse campo (comentário
no código registra isso explicitamente). Um contra-ataque abrindo uma 3ª
interação no MEIO da resolução de outra carta é território novo o bastante
para merecer discussão própria, não uma consequência acidental da unificação;
hoje nenhuma trap pede escolha, então a restrição não corta nenhum caso real.

## Auditoria de campos transitórios em `startNextRound`/`startMatch` (Fase 2)

**Contexto:** `forcedVanish` sobreviveu à troca de rodada sem teste algum até
uma sessão de limpeza de código morto (removendo o antigo `doomedCell`) esbarrar
nele por acaso — `startNextRound` limpava `doomedCell` desde sempre, mas nunca
foi atualizado quando `forcedVanish` o substituiu. Corrigido e coberto em
`src/store/gameStore.test.ts` ("forcedVanish não atravessa troca de rodada").
O bug só não tinha efeito observável ainda porque nenhuma partida real chegou a
gerar a combinação exata que o exporia — exatamente o tipo de lacuna que passa
despercebida sem uma varredura deliberada.

**A varredura, campo a campo.** Só os campos que são "marcação, pendência ou
flag de turno" — os que uma FUTURA interação pendente (`placementBlockedFor` da
Fase 2.5, `pendingInteraction` da Fase 3) também vai ser. Estado persistente da
partida (HP, mão, armadilhas, energia, seed, `matchWinner`, `turnCount` — este
último documentado como relógio que NUNCA reseta) fica de fora: não é da
mesma classe de risco, porque ele é **suposto** atravessar rodadas.

| Campo | `startNextRound` | `startMatch` | Veredito |
|---|---|---|---|
| `blockedCell` | recomputado p/ o tabuleiro novo (`pickFreeCell`) se `activeRule === 'BLOCKED_CELL'`, senão `null` | limpo (`null`) | **Tratado explicitamente** |
| `lockedCell` | `null` | limpo | **Tratado explicitamente** |
| `lockedCellExpiresAtTurn` | `null` | limpo | **Tratado explicitamente** |
| `forcedVanish` | `null` | limpo | **Tratado explicitamente** — era o bug, corrigido nesta rodada |
| `pendingInteraction` (Fase 3 — substituiu `pendingAction`) | `null` | limpo | **Tratado explicitamente** — campo ÚNICO apesar de qualificar um combatente (`caster`), mesma extensão do 5º critério que já cobre `highlightedOldestFor`: só o dono do turno ATUAL pode ter uma interação viva, porque `canPlaceAt`/`endTurn` recusam enquanto `pendingInteraction !== null` — nunca dois turnos em curso ao mesmo tempo, logo nunca duas interações vivas simultâneas. |
| `pendingAcknowledgement` | `null` | limpo | **Tratado explicitamente** |
| `extraTurnPending` | `null` | limpo | **Tratado explicitamente** |
| `roundWinner` | `null` | limpo | **Tratado explicitamente** |
| `winningLine` | `null` | limpo | **Tratado explicitamente** |
| `lastVanishedIndex` | `null` | limpo | **Tratado explicitamente** — precisa ser limpo porque é o ÚNICO dos campos `lastX` sem `id` monotônico companheiro (ver linha abaixo); sem isso um sumiço no MESMO índice na rodada nova não mudaria de valor e a UI não teria como perceber. |
| `machineCardTurn` | não tocado | limpo | **Preservado deliberadamente** — autoinvalida sozinho (`machineCardTurn === turnCount`, e `turnCount` só cresce, nunca repete um valor já usado); documentado no próprio JSDoc do campo em `rules.ts`. |
| `activeRule` / `ruleExpiresAtTurn` | não tocados | limpos (`'NORMAL'` / `null`) | **Preservado deliberadamente** — o surto de caos é definido em unidades do relógio GLOBAL (`turnCount`), não por rodada; `blockedCell` acima é recomputado para o tabuleiro novo justamente para o caso `BLOCKED_CELL` continuar coerente enquanto a regra persiste. |
| `isPaused` | não tocado | limpo (`false`) | **Preservado deliberadamente** — é um toggle do usuário (menu de pausa), independente do ciclo de rodada; nada nele é "marcação de jogada". |
| `playerRevealedUids` / `machineRevealedUids` | não tocados | limpos (`[]`) | **Preservado deliberadamente, mas não estava comentado em `startNextRound`** até esta auditoria — corrigido: comentário adicionado junto da preservação de mão/armadilhas (mesmo motivo: é informação sobre uma carta que CONTINUA na mão, e a mão não é limpa entre rodadas). |
| `lastDamageEvent`/`nextDamageEventId`, `lastExtraTurn`/`nextExtraTurnId`, `lastNotice`/`nextNoticeId`, `lastAltarPrompt`/`nextAltarPromptId` | não tocados | limpos | **Preservado deliberadamente** — todos têm `id` monotônico; a UI reage à MUDANÇA do `id`, nunca ao conteúdo, então um valor "velho" sobrevivendo não pode disparar nada de novo por engano. Mesma razão pela qual `lastVanishedIndex` (sem `id`) É o único que precisa de limpeza explícita. |
| `playerPlacementBlocked` / `machinePlacementBlocked` (Fase 2.5, REBOBINAR) | ambos → `false` | limpos (`false`) | **Tratado explicitamente** — flag de turno, não se encaixa em nenhuma categoria que sobrevive sem tratamento; mesmo raciocínio de `extraTurnPending`/`forcedVanish` (um bloqueio pertence a um turno/rodada que já não existe mais). Ver 5º critério abaixo — por que são DOIS campos, não um só. |
| `highlightedOldestFor` (Fase 2.6, VIDENTE) | `null` | limpo (`null`) | **Tratado explicitamente** — categoria 2 (referencia um índice do tabuleiro da rodada). Campo ÚNICO apesar de qualificar um combatente (`caster`) — ver a extensão do 5º critério logo abaixo: seguro por exclusividade TEMPORAL, não por regra de negócio. Auto-invalida por identidade da peça (`owner`+`turnPlaced`) dentro do MESMO turno — mesma ideia do `CHOSEN` de `forcedVanish` — então mesmo sem esperar `startNextRound` o glow já para de acender se a peça sair do tabuleiro antes. |

**Nenhum campo ficou como "não tratado" de fato** — o único item que a
auditoria mudou foi documentar `playerRevealedUids`/`machineRevealedUids`, que
já estava correto mas silencioso.

**O padrão que emergiu, para reaproveitar:**
1. Se o campo carrega um `id` monotônico próprio → não precisa reset; a UI já
   trata "conteúdo repetido" como não-evento.
2. Se o campo referencia um ÍNDICE/estado do TABULEIRO da rodada que terminou
   (`forcedVanish`, `lastVanishedIndex`, `lockedCell`, `blockedCell`) → precisa
   reset ou recomputação para o tabuleiro novo, porque o tabuleiro é recriado
   vazio a cada rodada e uma referência antiga não aponta pra nada válido.
3. Se o campo é relativo ao relógio GLOBAL (`turnCount`, que nunca reseta) →
   pode sobreviver sem tratamento, porque a comparação contra `turnCount` já
   autoinvalida sozinha.
4. Se o campo é um toggle de UI/usuário sem relação com o ciclo de rodada
   (`isPaused`) → sobrevive por definição.
5. **Se o campo QUALIFICA um combatente específico, precisa de uma entrada POR
   combatente — nunca um slot compartilhado.** Descoberto na Fase 2.5: a
   primeira leitura de REBOBINAR usava `placementBlockedFor: Combatant | null`
   (campo único, copiando o padrão de `forcedVanish`). A analogia era falsa —
   `forcedVanish` é single-owner porque as duas cartas concorrentes (ANOMALIA/
   OBSOLESCÊNCIA) miram a MESMA fila do MESMO oponente, e "a marcação mais
   recente vence" é semanticamente correto ali. REBOBINAR é diferente: os dois
   valores possíveis (`'PLAYER'` bloqueado, `'MACHINE'` bloqueado) descrevem
   ESTADOS DE COMBATENTES DIFERENTES, não uma fila compartilhada — um campo
   único faria bloquear um lado apagar por acidente o bloqueio já em vigor
   contra o outro. Corrigido para `playerPlacementBlocked`/
   `machinePlacementBlocked` (dois booleans, padrão de `playerHp`/`machineHp`).
   **A pergunta a fazer antes de copiar o desenho de `forcedVanish`:** os
   valores possíveis do campo competem pelo MESMO recurso (fila, alvo), ou
   descrevem dois jogadores independentemente? Só o primeiro caso justifica um
   slot único.

   **Extensão do critério, Fase 2.6 — `highlightedOldestFor` (VIDENTE):** este
   campo TAMBÉM qualifica um combatente específico (`caster`) e AINDA ASSIM é
   um slot único, não um par por combatente — sem contradizer o critério
   acima. A pergunta certa não é só "os valores competem pelo mesmo recurso",
   é mais geral: **os dois lados podem ter um valor vivo AO MESMO TEMPO?**
   `playerPlacementBlocked`/`machinePlacementBlocked` podiam (nada impede
   MACHINE estar bloqueada enquanto PLAYER também está). `highlightedOldestFor`
   não pode: o destaque só existe enquanto `turn === caster` (é limpo
   exatamente quando o turno de quem lançou termina, em `placeMark`/
   `endTurn`), e só um turno está em curso por vez — logo nunca há dois
   destaques vivos simultaneamente, e um campo único é seguro. Regra
   consolidada: **par-por-combatente quando os dois valores podem coexistir
   no tempo; campo único quando são mutuamente exclusivos (por regra de
   negócio OU por exclusividade temporal).**

**Checklist para todo campo transitório NOVO** (`pendingInteraction` na Fase
3, e qualquer outro que vier depois): decidir EXPLICITAMENTE, no mesmo PR que
introduz o campo —
- [ ] O campo qualifica UM combatente específico? Se sim, é uma entrada POR
      combatente (5º critério) — nunca um slot único "compartilhado" a menos
      que os valores possíveis disputem o MESMO recurso (caso de
      `forcedVanish`).
- [ ] O que `startNextRound` faz com ele — limpar, recomputar para o tabuleiro
      novo, ou preservar? Qual das categorias 1–4 acima ele é (o 5º critério é
      sobre a FORMA do campo, não sobre o que acontece na troca de rodada)?
- [ ] O que `startMatch` faz com ele — geralmente coberto de graça pelo reset
      total via `{ ...createInitialState() }`, mas confirmar que o campo tem
      valor neutro em `createInitialState()`.
- [ ] Teste cobrindo a decisão — não só a existência do campo, o CICLO dele
      atravessando (ou não) uma troca de rodada.
- Se o campo é uma interação/pendência que trava alguma parte do tabuleiro
  (é exatamente o caso de `pendingInteraction`): confirmar que ele NUNCA
  fica `!= null` no instante em que `startNextRound` roda — do contrário uma
  rodada pode terminar (`findWinner` fecha linha) no MEIO de uma interação
  pendente, e o campo sobrevivendo (ou sendo apagado sem resolver a promessa
  que ele representava) trava o jogo. `pendingAcknowledgement` já resolve
  isso hoje bloqueando `canPlaceAt` enquanto pendente (ver comentário em
  `startNextRound`) — `pendingInteraction` precisa da mesma garantia.

**Checklist acima, aplicado a `pendingInteraction` (Fase 3) — resolvido:**
campo único (justificado na linha da tabela acima), `canPlaceAt`/`endTurn`
recusam enquanto pendente (mesma guarda que `pendingAction` já tinha),
`startNextRound` limpa explicitamente, `createInitialState()` nasce com
`null`, e a garantia "nunca `!= null` quando uma rodada fecha" é estrutural
(não apagada sem resolver: `cancelInteraction`/`resolveInteraction` são os
únicos caminhos que limpam o campo fora de `startNextRound`/`forfeitMatch`, e
os dois sempre resolvem a promessa — aplicando o efeito final ou reembolsando
carta+energia — antes de zerá-lo). Testado em `gameStore.test.ts`.

**Achado extra durante a Fase 3, fora do escopo desta auditoria mas do mesmo
gênero:** `resolveCardPlay` não tinha NENHUMA checagem de `pendingInteraction`
— só a UI (`canDrag` desabilitado em `<CardItem />`) impedia jogar uma 2ª
carta com uma interação já aberta. Registrado como a 4ª ocorrência do padrão
"regra de domínio só evitada pela UI" em `AGENTS.md` (seção "Invariantes de
domínio"); corrigido com uma guarda cedo em `resolveCardPlay`
(`if (state.pendingInteraction !== null) return false;`), coberta por teste
dedicado com carta real provando retorno `false` e zero mudança de estado.

## `isSelected` em `<CardItem />` — inalcançável desde a Fase 3, deixado como está

O timing unificado de `pendingInteraction` (Fase 3: toda interação, `BOARD_TARGET`
incluso, remove a carta da mão no INSTANTE em que abre, não quando resolve) tem um efeito
colateral na UI: a carta armada é removida (`splice`) da mão assim que a mira abre, então o
`<CardItem />` daquela carta desmonta antes de qualquer novo toque poder recolocá-lo em
`isSelected=true`. A prop existe, `CardHand.tsx` ainda a calcula, mas nenhuma instância
renderizada de `<CardItem />` pode mais recebê-la como `true` — junto foi removido só o que
ficou literalmente morto (`cancelTargeting` e o ramo do tap-gesture que o chamava); a prop
`isSelected` em si, o shared value `selected`, seu `useEffect` e o blend em `animatedStyle`
(lift/scale/borda/sombra) ficaram intactos.

**Decisão explícita: não remover agora.** Diferente de `doomedCell` (achado limpando código
morto na Fase 2, ver auditoria acima) — aquele era estado de MOTOR, com risco real de
alguém reativar a lógica errada por engano ao reaproveitar o campo. `isSelected` é prop +
shared value de UI sem consumidor: não mente para ninguém, não pode ser reativada por
acidente, só ocupa espaço. Não é a mesma classe de risco, não merece a mesma urgência de
limpeza — e "inalcançável hoje" não é "inalcançável para sempre": se a Fase 6 mudar a
seleção do Altar, ou uma variação futura de `BOARD_TARGET` decidir manter a carta visível
durante a mira (em vez de remover da mão), o código volta a ser usado. Reconstruir a
animação depois custaria mais do que manter quieta agora.

**Revisitar** quando alguma fase futura de fato tocar este caminho (Altar/`SACRIFICE_DRAG`
na Fase 6, ou qualquer mudança na semântica de "carta armada continua na mão") — só então
decidir se `isSelected` volta a ter consumidor ou se aí sim vale remover.
