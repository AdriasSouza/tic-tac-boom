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

**Decidido na Fase 4: mantém o `uid` antigo — sem mudança de comportamento.**
SAQUE/SAQUE II (`HAND_RAID`/`HAND_RAID_II`) e TROCAR (`SINGLE_CARD_TRADE`)
continuam movendo o `HandCard` com o MESMO `uid` para a mão nova, pela mesma
razão que este documento já apontava: quem viu a carta antes dela mudar de
mão continua conhecendo-a — a "ressurreição" reafirma algo verdadeiro na
maioria dos casos. Cortar a revelação mintando um `uid` novo só na troca
trocaria este risco por um pior (perder uma informação que o jogador
genuinamente já tinha) para resolver um caso de borda (`exposed` lendo
estranho num cenário raro e cosmético) que não compromete nenhuma regra do
jogo. PERMUTA CAÓTICA (`HAND_SWAP`) não foi tocada nesta fase — já seguia a
mesma convenção antes, sem mudança necessária.

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

## `nextCardUid` e `patch` são descartados em silêncio quando `result.interaction` está presente (Fase 4)

**Contexto:** PROCRASTINAR/PROCRASTINAR II (`CARD_DRAFT`/`CARD_DRAFT_TIERED`) mintam uma
carta nova escrevendo `patch: { [handKey]: [...hand, novo], nextCardUid: state.nextCardUid +
1 }` — mas só na chamada TERMINAL de `effect()` (a que NÃO devolve `interaction`). Isso levou
à pergunta: se um efeito futuro precisar mintar carta em MAIS de um passo do mesmo
encadeamento, o `nextCardUid` incrementado no passo N chega atualizado ao passo N+1?

**Resposta, verificada direto no código:** a pergunta não chega a se colocar, porque **não é
possível mintar num passo intermediário hoje** — `finishInteractionStep` (`gameStore.ts`,
~linha 828) e o `applyResult` de `resolveCardPlay` (~linha 1092) checam `if
(result.interaction)` e, se verdadeiro, **retornam sem nunca ler `result.patch`**. Ou seja:
se um efeito algum dia devolver `patch` **e** `interaction` na MESMA chamada (mintando uma
carta enquanto pede mais um passo de escolha), o `patch` — junto com o incremento de
`nextCardUid` que ele carregaria — é **descartado em silêncio**, sem erro, sem log. Isso é
pior do que uma colisão de `uid`: uma colisão pelo menos produziria um sintoma visível (duas
cartas com o mesmo `uid`); um patch descartado simplesmente faz a carta mintada nunca
aparecer, e quem depurar vai procurar em todo lugar MENOS nesta regra de exclusividade.

**Por que não é bug hoje:** nenhuma carta (PROCRASTINAR/PROCRASTINAR II incluídas) tenta
mintar em passo não-terminal — as duas mintam uma vez só, na chamada final. `nextCardUid` só
é lido fresco (via `get()`, dentro de `resolveInteraction`/`resolveCardPlay`) no INSTANTE da
chamada terminal, então dentro de uma única jogada de carta não há corrida: se um efeito
precisar mintar MAIS de uma carta, mas todas dentro da MESMA chamada terminal (um único
`patch`), basta computar os `uid`s sequencialmente a partir de `state.nextCardUid` num
contador local (`state.nextCardUid`, `state.nextCardUid + 1`, ...) — seguro, porque é
aritmética síncrona dentro de uma função só, mesmo padrão que `drawCardsFor`
(`gameStore.ts`) já usa para comprar várias cartas de uma vez.

**Ação para quando isto importar de verdade (Fase 6 ou depois):** uma carta que precise
mintar em PASSOS DIFERENTES do encadeamento (não só cartas diferentes no mesmo passo) exige
mudar o contrato — `applyCardEffectResult`/`finishInteractionStep` precisariam aplicar
`result.patch` MESMO quando `result.interaction` está presente, em vez de ignorá-lo. Isso é
uma mudança de `rules.ts`/`definitions.ts`/`gameStore.ts` (o "pare e avise" que já vale para
essa camada) — não decidir isso sem registrar a razão de precisar, exatamente como a Fase 3
pediu para os `kind`s do contrato original.

## Cláusula `!isImmuneToTraps` de RICOCHETE — estruturalmente inalcançável hoje (Fase 5)

