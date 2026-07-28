import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { Platform, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

import {
  LOG_LIMIT,
  selectActiveRule,
  selectRuleTurnsLeft,
  selectTerminalLog,
  useGameStore,
  type ChaosRule,
} from '@/store/gameStore';

/* -------------------------------------------------------------------------- */
/*                          PROTOCOLO DA PONTE (typed)                         */
/* -------------------------------------------------------------------------- */
/* Contrato explícito entre nativo/web e a página CRT. Qualquer mensagem fora
   destes tipos é descartada — o canal aceita string arbitrária, então validar
   aqui é obrigatório e não paranoia.                                          */

/** Nativo/Web (host) ➜ página CRT */
type OutboundMessage =
  | { type: 'SET_RULE'; rule: ChaosRule; label: string }
  /** Atualiza só o contador de turnos, sem disparar o glitch visual do nome
      da regra — senão CADA jogada glitcharia a tela, não só as que mudam a
      regra de fato. */
  | { type: 'SET_COUNTDOWN'; turnsLeft: number | null }
  /** Acrescenta linhas ao log. Em lote para evitar N injeções seguidas. */
  | { type: 'PRINT'; lines: string[] }
  /** Limpa o log — usado ao reimprimir o histórico depois de um reload. */
  | { type: 'CLEAR' };

/** Página CRT ➜ Nativo/Web (host) */
type InboundMessage = { type: 'READY' };

/** Texto exibido no terminal para cada regra caótica. */
const RULE_LABEL: Record<ChaosRule, string> = {
  NORMAL: 'SYSTEM NOMINAL',
  RANDOM_FADE: 'RANDOM FADE',
  BLOCKED_CELL: 'CELL LOCKDOWN',
};

/* -------------------------------------------------------------------------- */
/*                              PÁGINA CRT (local)                             */
/* -------------------------------------------------------------------------- */
/* HTML/CSS/JS 100% offline e estático — nenhuma requisição de rede sai daqui.
   O MESMO documento roda dentro de um <WebView> nativo OU de um <iframe> web
   sem nenhuma alteração: `send()` detecta o ambiente e escolhe o canal certo,
   e o listener de entrada já aceitava `window.addEventListener('message')`
   desde a fase da WebView (era o fallback do `ref.postMessage()` no Android),
   que é exatamente como um `iframe.contentWindow.postMessage(...)` chega.    */

const CRT_HTML = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }

  html, body {
    height: 100%;
    background: #000;
    overflow: hidden;
    font-family: ui-monospace, "Courier New", monospace;
    -webkit-user-select: none;
    user-select: none;
    -webkit-tap-highlight-color: transparent;
  }

  /* Moldura do monitor -------------------------------------------------- */
  .crt {
    position: relative;
    height: 100%;
    width: 100%;
    background: radial-gradient(ellipse at center, #06170b 0%, #010402 100%);
    overflow: hidden;
    animation: flicker 4s infinite steps(1);
  }

  .screen {
    position: relative;
    z-index: 1;
    height: 100%;
    display: flex;
    flex-direction: column;
    justify-content: center;
    padding: 8px 14px;
    color: #39ff7a;
    text-shadow: 0 0 4px rgba(57, 255, 122, 0.85), 0 0 12px rgba(57, 255, 122, 0.35);
  }

  .label {
    font-size: 9px;
    letter-spacing: 3px;
    opacity: 0.55;
    text-transform: uppercase;
  }

  /* Cabeçalho: rótulo + regra ativa + contador --------------------------- */
  .header {
    display: flex;
    align-items: baseline;
    gap: 8px;
    flex: 0 0 auto;
    padding-bottom: 3px;
    border-bottom: 1px solid rgba(57, 255, 122, 0.22);
  }

  .rule {
    position: relative;
    font-size: 13px;
    font-weight: 700;
    letter-spacing: 2px;
    text-transform: uppercase;
    white-space: nowrap;
  }

  .countdown {
    margin-left: auto;
    font-size: 9px;
    opacity: 0.6;
    white-space: nowrap;
  }

  /* Log de combate -------------------------------------------------------- */
  .log {
    flex: 1 1 auto;
    min-height: 0;              /* deixa o flex encolher e o scroll valer */
    overflow-y: auto;
    padding-top: 4px;
    font-size: 9px;
    line-height: 12px;
    letter-spacing: 0.5px;
    scrollbar-width: none;
  }

  .log::-webkit-scrollbar { display: none; }

  .log .entry {
    opacity: 0.8;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* Cursor piscando só na última linha ----------------------------------- */
  .log .entry:last-child {
    opacity: 1;
  }

  .log .entry:last-child::after {
    content: "";
    display: inline-block;
    width: 5px;
    height: 8px;
    margin-left: 3px;
    background: #39ff7a;
    vertical-align: -1px;
    animation: blink 1s steps(2) infinite;
  }

  /* Scanlines + máscara de fósforo --------------------------------------- */
  .scanlines {
    position: absolute;
    inset: 0;
    z-index: 2;
    pointer-events: none;
    background: repeating-linear-gradient(
      to bottom,
      rgba(0, 0, 0, 0) 0px,
      rgba(0, 0, 0, 0) 2px,
      rgba(0, 0, 0, 0.38) 3px,
      rgba(0, 0, 0, 0.38) 4px
    );
  }

  /* Varredura horizontal descendo lentamente ----------------------------- */
  .sweep {
    position: absolute;
    left: 0;
    right: 0;
    height: 40px;
    z-index: 3;
    pointer-events: none;
    background: linear-gradient(to bottom, rgba(57, 255, 122, 0) 0%, rgba(57, 255, 122, 0.07) 50%, rgba(57, 255, 122, 0) 100%);
    animation: sweep 7s linear infinite;
  }

  /* Vinheta / curvatura do tubo ------------------------------------------ */
  .vignette {
    position: absolute;
    inset: 0;
    z-index: 4;
    pointer-events: none;
    box-shadow: inset 0 0 22px 6px rgba(0, 0, 0, 0.9);
    border-radius: 10px;
  }

  /* Glitch: separação RGB + recorte horizontal --------------------------- */
  .rule.glitch { animation: jitter 0.18s steps(2) infinite; }

  .rule.glitch::before,
  .rule.glitch::after {
    content: attr(data-text);
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    overflow: hidden;
  }

  .rule.glitch::before {
    color: #ff2e63;
    text-shadow: 2px 0 rgba(255, 46, 99, 0.9);
    animation: slice-a 0.35s steps(3) infinite;
  }

  .rule.glitch::after {
    color: #21e6ff;
    text-shadow: -2px 0 rgba(33, 230, 255, 0.9);
    animation: slice-b 0.29s steps(3) infinite;
  }

  body.shake .crt { animation: shake 0.12s steps(2) infinite; }

  @keyframes blink { 0%, 100% { opacity: 1; } 50% { opacity: 0; } }

  @keyframes flicker {
    0%, 92%, 100% { opacity: 1; }
    93% { opacity: 0.82; }
    95% { opacity: 1; }
    97% { opacity: 0.9; }
  }

  @keyframes sweep {
    0%   { transform: translateY(-40px); }
    100% { transform: translateY(160px); }
  }

  @keyframes jitter {
    0%   { transform: translate(0, 0); }
    50%  { transform: translate(-1px, 1px); }
    100% { transform: translate(1px, -1px); }
  }

  @keyframes shake {
    0%   { transform: translate(0, 0); }
    50%  { transform: translate(2px, -1px); }
    100% { transform: translate(-2px, 1px); }
  }

  @keyframes slice-a {
    0%   { clip-path: inset(10% 0 72% 0); transform: translateX(-4px); }
    50%  { clip-path: inset(48% 0 28% 0); transform: translateX(5px); }
    100% { clip-path: inset(80% 0 4% 0);  transform: translateX(-3px); }
  }

  @keyframes slice-b {
    0%   { clip-path: inset(62% 0 18% 0); transform: translateX(4px); }
    50%  { clip-path: inset(22% 0 60% 0); transform: translateX(-5px); }
    100% { clip-path: inset(4% 0 86% 0);  transform: translateX(3px); }
  }
</style>
</head>
<body>
  <div class="crt">
    <div class="screen">
      <div class="header">
        <span class="label">// chaos</span>
        <span class="rule" id="rule" data-text="BOOTING">BOOTING</span>
        <span class="countdown" id="countdown"></span>
      </div>
      <div class="log" id="log"></div>
    </div>
    <div class="sweep"></div>
    <div class="scanlines"></div>
    <div class="vignette"></div>
  </div>

<script>
(function () {
  'use strict';

  var RN = window.ReactNativeWebView;
  var ruleEl = document.getElementById('rule');
  var countdownEl = document.getElementById('countdown');
  var logEl = document.getElementById('log');
  var glitchTimeout = null;

  /** Teto de nós no DOM. O buffer real vive no store; aqui é só o visível. */
  var MAX_NODES = 80;

  // Host ⟵ página. Dois transportes possíveis:
  // - WebView nativo injeta window.ReactNativeWebView.postMessage;
  // - iframe web não tem isso — cai para o postMessage padrão do DOM,
  //   endereçado à janela pai (o host que montou o iframe).
  // Mesmo HTML, dois ambientes, sem nenhum branch de plataforma aqui dentro.
  function send(payload) {
    var json = JSON.stringify(payload);
    if (RN && RN.postMessage) {
      RN.postMessage(json);
      return;
    }
    if (window.parent && window.parent !== window) {
      window.parent.postMessage(json, '*');
    }
  }

  function glitch(duration) {
    ruleEl.classList.add('glitch');
    document.body.classList.add('shake');
    clearTimeout(glitchTimeout);
    glitchTimeout = setTimeout(function () {
      ruleEl.classList.remove('glitch');
      document.body.classList.remove('shake');
    }, duration);
  }

  function setRule(rule, label) {
    ruleEl.textContent = label;
    ruleEl.setAttribute('data-text', label);
    glitch(900);
    // A linha de log da troca de regra vem do store (pushLog), não daqui —
    // uma única fonte de verdade para o histórico.
  }

  function setCountdown(turnsLeft) {
    countdownEl.textContent = turnsLeft === null ? '' : turnsLeft + 't';
  }

  function print(lines) {
    if (!lines || lines.length === 0) return;

    for (var i = 0; i < lines.length; i++) {
      var entry = document.createElement('div');
      entry.className = 'entry';
      entry.textContent = '> ' + lines[i];
      logEl.appendChild(entry);
    }

    while (logEl.childNodes.length > MAX_NODES) {
      logEl.removeChild(logEl.firstChild);
    }

    // Auto-scroll para o fim. scrollHeight já reflete os nós recém-inseridos
    // porque appendChild força reflow síncrono.
    logEl.scrollTop = logEl.scrollHeight;
  }

  // API global chamada pelo React Native via injectJavaScript (nativo) ou
  // pelo listener de message abaixo (web). Mantida em window para
  // sobreviver a qualquer escopo de injeção.
  window.__CHAOS__ = {
    handle: function (raw) {
      var msg;
      try {
        msg = typeof raw === 'string' ? JSON.parse(raw) : raw;
      } catch (e) {
        return;
      }
      if (!msg || typeof msg.type !== 'string') return;

      if (msg.type === 'SET_RULE') {
        setRule(msg.rule, msg.label);
      } else if (msg.type === 'SET_COUNTDOWN') {
        setCountdown(msg.turnsLeft);
      } else if (msg.type === 'PRINT') {
        print(msg.lines);
      } else if (msg.type === 'CLEAR') {
        logEl.innerHTML = '';
      }
    }
  };

  // No WebView nativo, ref.postMessage() entrega em document no Android e
  // em window no iOS — por isso os dois listeners. No iframe web, é o MESMO
  // listener de window que recebe o contentWindow.postMessage(...) feito
  // pelo host — nenhum código extra necessário para o caso web.
  function onNativeMessage(event) { window.__CHAOS__.handle(event.data); }
  document.addEventListener('message', onNativeMessage);
  window.addEventListener('message', onNativeMessage);

  print(['uplink estabelecido']);

  // Handshake: o host responde com SET_RULE, SET_COUNTDOWN e o histórico do log.
  send({ type: 'READY' });
})();
</script>
</body>
</html>`;

/**
 * Constante de módulo, NÃO objeto inline.
 * Um `source={{ html }}` criado a cada render muda de identidade e faz o
 * WebView recarregar a página inteira no Android — matando o handshake.
 */
const CRT_SOURCE = { html: CRT_HTML, baseUrl: '' } as const;

/* -------------------------------------------------------------------------- */
/*                                 COMPONENTE                                  */
/* -------------------------------------------------------------------------- */

export interface ChaosTerminalProps {
  /** Altura fixa do monitor em dp. */
  height?: number;
  style?: StyleProp<ViewStyle>;
  /** Vibra o device quando a regra caótica muda de verdade. */
  hapticsEnabled?: boolean;
}

/**
 * Monitor CRT retro com log de combate, ponte bidirecional e renderização
 * híbrida:
 *
 * - **Nativo (iOS/Android):** roda dentro de `<WebView>`, mensagens de entrada
 *   via `injectJavaScript`, saída via `onMessage`.
 * - **Web:** roda dentro de um `<iframe srcDoc>` — o mesmo HTML, sem alteração
 *   — usando `contentWindow.postMessage` para entrada e `window.addEventListener
 *   ('message')` para saída. É o que permite o jogo rodar no Vercel/Snack.
 *
 * A regra caótica agora muda por **turno global**, não por tempo real: o
 * gameStore chama `applyChaosRule` de dentro de `placeMark` quando
 * `ruleExpiresAtTurn` é alcançado. O terminal só EXIBE a mudança — não decide
 * mais quando ela acontece. (Antes, um timer de 5–9s de relógio real deixava
 * o jogador simplesmente esperar uma regra ruim passar sem jogar.)
 *
 * Decorativo: não captura toques, para não roubar gestos do tabuleiro.
 */
export function ChaosTerminal({ height = 120, style, hapticsEnabled = true }: ChaosTerminalProps) {
  const isWeb = Platform.OS === 'web';

  const webViewRef = useRef<WebView>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  const activeRule = useGameStore(selectActiveRule);
  const turnsLeft = useGameStore(selectRuleTurnsLeft);
  const terminalLog = useGameStore(selectTerminalLog);

  /** Maior `id` já impresso. `-1` = nada impresso ainda (ou página recarregou). */
  const lastPrintedIdRef = useRef(-1);

  /**
   * A página só existe depois do `READY`. Postar antes é descartado (o
   * listener nem existe ainda), então enfileiramos e damos flush no handshake.
   */
  const isReadyRef = useRef(false);
  const pendingRef = useRef<OutboundMessage[]>([]);

  /** Host ➜ página. Só a "fiação" muda entre WebView e iframe. */
  const post = useCallback(
    (message: OutboundMessage) => {
      if (!isReadyRef.current) {
        pendingRef.current.push(message);
        return;
      }

      if (isWeb) {
        iframeRef.current?.contentWindow?.postMessage(JSON.stringify(message), '*');
        return;
      }

      // JSON.stringify duplo: o interno vira o payload, o externo escapa o
      // payload como literal de string JS válido dentro do script injetado.
      const literal = JSON.stringify(JSON.stringify(message));
      webViewRef.current?.injectJavaScript(
        `window.__CHAOS__ && window.__CHAOS__.handle(${literal}); true;`,
      );
    },
    [isWeb],
  );

  /** Processa uma mensagem vinda da página (READY, por enquanto só isso). */
  const handleReady = useCallback(() => {
    isReadyRef.current = true;
    const queued = pendingRef.current;
    pendingRef.current = [];
    queued.forEach(post);

    // A página nasceu vazia (primeiro load ou crash do renderer): reimprime
    // o histórico que o store guardou.
    lastPrintedIdRef.current = -1;
    const history = useGameStore.getState().terminalLog;
    if (history.length > 0) {
      lastPrintedIdRef.current = history[history.length - 1].id;
      post({ type: 'PRINT', lines: history.map((line) => line.text) });
    }
  }, [post]);

  // Nativo/Web ➜ Página: espelha a regra caótica atual no monitor.
  useEffect(() => {
    post({ type: 'SET_RULE', rule: activeRule, label: RULE_LABEL[activeRule] });
  }, [activeRule, post]);

  // Nativo/Web ➜ Página: contador de turnos — SEM disparar o glitch visual.
  useEffect(() => {
    post({ type: 'SET_COUNTDOWN', turnsLeft });
  }, [turnsLeft, post]);

  /**
   * Haptic na mudança REAL de regra. Ignora o primeiro render (senão vibra
   * assim que a tela abre, o que não é uma mudança de verdade).
   */
  const isFirstRuleRenderRef = useRef(true);
  useEffect(() => {
    if (isFirstRuleRenderRef.current) {
      isFirstRuleRenderRef.current = false;
      return;
    }
    if (hapticsEnabled) void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Rigid);
  }, [activeRule, hapticsEnabled]);

  /* --- Nativo/Web ➜ Página: log de combate ---------------------------------
     Sincronização incremental por `id`. Imprimir o array inteiro a cada
     mudança duplicaria tudo; comparar por conteúdo falharia com mensagens
     repetidas legítimas ("demolir :: célula 4" duas vezes).

     Um `startMatch` zera o log e reinicia os ids em 0. Detectamos isso pelo
     id da primeira linha ser menor do que o último impresso e mandamos CLEAR
     antes de reimprimir.                                                     */
  useEffect(() => {
    if (terminalLog.length === 0) {
      if (lastPrintedIdRef.current !== -1) {
        lastPrintedIdRef.current = -1;
        post({ type: 'CLEAR' });
      }
      return;
    }

    if (terminalLog[0].id < lastPrintedIdRef.current - LOG_LIMIT) {
      lastPrintedIdRef.current = -1;
      post({ type: 'CLEAR' });
    }

    const fresh = terminalLog.filter((line) => line.id > lastPrintedIdRef.current);
    if (fresh.length === 0) return;

    lastPrintedIdRef.current = fresh[fresh.length - 1].id;
    post({ type: 'PRINT', lines: fresh.map((line) => line.text) });
  }, [terminalLog, post]);

  /* --- Transporte nativo: WebView ------------------------------------------ */

  const handleWebViewMessage = useCallback(
    (event: WebViewMessageEvent) => {
      let message: InboundMessage;
      try {
        message = JSON.parse(event.nativeEvent.data) as InboundMessage;
      } catch {
        return; // payload malformado — descarta
      }
      if (message?.type === 'READY') handleReady();
    },
    [handleReady],
  );

  /** Se a página recarregar (crash do renderer), o handshake precisa refazer. */
  const handleWebViewLoadStart = useCallback(() => {
    isReadyRef.current = false;
  }, []);

  /* --- Transporte web: iframe ----------------------------------------------
     `window.addEventListener('message')` no host inteiro, filtrado por
     `event.source` — sem o filtro, qualquer outro postMessage na página
     (outra extensão, outro iframe) seria processado por engano.             */
  useEffect(() => {
    if (!isWeb) return;

    function handleWindowMessage(event: MessageEvent) {
      if (event.source !== iframeRef.current?.contentWindow) return;

      let message: InboundMessage;
      try {
        message = JSON.parse(event.data as string) as InboundMessage;
      } catch {
        return;
      }
      if (message?.type === 'READY') handleReady();
    }

    window.addEventListener('message', handleWindowMessage);
    return () => window.removeEventListener('message', handleWindowMessage);
  }, [isWeb, handleReady]);

  const handleIframeLoad = useCallback(() => {
    isReadyRef.current = false;
  }, []);

  const containerStyle = useMemo(() => [styles.container, { height }, style], [height, style]);

  if (isWeb) {
    return (
      <View style={containerStyle} pointerEvents="none">
        <iframe
          ref={iframeRef}
          srcDoc={CRT_HTML}
          onLoad={handleIframeLoad}
          title="chaos-terminal"
          sandbox="allow-scripts"
          style={{ width: '100%', height: '100%', border: 'none', backgroundColor: '#000' }}
        />
      </View>
    );
  }

  return (
    <View style={containerStyle} pointerEvents="none">
      <WebView
        ref={webViewRef}
        source={CRT_SOURCE}
        originWhitelist={['*']}
        onMessage={handleWebViewMessage}
        onLoadStart={handleWebViewLoadStart}
        // Conteúdo é estático e local: nenhuma navegação externa é permitida.
        onShouldStartLoadWithRequest={(request) =>
          request.url === 'about:blank' || request.url.startsWith('data:')
        }
        style={styles.webview}
        containerStyle={styles.webviewContainer}
        // --- Performance / aparência ---
        androidLayerType="hardware"
        scrollEnabled={false}
        overScrollMode="never"
        bounces={false}
        showsVerticalScrollIndicator={false}
        showsHorizontalScrollIndicator={false}
        // --- Superfície mínima: nada aqui precisa de rede, storage ou popups ---
        javaScriptEnabled
        domStorageEnabled={false}
        allowFileAccess={false}
        allowsInlineMediaPlayback={false}
        setSupportMultipleWindows={false}
        cacheEnabled={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    backgroundColor: '#000', // evita flash branco antes do primeiro paint
    borderWidth: 2,
    borderColor: '#1c3a24',
    overflow: 'hidden',
  },
  webviewContainer: {
    backgroundColor: '#000',
  },
  webview: {
    flex: 1,
    backgroundColor: '#000',
  },
});

export default ChaosTerminal;
