import { getCard } from '@/engine/cards/registry';
import type { CardId } from '@/engine/cards/definitions';
import type { LogPayload, NoticeTone } from '@/engine/log';
import type { ChaosRule, Combatant, PendingAcknowledgement } from '@/engine/rules';

/**
 * A camada de idioma do jogo.
 *
 * **É o único lugar do projeto que sabe escrever "você".** O motor emite
 * fatos absolutos (`{ code: 'ROUND_WIN', subject: 'PLAYER' }`) e aqui eles
 * viram frases, à luz de quem está segurando o aparelho.
 *
 * Essa separação não é organização por gosto: enquanto o texto era montado no
 * `gameStore`, o pronome ficava congelado no momento em que o fato acontecia.
 * Numa sala online o convidado controla o `MACHINE`, e o terminal narrava a
 * partida dele invertida — "a cpu venceu" exatamente quando ele ganhava.
 * Traduzir na renderização é o que permite dois jogadores lerem o MESMO log e
 * cada um ver a própria história.
 */

/* -------------------------------------------------------------------------- */
/*                                 PERSPECTIVA                                 */
/* -------------------------------------------------------------------------- */

export interface LogPerspective {
  localCombatant: Combatant;
  remoteCombatant: Combatant;
  isOnline: boolean;
}

/** Como chamar um combatente, do ponto de vista de quem lê. */
function nameOf(
  combatant: Combatant | undefined,
  p: LogPerspective,
  form: 'subject' | 'possessive',
): string {
  if (combatant === undefined) return '';
  if (combatant === p.localCombatant) return form === 'possessive' ? 'sua' : 'você';
  // "o rival" no online, "a cpu" offline — a diferença importa: chamar um
  // humano de "cpu" no meio de uma partida contra outra pessoa é confuso.
  if (p.isOnline) return form === 'possessive' ? 'do rival' : 'o rival';
  return form === 'possessive' ? 'da cpu' : 'a cpu';
}

/** Versão em CAIXA ALTA, para os toasts. */
function shoutName(combatant: Combatant | undefined, p: LogPerspective): string {
  return nameOf(combatant, p, 'subject').toUpperCase();
}

/** `4` ➜ `"2x2"`. O jogador lê o tabuleiro em linha e coluna, não em índice. */
function cellLabel(value: LogPayload['value']): string {
  const index = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(index)) return '?';
  return `${Math.floor(index / 3) + 1}x${(index % 3) + 1}`;
}

function cardName(value: LogPayload['value']): string {
  if (typeof value !== 'string') return 'uma carta';
  try {
    return getCard(value as CardId).name;
  } catch {
    // Log de uma partida antiga com um id de carta que não existe mais: uma
    // linha de histórico não vale derrubar a tela de jogo.
    return 'uma carta';
  }
}

/* -------------------------------------------------------------------------- */
/*                             TEXTO DO TERMINAL                               */
/* -------------------------------------------------------------------------- */

const CHAOS_RULE_TEXT: Record<ChaosRule, string> = {
  NORMAL: 'SISTEMA ESTÁVEL :: o caos recuou, o tabuleiro voltou ao normal',
  RANDOM_FADE: 'CAOS: Símbolo Aleatório Instável :: qualquer peça sua pode sumir na sua jogada',
  BLOCKED_CELL: 'CAOS: Casa Interditada :: uma célula foi lacrada e não aceita jogadas',
};

/**
 * Converte um fato em linha do ChaosTerminal.
 *
 * O `switch` sem `default` é intencional: com `LogCode` sendo união fechada,
 * acrescentar um código novo e esquecer de traduzi-lo vira erro de compilação
 * em vez de uma linha vazia no terminal.
 */