**Contexto:** o `triggerCondition` de `REFLECT_TRAP` (RICOCHETE, `registry.ts`) é
`event.type === 'CARD_ABOUT_TO_RESOLVE' && getCard(event.cardId).targetsOpponentResource ===
true && !isImmuneToTraps(getCard(event.cardId).rarity)`. A auditoria da Fase 5 notou: hoje
NENHUMA carta tem `targetsOpponentResource: true` E raridade Lendária/Boom ao mesmo tempo —
`HAND_SWAP` (a única Lendária que tecnicamente "ataca" a mão do oponente) omite a flag DE
PROPÓSITO (comentário no código já explica: a imunidade por raridade já a protege, marcar a
flag sugeriria que a categoria decide quando é a raridade). Ou seja, toda vez que a primeira
metade da condição (`targetsOpponentResource === true`) é verdadeira hoje, a carta É não-imune
— a cláusula `!isImmuneToTraps(...)` nunca chega a REJEITAR nada; ela é sempre `true` quando
avaliada.

**Mesma classe do `isSelected` morto da Fase 3** (`CardItem.tsx`): código correto, sem
consumidor real que o exercite, deixado como está — não é bug, não justifica um teste forçando
um cenário artificial sem carta por trás só para cobrir uma linha. Diferente de `doomedCell`
(Fase 2): não há risco de reativação silenciosa por engano, é só uma cláusula defensiva
esperando a carta que a torne relevante.

**Revisitar** quando uma carta futura combinar `targetsOpponentResource: true` com raridade
Lendária ou Boom — nesse momento a cláusula passa a ter um caso real pra testar, e vale
adicionar o teste e2e junto da carta nova, não antes.

## `findWinner` com fechamento duplo — TIC TAC BOOM! é a primeira carta a tornar isso possível (Fase 6a)

**Contexto:** `findWinner` (`rules.ts`) escaneia `WIN_LINES` em ordem fixa (as 3 linhas
primeiro, depois colunas, depois diagonais) e devolve a PRIMEIRA combinação que casar. Isso
nunca importou até agora porque só 1 peça é colocada por vez em jogo normal — um fechamento
duplo (as 3 peças de X E as 3 de O completando linhas ao mesmo tempo) é estruturalmente
impossível nesse regime.

**TIC TAC BOOM! (`CHAOS_ROULETTE`, `registry.ts`) muda isso.** A carta reposiciona TODAS as
peças do tabuleiro de uma vez (reshuffle total, ver comentário no `effect`), e duas linhas
disjuntas de `WIN_LINES` (ex: `[0,1,2]` e `[3,4,5]`) cabem nas 6 células que 3 X + 3 O
ocupam, dentro do limite de 3 por símbolo — geometricamente possível e válido. Depois desta
carta, um fechamento duplo É alcançável em jogo real, não só teoricamente.

**Decisão: não mudar `findWinner`/`applyCardEffectResult` para tratar esse caso.** A ordem
fixa de `WIN_LINES` já produz um resultado determinístico e reproduzível por seed — vira o
desempate OFICIAL por decisão, não por acidente de quem escreveu o array primeiro. Mudar o
contrato de `findWinner` (que `resolveCardPlay`/`resolveInteraction`/`resolveCounterTraps`
compartilham via `applyCardEffectResult`) seria uma mudança de escopo do MOTOR inteiro para
resolver um caso que hoje só uma carta produz — desproporcional. Testado em
`registry.effects.test.ts` (o `board` exato que o reshuffle produz) e em
`gameStore.test.ts` (ponta a ponta: `roundWinner` sai o dono da linha `[0,1,2]`, primeira
de `WIN_LINES`).

**Revisitar** se uma carta futura também puder mexer em múltiplas peças de uma vez e o
desempate por ordem de `WIN_LINES` deixar de parecer proporcional — nesse ponto vale
decidir uma regra explícita (ex: nenhum dos dois vence, ou os dois vencem) em vez de
continuar dependendo da ordem do array.

## Cobertura de `chooseCpuCardPlay` (Fase 7a, atualizada no patch pós-Fase 7a de multi-carta + cartas novas)

`chooseCpuCardPlay` tem uma lista de prioridade fixa, primeira condição que casa vence.
Nenhuma carta hoje é "avaliada mas nunca vence prioridade" — toda carta marcada como "Não"
abaixo é porque `find(id)` nem existe pra ela na função (nunca chega a ser avaliada).

