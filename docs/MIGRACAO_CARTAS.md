# Migração de cartas — implementação atual → `docs/CARTAS.md`

Comparativo entre o que está registrado hoje em `src/engine/cards/registry.ts` e a nova
especificação em `docs/CARTAS.md`. Base para a Fase 1 da Parte B. Todas as pendências da rodada
anterior foram respondidas — classificações e ids abaixo já refletem as decisões finais.

**Nota de contagem:** o `README.md` citava "13 cartas" no resumo de estado atual; o número real
é **19** (`CARD_REGISTRY` tem 19 entradas). Já corrigido no `README.md` nesta rodada — tabela de
cartas regenerada a partir do registry (ver commit).

**Checagem ANTI-MAGIA:** o `README.md` antigo também citava "PROTEÇÃO, ANTI-MAGIA" como as duas
armadilhas de defesa já implementadas. Grep completo em `src/` (case-insensitive, por `ANTI`,
`SPELL`, `MAGIA`, `MAGIC`) confirma que NENHUM id de carta corresponde a isso — o único hit é um
comentário em `src/engine/events.ts:29` citando "ANTI-MAGIA" como exemplo conceitual de trap de
defesa, não uma carta implementada. `SHIELD_TRAP` (a única trap defensiva real hoje) só cobre
`HAND_RAID`/`SPY_CARD` por id fixo (ver registry.ts:653-654) — não tem nada de "anular por
exclusão de raridade". Confirmado: ANTI-MAGIA não existe sob nenhum outro id; a contagem de 19
cartas hoje / 29 na spec nova não muda.

Classificações usam exatamente as 4 categorias pedidas. Onde mais de uma se aplica ao mesmo
tempo (ex: mudou de nome E de efeito), as duas aparecem combinadas — separar em uma só
esconderia informação.

## Tabela de comparação (as 19 cartas de hoje)

| Hoje (id / nome) | Novo (id / nome) | Raridade nova | Custo novo | Classificação |
|---|---|---|---|---|
| `CLEAR_BLOCK` / LIMPAR | `CLEAR_BLOCK` / LIMPAR | COMUM | 1⚡ | EFEITO ALTERADO |
| `CLEANSE` / PURIFICAR | `CLEANSE` / PURIFICAR | ÉPICA | 2⚡ | EFEITO ALTERADO |
| `LOCK_CELL` / TRAVAR | `LOCK_CELL` / TRAVAR | COMUM | 1⚡ | MANTIDA |
| `BREAK_PIECE` / DEMOLIR | `BREAK_PIECE` / DEMOLIR | COMUM | 1⚡ | MANTIDA |
| `PEEK_RANDOM` / ESPIADA | `PEEK_RANDOM` / ESPIADA | RARA | 1⚡ | EFEITO ALTERADO |
| `DRAW_CARD` / PROCRASTINAR | `STUDY` / ESTUDAR | RARA | 2⚡ | RENOMEADA (id + nome) |
| `DRAW_CARD_BIG` / PROCRASTINAR II | `STUDY_II` / ESTUDAR II | ÉPICA | 2⚡ | RENOMEADA (id + nome) |
| `HAND_RAID` / SAQUE | `HAND_RAID` / SAQUE | RARA | 2⚡ | EFEITO ALTERADO |
| `CARD_TRADE` / TROCAR | `HAND_SWAP` / PERMUTA CAÓTICA | LENDÁRIA | 3⚡ | RENOMEADA + EFEITO ALTERADO |
| `REVEAL_OLDEST` / VIDENTE | `OBSOLESCENCE` / OBSOLESCÊNCIA | ÉPICA | 3⚡ | RENOMEADA + EFEITO ALTERADO |
| `SPY_CARD` / ESPIONAGEM | `SABOTAGE` / SABOTAGEM | ÉPICA | 3⚡ | RENOMEADA + EFEITO ALTERADO |
| `DIRECT_DAMAGE` / ATAQUE | `DIRECT_DAMAGE` / ATAQUE | ÉPICA | 3⚡ | MANTIDA |
| `HEAL_SELF` / CURA | `HEAL_SELF` / CURA | ÉPICA | 3⚡ | MANTIDA |
| `EXTRA_TURN` / PULAR | `TURNO_EXTRA` / TURNO EXTRA | ÉPICA | 3⚡ | RENOMEADA (id + nome, mantida por decisão) |
| `FULL_INTEL` / VISÃO ABSOLUTA | `FULL_INTEL` / VISÃO ABSOLUTA | LENDÁRIA | 3⚡ | EFEITO ALTERADO |
| `BOMB_TRAP` / MINA | `BOMB_TRAP` / MINA | LENDÁRIA | 3⚡ | MANTIDA |
| `SHIELD_TRAP` / PROTEÇÃO | `SHIELD_TRAP` / PROTEÇÃO | RARA | 1⚡ | MANTIDA (gatilho ampliado — ver nota) |
| `CHAOS_ROULETTE` / TIC TAC BOOM! | `CHAOS_ROULETTE` / TIC TAC BOOM! | BOOM | 0⚡ | EFEITO ALTERADO (reforma completa) |
| `ALTAR_OF_SACRIFICE` / ALTAR DE SACRIFÍCIO | `ALTAR_OF_SACRIFICE` / ALTAR DE SACRIFÍCIO | BOOM | 0⚡ | EFEITO ALTERADO (invocação incompleta) |