export function formatLogEntry(entry: LogPayload, p: LogPerspective): string {
  const who = nameOf(entry.subject, p, 'subject');
  const whose = nameOf(entry.target, p, 'possessive');

  switch (entry.code) {
    case 'MOVE_PLACED':
      return `jogada :: ${who} posicionou em ${cellLabel(entry.value)}`;

    case 'ROUND_WIN':
      return `rodada :: ${who} venceu`;

    case 'TURN_PASSED':
      return `turno :: ${who} passou a vez sem colocar peça`;

    case 'CHAOS_RULE':
      return CHAOS_RULE_TEXT[entry.value as ChaosRule] ?? 'caos :: regra alterada';

    case 'CELL_UNLOCKED':
      return 'travar :: a casa lacrada foi liberada';

    /* O nome da armadilha só aparece para o DONO. Revelá-lo ao adversário
       destruiria a única coisa que faz a carta valer o custo — e é a
       apresentação, não o motor, que sabe quem está lendo. */
    case 'TRAP_ARMED':
      return entry.subject === p.localCombatant
        ? `armadilha :: você armou ${cardName(entry.value).toLowerCase()}`
        : `armadilha :: ${who} armou uma armadilha na mesa`;

    case 'TRAP_SHIELD':
      return `proteção :: o efeito contra ${who} foi anulado — ${cardName(entry.value)}`;
    case 'TRAP_BOMB':
      return `mina :: o centro detonou — 1 de dano e um turno extra para ${who}`;
    case 'TRAP_ANTI_SPELL':
      return `antimagia :: ${who} anulou ${cardName(entry.value).toLowerCase()} do oponente`;
    case 'TRAP_RICOCHET':
      return `ricochete :: ${who} inverteu ou anulou ${cardName(entry.value).toLowerCase()} ${whose === 'sua' ? 'de você' : whose}`;

    case 'CARD_BREAK_PIECE':
      return `demolir :: ${who} destruiu a peça em ${cellLabel(entry.value)}`;
    case 'CARD_TURNO_EXTRA':
      return `turno extra :: ${who} vai jogar de novo — o oponente perde a vez`;
    case 'CARD_HEAL':
      return `cura :: ${who} recuperou 1 hp`;
    case 'CARD_DAMAGE':
      return `ataque :: ${who} causou 1 de dano direto`;
    case 'CARD_DRAW':
      return `estudar :: ${who} comprou ${entry.value} cartas`;
    case 'CARD_RAID_STOLE':
      return `saque :: ${who} roubou ${cardName(entry.value)} ${whose === 'sua' ? 'de você' : whose}`;
    case 'CARD_RAID_FAILED':
      return `saque :: a tentativa de ${who} contra ${whose === 'sua' ? 'você' : whose} falhou`;
    case 'CARD_RAID_DESTROYED':
      return `saque :: a tentativa de ${who} contra ${whose === 'sua' ? 'você' : whose} falhou e destruiu ${cardName(entry.value)} ${whose === 'sua' ? 'de você' : whose}`;
    case 'CARD_CLEANSE':
      return `limpar :: ${who} liberou a casa ${cellLabel(entry.value)}`;
    case 'CARD_CLEANSE_ALL':
      return `purificar :: ${who} limpou todos os efeitos persistentes do tabuleiro`;
    case 'CARD_HAND_SWAP':
      return `permuta caótica :: ${who} trocou a mão inteira com o oponente`;
    case 'CARD_HIGHLIGHT_OLDEST':
      return `vidente :: ${who} destacou a peça mais antiga em ${cellLabel(entry.value)}`;
    case 'CARD_QUEUE_SHUFFLE':
      return `anomalia :: ${who} embaralhou a fila do infinito ${whose === 'sua' ? 'de você' : whose}`;
    case 'CARD_MARK_DOOMED':
      return `amaldiçoar :: ${who} marcou uma peça ${whose === 'sua' ? 'de você' : whose} como a próxima a sumir`;
    case 'CARD_REBOBINAR':
      return `rebobinar :: ${who} bloqueou a próxima colocação de peça ${whose}`;
    case 'CARD_LOCK_CELL':
      return `travar :: ${who} lacrou a casa ${cellLabel(entry.value)}`;
    case 'CARD_SPY_PEEK':
      return `espiada :: ${who} olhou a carta ${cardName(entry.value).toLowerCase()}`;
    case 'CARD_SPY_DISCARD':
      return `espionagem :: ${who} descobriu e descartou ${cardName(entry.value)} ${whose === 'sua' ? 'de você' : whose}`;
    case 'CARD_INTEL_HAND':
      return `visão absoluta :: ${who} leu uma mão inteira de ${entry.value} carta(s)`;
    case 'CARD_INTEL_REVEAL':
      return `espionagem :: ${who} revelou ${entry.value} carta(s) ${whose === 'sua' ? 'de você' : whose}, sem descartar`;
    case 'CARD_SINGLE_TRADE':
      return `trocar :: ${who} trocou uma carta com ${whose === 'sua' ? 'você' : whose} e recebeu ${cardName(entry.value)}`;
    // A carta escolhida só é nomeada pro próprio dono — pro outro lado seria
    // revelar o conteúdo da mão dele sem nenhuma carta de espionagem de
    // permeio (achado ao implementar o aviso de "carta recebida" — mesma
    // categoria de vazamento já corrigida em TRAP_ARMED/PRESSÁGIO).
    case 'CARD_DRAFT_PICK':
      return entry.subject === p.localCombatant
        ? `procrastinar :: ${who} escolheu ${cardName(entry.value)} entre as opções reveladas`
        : `procrastinar :: ${who} escolheu 1 carta entre as opções reveladas`;
    case 'CARD_CHAOS_ROULETTE':
      return `tic tac boom :: ${who} embaralhou as peças do tabuleiro`;
    case 'CARD_ALTAR_INVOKED':
      return `altar :: ${who} sacrificou a oferenda e invocou ${cardName(entry.value)}`;
    case 'CARD_SCRY_DECK':
      return `presságio :: ${who} espiou as próximas cartas do baralho`;
    case 'CARD_RENEW_PIECE':
      return `renovar :: ${who} renovou a peça em ${cellLabel(entry.value)} — agora é a mais nova`;
    case 'CARD_MULLIGAN':
      return `reciclar :: ${who} descartou 1 carta e comprou outra`;
    case 'CARD_SLIDE_PIECE':
      return `deslizar :: ${who} moveu uma peça para ${cellLabel(entry.value)}`;
    case 'CARD_TRIP_PIECE':
      return `tropeçar :: ${who} fez ${whose === 'sua' ? 'sua peça' : `a peça ${whose}`} tropeçar para ${cellLabel(entry.value)}`;
    case 'CARD_BACKUP_BATTERY':
      return `bateria reserva :: ${who} ativou um escudo contra o próximo dano`;
    case 'CARD_SHIELD_ABSORBED':
      return `bateria reserva :: o escudo ${whose === 'sua' ? 'de você' : whose} absorveu um golpe`;
    case 'CARD_TIME_CAPSULE':
      return `cápsula do tempo :: ${who} sobreviveu com 1 hp e comprou 2 cartas`;
    case 'CARD_TRIPWIRE':
      return `fio de arame :: a armadilha de ${who} drenou ${entry.value}⚡ ${whose === 'sua' ? 'de você' : whose}`;
    case 'CARD_BLACKOUT':
      return `apagão :: ${who} drenou toda a energia ${whose === 'sua' ? 'de você' : whose}`;
    case 'CARD_PARADOX':
      return `paradoxo :: ${who} copiou de graça ${cardName(entry.value).toLowerCase()} ${whose === 'sua' ? 'de você' : whose}`;
  }
}

