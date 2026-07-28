/**
 * Permite o elemento host `<iframe>` no ramo `Platform.OS === 'web'` do
 * `ChaosTerminal`, sem incluir a lib `dom` inteira no tsconfig — isso
 * arriscaria colidir com globais que o React Native já declara (`fetch`,
 * `FormData`, `Blob`, etc.).
 *
 * Tipado como `any` de propósito: é uma via de escape só para este host
 * element, não vale a pena reconstruir os tipos de `HTMLIFrameElement` sem a
 * lib `dom` disponível.
 */
declare namespace JSX {
  interface IntrinsicElements {
    iframe: any;
  }
}
