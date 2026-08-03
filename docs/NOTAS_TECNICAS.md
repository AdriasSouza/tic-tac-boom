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