/* -------------------------------------------------------------------------- */
/*                               TEXTO DO TOAST                                */
/* -------------------------------------------------------------------------- */

const CHAOS_RULE_SHOUT: Record<ChaosRule, string> = {
  NORMAL: 'SISTEMA ESTÁVEL',
  RANDOM_FADE: 'CAOS: SÍMBOLO INSTÁVEL',
  BLOCKED_CELL: 'CAOS: CASA INTERDITADA',
};

/**
 * Versão curta e gritada do mesmo fato, para o toast.
 *
 * Nem todo evento vira toast — só os que passam por `pushNotice`. Os demais
 * caem no genérico, que nunca chega a ser exibido.
 */
export function formatNotice(entry: LogPayload, p: LogPerspective): string {
  const who = shoutName(entry.subject, p);

  switch (entry.code) {
    case 'CHAOS_RULE':
      return CHAOS_RULE_SHOUT[entry.value as ChaosRule] ?? 'CAOS';
    case 'CARD_RAID_STOLE':
      return `${who} ROUBOU: ${cardName(entry.value)}`;
    case 'CARD_HAND_SWAP':
      return `${who} TROCOU DE MÃO COM O OPONENTE`;
    case 'CARD_CLEANSE':
      return `CASA ${cellLabel(entry.value)} LIBERADA`;
    case 'CARD_CLEANSE_ALL':
      return 'TABULEIRO PURIFICADO';
    case 'CARD_MARK_DOOMED':
      return 'UMA PEÇA FOI AMALDIÇOADA';
    case 'CARD_LOCK_CELL':
      return `CASA ${cellLabel(entry.value)} LACRADA`;
    case 'CARD_SPY_PEEK':
      return `${who} ESPIOU: ${cardName(entry.value)}`;
    case 'CARD_SPY_DISCARD':
      return `${who} DESCARTOU: ${cardName(entry.value)}`;
    case 'CARD_INTEL_HAND':
      return `${who} LEU A MÃO INTEIRA`;
    case 'CARD_INTEL_REVEAL':
      return `${who} REVELOU ${entry.value} CARTA(S)`;
    case 'CARD_RAID_DESTROYED':
      return `${who} DESTRUIU: ${cardName(entry.value)}`;
    case 'CARD_SINGLE_TRADE':
      return `${who} RECEBEU: ${cardName(entry.value)}`;
    case 'CARD_DRAFT_PICK':
      return entry.subject === p.localCombatant
        ? `${who} ESCOLHEU: ${cardName(entry.value)}`
        : `${who} ESCOLHEU 1 CARTA`;
    case 'CARD_SHIELD_ABSORBED':
      return 'ESCUDO ABSORVEU O GOLPE';
    case 'CARD_TIME_CAPSULE':
      return 'CÁPSULA DO TEMPO ATIVOU — SOBREVIVEU COM 1 HP';
    case 'CARD_BLACKOUT':
      return `${who} DRENOU TODA A ENERGIA`;
    case 'CARD_TRIPWIRE':
      return `${who} DRENOU ${entry.value}⚡ COM FIO DE ARAME`;
    case 'CARD_PARADOX':
      return `${who} COPIOU: ${cardName(entry.value)}`;
    case 'CARD_TRIP_PIECE':
      return `${who} FEZ UMA PEÇA TROPEÇAR`;
    default:
      return formatLogEntry(entry, p).toUpperCase();
  }
}

