/**
 * Retentativa genérica, com atraso configurável entre tentativas.
 *
 * Sem nada de Firebase/rede específico de propósito — usado hoje só pela
 * escrita de status em `joinRoom` (`multiplayerService.ts`), mas é uma
 * função pura, testável isoladamente com timers falsos. O outbox de
 * `syncBridge.ts` NÃO usa isto: ele tem semântica própria (nunca desiste
 * por padrão, exceto o teto de `MAX_OUTBOX_ENTRY_ATTEMPTS`, e precisa
 * reportar status pra UI a cada tentativa) — forçar essa forma genérica lá
 * exigiria mais parâmetros do que a simplicidade vale.
 */
export async function retryAsync<T>(
  fn: () => Promise<T>,
  options: { attempts: number; delaysMs: readonly number[] },
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt < options.attempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const isLastAttempt = attempt === options.attempts - 1;
      if (isLastAttempt) break;

      const delayMs = options.delaysMs[Math.min(attempt, options.delaysMs.length - 1)];
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  throw lastError;
}
