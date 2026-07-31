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
      return `proteção :: o saque contra ${who} foi anulado`;
    case 'TRAP_COUNTER':
      return `anti-magia :: a ação contra ${who} foi anulada`;
    case 'TRAP_MIND_SHIELD':
      return `mente blindada :: a espionagem contra ${who} foi anulada`;
    case 'TRAP_BOMB':
      return `mina :: o centro detonou — 2 de dano e um turno extra para ${who}`;

    case 'CARD_BREAK_PIECE':
      return `demolir :: ${who} destruiu a peça em ${cellLabel(entry.value)}`;
    case 'CARD_EXTRA_TURN':
      return `rebobinar :: ${who} armou um turno extra`;
    case 'CARD_HEAL':
      return `curar :: ${who} recuperou 1 hp`;
    case 'CARD_DAMAGE':
      return `ataque :: ${who} causou 1 de dano direto`;
    case 'CARD_DRAW':
      return `estudar :: ${who} comprou ${entry.value} cartas`;
    case 'CARD_RAID_STOLE':
      return `saque :: ${who} roubou ${cardName(entry.value)} ${whose === 'sua' ? 'de você' : whose}`;
    case 'CARD_RAID_DESTROYED':
      return `saque :: ${who} destruiu ${cardName(entry.value)} ${whose === 'sua' ? 'de você' : whose}`;
    case 'CARD_CLEANSE':
      return `purificar :: ${who} liberou a casa interditada`;
    case 'CARD_SWAP':
      return `troca :: ${who} trocou de mão com o oponente`;
    case 'CARD_REVEAL_DOOMED':
      return `vidente :: a peça condenada em ${cellLabel(entry.value)} foi revelada`;
    case 'CARD_LOCK_CELL':
      return `travar :: ${who} lacrou a casa ${cellLabel(entry.value)}`;
    case 'CARD_SPY_PEEK':
      return `espionagem :: ${who} olhou a carta ${cardName(entry.value).toLowerCase()}`;
    case 'CARD_SPY_HAND':
      return `espionagem :: ${who} espiou uma mão de ${entry.value} carta(s)`;
    case 'CARD_INTEL_HAND':
      return `visão absoluta :: ${who} leu uma mão inteira de ${entry.value} carta(s)`;
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
    case 'CARD_RAID_DESTROYED':
      return `${who} DESTRUIU: ${cardName(entry.value)}`;
    case 'CARD_SWAP':
      return `${who} TROCOU AS MÃOS`;
    case 'CARD_CLEANSE':
      return 'CASA LIBERADA';
    case 'CARD_REVEAL_DOOMED':
      return 'PEÇA CONDENADA REVELADA';
    case 'CARD_LOCK_CELL':
      return `CASA ${cellLabel(entry.value)} LACRADA`;
    case 'CARD_SPY_PEEK':
      return `${who} ESPIONOU: ${cardName(entry.value)}`;
    case 'CARD_INTEL_HAND':
      return `${who} LEU A MÃO INTEIRA`;
    default:
      return formatLogEntry(entry, p).toUpperCase();
  }
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
  }
}