**PROTEÇÃO ("MANTIDA (gatilho ampliado)"):** nome e mecanismo de escudo idênticos; o gatilho
deixa de ser uma lista fixa de 2 ids (`HAND_RAID`, `SPY_CARD`) e passa a ser definido por
CATEGORIA ("qualquer carta que leia ou retire cartas da mão") — cobre hoje SAQUE, SAQUE II,
SABOTAGEM, ESPIADA, ESPIONAGEM, TROCAR automaticamente, inclusive cartas dessa categoria que
ainda vierem a ser criadas.

**Nenhuma carta é removida sem sucessora.** Todas as 19 mapeiam para algo na nova
especificação.

## Cartas NOVAS (sem equivalente na implementação atual)

| id proposto | Nome | Raridade | Custo |
|---|---|---|---|
| `CARD_DRAFT` | PROCRASTINAR | RARA | 2⚡ |
| `SINGLE_CARD_TRADE` | TROCAR | RARA | 2⚡ |
| `HIGHLIGHT_OLDEST` | VIDENTE | RARA | 2⚡ |
| `QUEUE_SHUFFLE` | ANOMALIA | RARA | 2⚡ |
| `ANTI_SPELL_TRAP` | ANTIMAGIA | RARA | 1⚡ |
| `REFLECT_TRAP` | RICOCHETE | RARA | 1⚡ |
| `INTEL_REVEAL` | ESPIONAGEM | ÉPICA | 2⚡ |
| `HAND_RAID_II` | SAQUE II | ÉPICA | 3⚡ |
| `CARD_DRAFT_TIERED` | PROCRASTINAR II | ÉPICA | 3⚡ |
| `REBOBINAR` | REBOBINAR | ÉPICA | 3⚡ |

10 cartas novas, todas confirmadas (nenhuma condicional nesta rodada).

## Contagem final

19 mantidas/renomeadas/alteradas + 10 novas = **29 cartas** — 28 do PDF (3 comuns, 10 raras, 10
épicas, 3 lendárias, 2 Boom) mais TURNO_EXTRA, preservada por decisão de `CLAUDE.md` e mantida
nesta rodada após análise de custo (ver `docs/CARTAS.md`, entrada de TURNO_EXTRA). Por raridade:
3 comuns, 10 raras, 11 épicas, 3 lendárias, 2 Boom.

## Auditoria de consumidores dos ids renomeados

Cinco ids mudam nesta rodada: `DRAW_CARD`→`STUDY`, `DRAW_CARD_BIG`→`STUDY_II`,
`REVEAL_OLDEST`→`OBSOLESCENCE`, `SPY_CARD`→`SABOTAGE`, `CARD_TRADE`→`HAND_SWAP`. Grep em
`src/` (sem editar nada) encontrou estes consumidores:

**Consumidores funcionais — quebram se o id mudar sem atualização:**
- `src/engine/cards/definitions.ts` — a união `CardId` declara os 5 ids. Ponto de partida
  óbvio; o TypeScript recusa compilar até os outros dois arquivos abaixo também mudarem
  (`Record<CardId, CardDefinition>` exige exaustividade).
- `src/engine/cards/registry.ts` — cada `const X: CardDefinition = { id: '...', ... }` e a
  entrada correspondente em `CARD_REGISTRY`. 5 definições a renomear (variável interna, campo
  `id`, chave do registry).
- `src/engine/ai/cpu.ts` — a heurística de prioridade da IA busca cartas por id literal, uma
  linha por carta:
  - `find('EXTRA_TURN')` (linha 212)
  - `find('SPY_CARD')` (linha 236)
  - `find('REVEAL_OLDEST')` (linha 255)
  - `find('DRAW_CARD_BIG')` (linha 268)
  - `find('DRAW_CARD')` (linha 270)
  - `find('CARD_TRADE')` (linha 286)
  
  `EXTRA_TURN` não muda de id (vira `TURNO_EXTRA`, mas essa é uma renomeação também — 6 linhas
  no total a atualizar, não 5).

**Namespace PARALELO, não obrigatório mas recomendado renomear junto:**
- `src/engine/log.ts` (`LogCode`, linha ~55/69) e `src/i18n/logMessages.ts` (`case`, linhas
  ~117/131/176) usam `'CARD_EXTRA_TURN'` e `'CARD_TRADE'` como CÓDIGO DE LOG — um namespace
  desacoplado do `CardId` (o efeito de cada carta escolhe o próprio `LogCode` ao devolver
  `{ log: { code: '...' } }`, não precisa bater com o id da carta). Renomear o `CardId` não
  quebra nada aqui automaticamente, mas manter `CARD_TRADE` como nome de log de uma carta que
  agora se chama PERMUTA CAÓTICA/`HAND_SWAP` é a mesma confusão que motivou a Decisão desta
  rodada — vale renomear os dois `LogCode`s junto, mesmo não sendo estritamente necessário.

**Menções em comentário — cosméticas, não quebram nada:**
- `src/store/gameStore.ts:1027` — comentário `// --- 4. Turno extra (carta EXTRA_TURN/PULAR)`.
- `src/components/game/HandTracker.tsx:94` — comentário citando `CARD_TRADE` como exemplo.

**Não encontrado:** nenhum arquivo de teste no projeto (`README.md` já lista "Testes
automatizados" em "Ainda não existe") — não há suíte para atualizar ainda. `CLAUDE.md` (8),
adicionado nesta janela, passa a exigir teste na mesma entrega de toda carta nova ou alterada a
partir da Fase 1 — não retroativo às 19 atuais só por estarem sendo renomeadas aqui.