**Patch pós-Fase 7a (multi-carta + 9 cartas):** a função deixou de estar limitada a "no
máximo uma carta por turno" (`machineCardTurn` — campo e guarda foram REMOVIDOS por
completo, não só relaxados; ver a seção seguinte) e ganhou prioridades para as 9 cartas
adicionadas nas duas rodadas anteriores (`RENEW_PIECE`/`MULLIGAN`/`SLIDE_PIECE`/
`SCRY_DECK`/`BACKUP_BATTERY`/`TIME_CAPSULE`/`TRIPWIRE`/`BLACKOUT`/`PARADOX`), que até então
nunca eram consideradas. Os 9 gaps PRÉ-EXISTENTES da baseline de 29 cartas (linha "Não"
abaixo) continuam de fora — fora do escopo desta rodada, não um esquecimento novo.

| Carta (id) | Considerada? | Condição / motivo |
|---|---|---|
| CURA (`HEAL_SELF`) | Sim | Prioridade 1 (crítica, `hpOf(CPU) <= 2`) e prioridade 15 (não-crítica, joga se sobrar na mão). |
| BATERIA RESERVA (`BACKUP_BATTERY`, carta nova) | Sim | Prioridade 2 — `hpOf(CPU) <= 3` e ainda sem escudo ativo. |
| CÁPSULA DO TEMPO (`TIME_CAPSULE`, carta nova) | Sim | Prioridade 3 (crítica, `hpOf(CPU) <= 2` e ainda não armada) — dá timing de verdade, além da cobertura genérica de armadilha (prioridade 8) que ela também recebe fora do caso crítico. |
| ATAQUE (`DIRECT_DAMAGE`) | Sim | Prioridade 4 — abate garantido: `hpOf(HUMAN) <= 2`. |
| DESLIZAR (`SLIDE_PIECE`, carta nova) | Sim | Prioridade 5 (fecha linha na hora, `findWinningSlide` — mesma urgência de uma vitória por colocação) e prioridade 22 (oportunista, `rng.chance(0.15)`, reposiciona sem garantia de vitória). |
| TROPEÇAR (`TRIP_PIECE`, carta nova) | Sim | Prioridade 6 — desarma uma ameaça de vitória iminente do HUMANO (2 peças na linha + 1 vazia) tropeçando uma delas pra fora (`findDisruptiveTrip`). Nunca fecha linha PRA CPU (move a peça do outro lado), então não tem equivalente à prioridade 5 de DESLIZAR nem versão "oportunista" — sem ameaça pra desarmar, a carta simplesmente não é escolhida. |
| LIMPAR (`CLEAR_BLOCK`) | Sim | Prioridade 7 — `activeRule === 'BLOCKED_CELL'` e a célula bloqueada é conhecida. |
| PURIFICAR (`CLEANSE`) | Sim | Prioridade 7 — alvo é `blockedCell` ou `lockedCell`, o que estiver ativo. |
| TURNO EXTRA (`TURNO_EXTRA`) | Sim | Prioridade 8 — sempre boa, sem alvo; só verifica `extraTurnPending !== CPU` (não duplicar concessão). |
| MINA (`BOMB_TRAP`) | Sim (genérico) | Prioridade 9 — `TRAP_CARD_IDS.includes(...)`, arma a PRIMEIRA armadilha da mão nessa ordem; nenhuma preferência pelo tipo (Lendária ou não). |
| PROTEÇÃO (`SHIELD_TRAP`) | Sim (genérico) | Mesma prioridade 9, mesma falta de diferenciação por tipo. |
| ANTIMAGIA (`ANTI_SPELL_TRAP`) | Sim (genérico) | Mesma prioridade 9. |
| RICOCHETE (`REFLECT_TRAP`) | Sim (genérico) | Mesma prioridade 9. |
| FIO DE ARAME (`TRIPWIRE`, carta nova) | Sim (genérico) | Mesma prioridade 9 — sem regra própria, entra igual às outras 3 armadilhas antigas. |
| PARADOXO (`PARADOX`, carta nova) | Sim (genérico) | Mesma prioridade 9 — idem; é uma "arma e esquece", não precisa de timing especial. |
| DEMOLIR (`BREAK_PIECE`) | Sim | Prioridade 10 — só dispara quando o HUMANO já tem 3 peças no tabuleiro (`getOldestPieceIndex` exige `>= MAX_PIECES_PER_PLAYER`; com menos de 3, a condição nunca fecha). |
| RENOVAR (`RENEW_PIECE`, carta nova) | Sim | Prioridade 11 — com 2+ peças próprias no tabuleiro, renova a mais antiga (jogada de atraso tática). |
| SAQUE (`HAND_RAID`) | Sim | Prioridade 12 — mão do humano não vazia E `rng.chance(0.5)` (probabilística, não garantida mesmo com condição satisfeita). |
| SABOTAGEM (`SABOTAGE`) | Sim | Prioridade 12 — mesma forma de SAQUE. |
| APAGÃO (`BLACKOUT`, carta nova) | Sim | Prioridade 13 — só quando `energyOf(HUMAN) >= 2` (denial que não denega quase nada não vale o custo). |
| TRAVAR (`LOCK_CELL`) | Sim | Prioridade 14 — trava uma célula vazia aleatória (disrupção de baixo custo). |
| OBSOLESCÊNCIA/AMALDIÇOAR (`OBSOLESCENCE`) | Sim | Prioridade 15 — mira a peça mais NOVA do humano (`getPieceIndexes(...).at(-1)`); dispara sempre que ele tiver >=1 peça. |
| ESTUDAR (`STUDY`) | Sim | Prioridade 17 — mão não cheia; verificada DEPOIS de ESTUDAR II. |
| ESTUDAR II (`STUDY_II`) | Sim | Prioridade 17 — mão não cheia; checada ANTES de ESTUDAR (prioridade "mais cartas primeiro"). |
| VISÃO ABSOLUTA (`FULL_INTEL`) | Sim | Prioridade 18 — só se a mão do humano não estiver vazia; puramente informativa. |
| ESPIADA (`PEEK_RANDOM`) | Sim | Prioridade 18 — só se a mão do humano não estiver vazia; sem chance/condição além disso. |
| PRESSÁGIO (`SCRY_DECK`, carta nova) | Sim | Prioridade 19 — `rng.chance(0.2)`, sem outra condição. Zero ganho MECÂNICO pra CPU (ela decide sempre com o `state` inteiro à vista, não "lembra" do que viu) — só evita a carta apodrecer na mão, mesmo racional de VISÃO ABSOLUTA/ESPIADA. |
| RECICLAR (`MULLIGAN`, carta nova) | Sim | Prioridade 20 — `hand.length > 1` E `rng.chance(0.2)`; a escolha de QUAL carta descartar cai na heurística ingênua existente (`PICK_ONE_FROM_HAND`). |
| PERMUTA CAÓTICA (`HAND_SWAP`) | Sim | Prioridade 21 — `rng.chance(0.15)`, sem outra condição (alto risco, propositalmente raro). |
| TIC TAC BOOM! (`CHAOS_ROULETTE`) | Sim | Prioridade 23 — `rng.chance(0.2)`, sem condição além do custo 0. |
| VIDENTE (`HIGHLIGHT_OLDEST`) | **Não** | Nunca referenciada. Pré-existente à baseline de 29 cartas — fora do escopo desta rodada. |
| ANOMALIA (`QUEUE_SHUFFLE`) | **Não** | Nunca referenciada. Pré-existente — fora do escopo desta rodada. |
| TROCAR (`SINGLE_CARD_TRADE`) | **Não** | Nunca referenciada. Pré-existente — fora do escopo desta rodada. |
| ESPIONAGEM (`INTEL_REVEAL`) | **Não** | Nunca referenciada. Pré-existente — fora do escopo desta rodada. |
| PROCRASTINAR (`CARD_DRAFT`) | **Não** | Nunca referenciada. Pré-existente — fora do escopo desta rodada. |
| SAQUE II (`HAND_RAID_II`) | **Não** | Nunca referenciada — só a versão I (`HAND_RAID`) está na lista. Pré-existente — fora do escopo desta rodada. |
| PROCRASTINAR II (`CARD_DRAFT_TIERED`) | **Não** | Nunca referenciada. Pré-existente — fora do escopo desta rodada. |
| ALTAR DE SACRIFÍCIO (`ALTAR_OF_SACRIFICE`) | **Não** | Nunca referenciada. Pré-existente — fora do escopo desta rodada. |
| REBOBINAR (`REBOBINAR`) | **Não** (jogar) / Sim (respeitar) | A CPU nunca ESCOLHE jogar REBOBINAR — mas `chooseCpuMove` RESPEITA corretamente a punição quando o HUMANO a joga contra ela (`state.machinePlacementBlocked`, checado antes de qualquer simulação de jogada). "Jogar a carta" e "respeitar o efeito dela" são coisas diferentes; só a primeira está zerada aqui. Pré-existente. |

