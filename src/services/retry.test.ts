import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { retryAsync } from './retry';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

/** Roda `promise` junto com o avanço dos timers falsos até ela resolver/rejeitar. */
async function flushWith<T>(promise: Promise<T>): Promise<T> {
  // `retryAsync` só chama `setTimeout` DEPOIS de uma falha (dentro do próprio
  // `await fn()`), então avançar antes de qualquer microtask rodar não
  // adiantaria nada — `vi.runAllTimersAsync()` intercala avanço de timer com
  // o loop de microtasks, exatamente o que uma `fn` assíncrona precisa.
  const timers = vi.runAllTimersAsync();
  const [result] = await Promise.all([promise.catch((e) => ({ __error: e })), timers]);
  if (result && typeof result === 'object' && '__error' in result) throw (result as { __error: unknown }).__error;
  return result as T;
}

describe('retryAsync', () => {
  it('sucesso na 1ª tentativa: nunca espera, devolve o valor', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const result = await retryAsync(fn, { attempts: 3, delaysMs: [100] });

    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('falha, depois sucede dentro do orçamento: tenta de novo e resolve', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('falha 1'))
      .mockResolvedValueOnce('ok na 2ª');

    const result = await flushWith(retryAsync(fn, { attempts: 3, delaysMs: [100] }));

    expect(result).toBe('ok na 2ª');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('esgota todas as tentativas: relança o ÚLTIMO erro, não o primeiro', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('falha 1'))
      .mockRejectedValueOnce(new Error('falha 2'))
      .mockRejectedValueOnce(new Error('falha 3 — a que deve ser relançada'));

    await expect(flushWith(retryAsync(fn, { attempts: 3, delaysMs: [10, 20] }))).rejects.toThrow(
      'falha 3 — a que deve ser relançada',
    );
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('usa o último delay da lista quando há mais tentativas que delays configurados', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('1'))
      .mockRejectedValueOnce(new Error('2'))
      .mockResolvedValueOnce('ok');

    // Só 1 delay configurado pra 3 tentativas — não deve lançar "undefined ms".
    const result = await flushWith(retryAsync(fn, { attempts: 3, delaysMs: [50] }));
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
  });
});