/* -------------------------------------------------------------------------- */
/*                       TEXTO DO AVISO DE CARTA RECEBIDA                      */
/* -------------------------------------------------------------------------- */

/**
 * Texto do aviso não-bloqueante "VOCÊ RECEBEU: ..." (`lastCardsDrawnFor`,
 * `gameStore.ts`). Não passa pelo `formatNotice`/`LogPayload` porque o fato
 * carrega uma LISTA de cartas (um lote pode ter mais de uma), e `LogPayload.
 * value` só guarda `string | number` — uma carta só, não um lote.
 *
 * Nomeia as cartas só pro próprio dono; o outro lado (online ou CPU, a mão
 * alheia é sempre secreta) só vê a contagem — mesmo princípio de privacidade
 * já usado em TRAP_ARMED/CARD_SCRY_DECK/CARD_DRAFT_PICK.
 */
export function formatCardsReceivedNotice(
  subject: Combatant,
  cardIds: readonly CardId[],
  p: LogPerspective,
): string {
  if (subject === p.localCombatant) {
    const names = cardIds.map((id) => cardName(id)).join(', ');
    return `VOCÊ RECEBEU: ${names}`;
  }
  const who = shoutName(subject, p);
  return `${who} RECEBEU ${cardIds.length} CARTA(S)`;
}