**Novo achado deste patch, corrigido:** `resolveCpuInteraction` (o resolvedor do 2º passo de
uma interação que a PRÓPRIA CPU abriu) tinha um `switch` sem `case` para `kind:
'PICK_BOARD_CELL'` (o 2º passo de DESLIZAR) — como a função devolve `void`, isso NÃO era
erro de compilação, era um soft-lock LATENTE: se a CPU algum dia propusesse DESLIZAR sem
esse caso, o turno travaria pra sempre (nada resolveria a interação pendente). Adicionado
junto da cobertura de DESLIZAR — escolhe, entre os destinos elegíveis, o que fecha linha
(reaproveitando a mesma checagem de `findWinningSlide`), senão sorteia.

**Resumo:** 8 das 38 cartas atuais nunca são consideradas para jogo pela CPU — todas
pré-existentes à baseline de 29 cartas (nenhum gap NOVO nesta rodada). As 6 armadilhas
(MINA/PROTEÇÃO/ANTIMAGIA/RICOCHETE/FIO DE ARAME/PARADOXO) são "consideradas" só
genericamente pela regra de prioridade 8 (primeira da mão, sem diferenciação por
raridade/efeito) — exceto CÁPSULA DO TEMPO, que também ganhou uma regra PRÓPRIA de
prioridade alta pro caso crítico.