/* -------------------------------------------------------------------------- */
/*                                    COR                                      */
/* -------------------------------------------------------------------------- */

/**
 * Tom do toast quando a carta não fixou um.
 *
 * Deriva da perspectiva de propósito: roubar é bom para quem rouba e ruim
 * para quem perde a carta, e o MESMO evento chega aos dois clientes. Fixar o
 * tom na origem pintaria de verde o prejuízo de um dos dois.
 */
export function resolveNoticeTone(
  entry: LogPayload,
  p: LogPerspective,
  explicit?: NoticeTone,
): NoticeTone {
  if (explicit) return explicit;
  if (entry.subject === undefined) return 'NEUTRAL';
  return entry.subject === p.localCombatant ? 'GOOD' : 'BAD';
}

/* -------------------------------------------------------------------------- */
/*                        TEXTO DO MODAL DE CONFIRMAÇÃO                        */
/* -------------------------------------------------------------------------- */

/**
 * Intenção visual do modal. Só cor e selo — nenhuma regra depende disto, e por
 * isso o tipo mora AQUI e não no domínio: o motor não escolhe cores.
 *
 * `OPPONENT` (antes `CPU`) existe para o anúncio de jogada do adversário não
 * usar o mesmo vermelho de "você caiu numa armadilha": são eventos de gravidade
 * bem diferente. O nome deixou de citar a CPU porque, no online, o adversário
 * é gente.
 */
export type AcknowledgementTone = 'DANGER' | 'OPPONENT' | 'INTEL';

export interface AcknowledgementText {
  subtitle: string;
  title: string;
  description: string;
  tone: AcknowledgementTone;
}

function cardOf(cardId: PendingAcknowledgement['cardId']) {
  if (cardId === undefined) return null;
  try {
    return getCard(cardId);
  } catch {
    return null;
  }
}

/** "VOCÊ JOGOU" / "O OPONENTE JOGOU" / "A CPU JOGOU". */
function playedByLabel(subject: Combatant, p: LogPerspective): string {
  if (subject === p.localCombatant) return 'VOCÊ JOGOU';
  return p.isOnline ? 'O OPONENTE JOGOU' : 'A CPU JOGOU';
}

/**
 * Descritor semântico ➜ as três linhas do `AcknowledgementModal`.
 *
 * Mesmo contrato do `formatLogEntry`: `switch` sem `default`, para que um
 * `AcknowledgementCode` novo sem tradução seja erro de compilação em vez de um
 * modal em branco travando a partida.
 */
export function formatAcknowledgement(
  ack: PendingAcknowledgement,
  p: LogPerspective,
): AcknowledgementText {
  const card = cardOf(ack.cardId);
  const isMine = ack.subject === p.localCombatant;

  switch (ack.code) {
    case 'TRAP_TRIGGERED':
      return {
        subtitle: isMine
          ? 'SUA ARMADILHA'
          : `ARMADILHA ${nameOf(ack.subject, p, 'possessive').toUpperCase()}`,
        title: card?.name ?? 'ARMADILHA',
        description: card?.description ?? 'Uma armadilha disparou.',
        tone: 'DANGER',
      };

    /* O dono vê o nome da própria carta; o adversário vê que existe uma ameaça
       nova na mesa — que é o mesmo que ele já enxerga na zona de armadilhas — e
       não qual é. O segredo é decidido aqui, na leitura, e não na escrita: um
       descritor único e correto serve os dois lados. */
    case 'TRAP_ARMED':
      return isMine
        ? {
            subtitle: 'VOCÊ JOGOU',
            title: card?.name ?? 'ARMADILHA',
            description: card?.description ?? 'Sua armadilha está na mesa.',
            tone: 'OPPONENT',
          }
        : {
            subtitle: playedByLabel(ack.subject, p),
            title: 'ARMADILHA',
            description: `${nameOf(ack.subject, p, 'subject')} virou uma carta na mesa. Você não sabe qual é — ainda.`,
            tone: 'OPPONENT',
          };

    case 'CARD_PLAYED':
      return {
        subtitle: playedByLabel(ack.subject, p),
        title: card?.name ?? 'CARTA',
        description: card?.description ?? '',
        tone: 'OPPONENT',
      };

    case 'HAND_REVEALED': {
      // Multiplayer online: quem NÃO é o `subject` não pode ver o conteúdo
      // revelado (é informação privada de quem jogou a carta) — só um texto
      // genérico dizendo que há algo em andamento. Fora do online (CPU/hot-
      // seat) `isOnline` já é `false`, então este ramo nunca dispara lá — 0
      // mudança de comportamento pros modos existentes.
      const isMine = ack.subject === p.localCombatant;

      // `INFO` (SAQUE, ramo de roubo): a carta já foi escolhida (não é RNG) —
      // o modal só confirma QUAL era, pro autor da escolha. O alvo já sabia o
      // próprio prejuízo (é a própria mão dele), não tem nada pra "descobrir".
      if (ack.kind === 'INFO') {
        if (p.isOnline && !isMine) {
          return {
            subtitle: 'SAQUE',
            title: 'UMA CARTA SUA FOI ROUBADA',
            description: `Aguarde a confirmação — ${nameOf(ack.subject, p, 'subject')} já sabe qual era.`,
            tone: 'INTEL',
          };
        }
        return {
          subtitle: 'SAQUE',
          title: card?.name ?? 'CARTA DESCOBERTA',
          description: card?.description ?? 'Você descobriu e roubou uma carta do oponente.',
          tone: 'INTEL',
        };
      }

      // `INTEL_FLIP` (VISÃO ABSOLUTA): só o caster vê a grade da mão revelada
      // — o alvo já conhece a própria mão, não precisa de nada novo aqui.
      if (ack.kind === 'INTEL_FLIP' && p.isOnline && !isMine) {
        return {
          subtitle: 'VISÃO ABSOLUTA',
          title: 'SUA MÃO FOI REVELADA',
          description: `Aguarde a confirmação — ${nameOf(ack.subject, p, 'subject')} está vendo todas as suas cartas.`,
          tone: 'INTEL',
        };
      }

      // O dono da mão é o `target`; "SUA MÃO" acontece quando é você que foi
      // espionado — e é justamente aí que o pronome invertido doía mais.
      const title =
        ack.target === p.localCombatant
          ? 'SUA MÃO'
          : `MÃO ${nameOf(ack.target, p, 'possessive').toUpperCase()}`;

      return {
        subtitle: ack.kind === 'SPY_PICK' ? 'ESPIONAGEM' : 'VISÃO ABSOLUTA',
        title,
        description:
          ack.kind === 'SPY_PICK'
            ? 'Escolha UMA carta e toque para virar.'
            : `${ack.revealedCards.length} carta(s). Toque para virar e desvirar.`,
        tone: 'INTEL',
      };
    }

    case 'CARD_SCRY_DECK': {
      const isMine = ack.subject === p.localCombatant;
      if (p.isOnline && !isMine) {
        return {
          subtitle: 'PRESSÁGIO',
          title: 'CONSULTANDO O BARALHO',
          description: `Aguarde a confirmação — ${nameOf(ack.subject, p, 'subject')} está vendo as próximas cartas.`,
          tone: 'INTEL',
        };
      }
      return {
        subtitle: 'PRESSÁGIO',
        title: 'PRÓXIMAS CARTAS DO BARALHO',
        description: `As próximas ${ack.revealedCards.length} cartas a sair da fila compartilhada, na ordem — não é garantia de que serão suas.`,
        tone: 'INTEL',
      };
    }
  }
}