## Harness de auto-jogo determinístico CPU x CPU (Fase 7a)

**Achado que definiu o desenho:** `chooseCpuCardPlay`/`chooseCpuMove` não recebem
`combatant` como parâmetro — são hardcoded pra decidir por `MACHINE` (`const CPU: Combatant
= 'MACHINE'` no topo de `cpu.ts`). `playCPUTurn` é genérico só na INTERFACE de ações
(`CpuActions`), por dentro ainda compara `fresh.turn !== CPU`. Rodar CPU-contra-CPU exigiu
decidir como fazer o `PLAYER` usar a MESMA heurística sem parametrizar `cpu.ts` (mudaria
comportamento de produção, fora do escopo de uma fase de diagnóstico).

**Solução: espelhar o `GameState`, não a lógica.** `mirrorForDecision`
(`src/engine/ai/cpuMirror.ts`) devolve uma cópia do estado real com os dois lados
trocados (mão, energia, HP, armadilhas, tabuleiro — dono E símbolo da peça juntos —,
bloqueio de posicionamento, `extraTurnPending`, `pendingInteraction.caster`/`.source`).
Quando é a vez do `PLAYER`, o harness alimenta `chooseCpuCardPlay`/`chooseCpuMove`/
`playCPUTurn` com essa cópia — a heurística "pensa" que decide por `MACHINE`, mas os dados
são do `PLAYER` real. O resultado (uid/cardId/índice de tabuleiro) nunca precisa de
tradução de volta — nenhum dos dois é combatant-específico — só as AÇÕES aplicadas ao
estado real usam `combatant` explícito (`placeMark`/`endTurn`/`resolveInteraction`, que já
aceitam isso; só `playCard`/`playMachineCard` são pré-vinculadas por lado).

**Assimetria resolvida no patch pós-Fase 7a (multi-carta):** esta seção documentava
`machineCardTurn` como um campo assimétrico (sem par do lado `PLAYER`) que
`mirrorForDecision` deliberadamente não trocava. O patch que permitiu a CPU jogar mais de
uma carta por turno REMOVEU o campo inteiro — a guarda que ele sustentava
(`chooseCpuCardPlay` recusando uma 2ª carta no mesmo `turnCount`) deixou de fazer sentido
assim que múltiplas cartas por turno passaram a ser o comportamento desejado, e nada mais no
código consultava o campo (confirmado por busca antes de remover). `mirrorForDecision` não
precisou de nenhum ajuste — a lista de campos que ela troca já não incluía isso.

**Testado isoladamente** (`src/engine/ai/cpuMirror.test.ts`, sem depender do harness de
partidas): involução com estado variado e com campos nulos, e conferência célula-a-célula
de um tabuleiro parcialmente preenchido — o caso de maior risco (inverter só o dono sem
inverter o símbolo faria `findWinner`/`simulate` de `cpu.ts` decidirem errado sem exception
nenhuma, e o sintoma seria só uma taxa de vitória enviesada, invisível sem esse teste).

**Onde mora:** `src/store/cpuSelfPlay.harness.test.ts` (não em `src/engine/ai/` — o
harness precisa de `useGameStore`, e nenhum arquivo hoje sob `src/engine/` importa de
`@/store`, confirmado por grep; `mirrorForDecision` em si é pura e mora em `src/engine/ai/`
junto de `cpu.ts`). Fora do CI sem tocar `vitest.config.mts`: o arquivo casa com o glob
padrão de testes, mas o `describe` só roda com `RUN_CPU_HARNESS=1` — em qualquer rodada
comum aparece como "skipped".

**Linha de base coletada (300 partidas, seeds 1000–1299, baralho pós-rebalanceamento):**
0 travamentos; vitórias PLAYER 133 (44,3%) vs. MACHINE 167 (55,7%). Números brutos, sem
interpretação — fica pra próxima fase decidir se o viés de ~11 pontos percentuais é da
ordem de jogada (MACHINE sempre decide depois de ver o tabuleiro) ou de alguma assimetria
da heurística.

**Zero travamentos em 300 partidas reais é evidência que vale mais que os testes unitários
isolados que motivaram cada correção.** É a primeira confirmação EMPÍRICA, sob combinação
real de cartas/regras/interações (não cenários isolados construídos à mão), de que as
guardas de domínio corrigidas ao longo da Parte B (`AGENTS.md`, "Invariantes de domínio" —
`placeMark` sem dono do turno, `resolveCardPlay` sem checagem de interação pendente, o
mecanismo do Altar sem guarda de motor, entre outras) seguram — nenhuma delas reapareceu
como soft-lock quando exercitada por 300 sequências de jogo distintas e determinísticas.

**Pendência aberta antes de fechar a fase (investigação, sem mudar comportamento):** a
diferença de vitória rodando a MESMA heurística nos dois lados precisa de causa isolada
antes da próxima fase usar a tabela de "vitória condicionada por carta" — se for viés
estrutural de quem começa, toda essa tabela está confundida com ele (uma carta que o
MACHINE jogue mais parece "melhor" só por isso). Achados da investigação:
1. **Quem começa é FIXO, não depende da seed:** `createInitialState()` crava
   `turn: 'PLAYER'` — todo match começa com o PLAYER jogando primeiro na 1ª rodada, nas 300
   sementes. Rodadas seguintes DENTRO do mesmo match alternam por quem perdeu a rodada
   anterior (`startNextRound`: `nextTurn = roundWinner === 'PLAYER' ? 'MACHINE' : 'PLAYER'`
   — o perdedor começa a próxima), mas a 1ª rodada de TODO match é sempre PLAYER-primeiro.
   Assimetria estrutural real, confirmada por leitura, não por amostra.
2. **O espelhamento (`mirrorForDecision`) não consome RNG e não abre nenhum caminho de
   código exclusivo de estado espelhado ou real** — é a MESMA `chooseCpuCardPlay`/
   `chooseCpuMove`, mesmo canal `AI`, para os dois lados. Único desvio real encontrado:
   `isAIController`/`announcesCardPlay` (`registry.ts`/`gameStore.ts`) tratam
   `caster === 'MACHINE'` como "pula o modal" e `PLAYER` (mesmo sendo o harness a decidir
   por ele) como "sempre pausa para confirmação" — mas o `patch` aplicado por cartas como
   VISÃO ABSOLUTA é IDÊNTICO nos dois ramos; a diferença é só ciclo de pausa/confirmação
   (que o harness já resolve), não resultado de jogo. Nenhuma fonte de viés de OUTCOME
   encontrada no espelhamento em si.
3. **133 a 167 em 300 está bem perto da fronteira de ruído puro, não muito além dela.**
   Sob a hipótese de moeda justa (p=0,5), erro padrão da proporção em n=300 é
   `sqrt(0,5·0,5/300) ≈ 2,9 p.p.`; o desvio observado (55,7% − 50% = 5,7 p.p.) é
   ≈ 1,96 erro-padrão — bem na fronteira convencional de "improvável só por acaso" (~5%),
   não uma discrepância gritante muitos desvios-padrão acima do ruído. Não dá pra descartar
   coincidência de amostra sozinho, mas combinado com o Achado 1 (assimetria estrutural
   real e conhecida), o mais provável é que pelo menos PARTE da diferença venha de quem
   começa, não de um bug na heurística ou no harness.

**Não corrigido nesta sessão** (fora de escopo — sessão é diagnóstico). Encaminhado pra
próxima fase: rodar metade das seeds com os papéis de "quem começa" invertidos antes de
confiar na tabela de vitória condicionada por carta.

## TIC TAC BOOM! — bug relatado ("CPU jogou, eu venci, o dano não aplicou") não reproduzido no motor (patch pós-Fase 7a)

**Contexto:** usuário relatou que, numa partida contra a CPU, ela jogou CHAOS_ROULETTE, o
reshuffle fechou uma linha do jogador humano, mas o dano/fim de rodada não aplicaram.
Investigação completa do caminho `playMachineCard → resolveCardPlay →
queueAcknowledgement(CARD_PLAYED, applyResult) → acknowledgePending → applyCardEffectResult`
não encontrou NENHUM branch que condicione `findWinner`/`takeDamage` ao `caster` — o código
lido é agnóstico de quem jogou a carta, tanto para quem tem a vitória (`outcome.winner`, vem
só de `findWinner(board)`) quanto para quem sofre o dano (`outcome.winner === 'PLAYER' ?
'MACHINE' : 'PLAYER'`, sempre o LADO OPOSTO ao vencedor, nunca ao caster).

**O que de fato faltava: cobertura de teste, não um bug confirmado.** Nenhum teste no repo
jogava CHAOS_ROULETTE com `caster: 'MACHINE'` antes deste patch — todos usavam `playCard`
(`caster: 'PLAYER'`), e nos que fechavam linha, quem vencia sempre coincidia com quem
lançou a carta. O cenário exato do relato (`caster: 'MACHINE'`, `winner: 'PLAYER'`) nunca
tinha sido exercitado. Adicionado em `gameStore.test.ts` — passa com o código como estava,
sem nenhuma mudança de lógica necessária para esse caminho.

**Candidato real e independente encontrado, mas não corrigido (não bate 100% com o relato):**
`resumeMatch` (persistência de partida local/CPU, sessão anterior) descarta o
`acknowledgementQueue` — a fila em memória do MÓDULO (`gameStore.ts`, fora do `GameState`) que
guarda o `apply` de um `CARD_PLAYED` pendente — se o app remontar/relançar enquanto o modal "A
CPU JOGOU..." está na tela. Se isso acontecer bem no meio de um CHAOS_ROULETTE da CPU, o efeito
(reshuffle + recheck de vitória + dano) é perdido silenciosamente: o jogo retoma como se a CPU
não tivesse jogado nada. Não registrado como bug desta sessão porque (a) exige um remount
exatamente naquela janela — não acontece numa sessão contínua sem recarregar o app/Metro, e (b)
não reproduz exatamente "eu vi o reshuffle acontecer" do relato, já que o reshuffle também
nunca chegaria a aplicar nesse caminho.

**O que FOI corrigido nesta sessão, e é o candidato mais provável pra explicar o relato:** a
linha vencedora do TIC TAC BOOM! acendia (`surfaceWinning`, `Cell.tsx`) assim que a PRÓPRIA
coluna daquela célula parava de girar (900/1700/2500ms, por coluna) — não quando o giro
INTEIRO terminava. Uma linha vencedora não-vertical (qualquer linha, coluna ou diagonal que
cruze colunas diferentes) podia mostrar o dourado até 1.6s antes da 3ª coluna parar, enquanto
as outras duas células ainda mostravam glifos aleatórios do flicker. Um jogador vendo "minha
linha já fechou" bem antes da animação terminar, seguido de uma pausa de ~1.6s sem nada
acontecer, é consistente com "pareceu que ganhei mas o efeito não veio" — mesmo o dano já
tendo sido aplicado de verdade, de forma síncrona, no instante em que o giro começou (ver
comentário em `applyCardEffectResult`, `gameStore.ts`, sobre por que isso é proposital: o
`chaosRoulettePatch` é montado ANTES do recheck de `findWinner`). Corrigido gateando
`surfaceWinning` pelo flag GLOBAL `chaosRouletteSpinning` (só cai no ÚLTIMO stop do
cronograma) em vez do `isSpinning` LOCAL de cada célula.

**Revisitar** se o relato se repetir depois deste patch — nesse ponto o candidato do
`resumeMatch`/`acknowledgementQueue` acima passa a valer a pena perseguir de verdade (exigiria
serializar a fila de anúncios pendentes, ou reprocessar o log de ações como o multiplayer já
faz via `resyncFromActionLog` — não uma mudança pequena).

## As duas vias de aplicação de TRAP convergiram para `applyCardEffectResult` (patch de defesa — PARADOXO)

**Contexto:** antes deste patch existiam DOIS caminhos que aplicam o resultado de uma `TRAP`,
e eles JÁ tinham divergido silenciosamente:
- `resolveCounterTraps` (veto síncrono — ANTIMAGIA/PROTEÇÃO/RICOCHETE, reage a
  `CARD_ABOUT_TO_RESOLVE`) já delegava para o pipeline completo desde a Fase 3:
  `applyCardEffectResult(defender, trap.cardId, result, { [trapsKey]: remaining })` —
  entende `patch`/`log`/`notice`/`damage`/`heal`/`draw`/`acknowledge`/`triggersChaosGlitch`,
  re-checa `findWinner`.
- `dispatchEvent` (reativo — hoje MINA, `PIECE_PLACED`) tinha uma aplicação MANUAL mais
  estreita, escrita antes dessa unificação: só entendia `patch`/`log`/`notice`/`damage`. Um
  resquício que nunca doeu porque nenhuma trap reativa até então precisava de mais que isso.

**Por que isso importava para este patch:** FIO DE ARAME (`energyDrain`, campo novo) e,
principalmente, PARADOXO (que reexecuta o `effect()` de QUALQUER carta de custo 3⚡ copiada —
`heal` de CURA, `draw` de ESTUDAR II, `acknowledge` de SABOTAGEM) precisavam de campos que a
via reativa nunca soube tratar. Sem a unificação, MINA continuaria funcionando (o resultado
dela sempre coube no subconjunto antigo) mas PARADOXO copiando CURA silenciosamente perderia a
cura — `heal` cairia no chão, sem erro nenhum, só o efeito não acontecendo.

**Ação:** a aplicação manual dentro do loop de `dispatchEvent` (`gameStore.ts`) foi trocada por
uma chamada a `applyCardEffectResult`, idêntica à que `resolveCounterTraps` já fazia — mesma
assinatura, mesmo `basePatch` vazio (a remoção do array de armadilhas já acontece antes, fora
do pipeline, porque a carta "vira pra cima" na mesa imediatamente, independente de quando o
jogador confirma o "Entendi"). Confirmado que isso não reabre o risco de recursão que o
`isDraining`/fila de `dispatchEvent` existe pra evitar: `applyCardEffectResult` nunca dispara
`dispatchEvent` sozinha — quem publica `CARD_PLAYED` é sempre o CHAMADOR (`resolveCardPlay`/
`finishInteractionStep`), nunca essa função — então uma MINA ou um PARADOXO disparando não gera
um novo `CARD_PLAYED` capaz de re-acionar outro PARADOXO em cascata.

**Restrição herdada, ainda válida:** `applyCardEffectResult` continua documentada como "nunca
chamada com `result.interaction` presente" — PARADOXO respeita isso por construção: quando a
carta copiada pede uma interação (SABOTAGEM, o ramo de escolha de SAQUE II), o próprio
`effect()` do PARADOXO resolve o passo sozinho, via RNG (`autoResolveInteraction`,
`registry.ts`), ANTES de devolver um resultado — o que chega até `dispatchEvent`/
`applyCardEffectResult` é sempre um resultado FINAL. Ver a entrada de PARADOXO em
`docs/CARTAS.md` para o porquê de não dar pra abrir um modal de verdade pro dono da armadilha
(`resolveInteraction` exige `state.turn === combatant`, e ele está fora da própria vez).

**Regressão coberta:** a suíte e2e de MINA (`gameStore.test.ts`, Fase 5) já exercitava o
caminho `dispatchEvent → queueAcknowledgement(TRAP_TRIGGERED) → apply()` ponta a ponta e
continuou passando sem nenhuma alteração de asserção — sinal de que a troca de pipeline é
estritamente aditiva pro que já existia.
