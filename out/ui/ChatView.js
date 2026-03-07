"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.ChatView = void 0;
const vscode = __importStar(require("vscode"));
class ChatView {
    constructor(chatManager) {
        this.chatManager = chatManager;
        this.chatManager.onDidChange(() => this.postMessages());
    }
    focusInput() {
        this.view?.webview.postMessage({ type: 'focus' });
    }
    resolveWebviewView(webviewView) {
        this.view = webviewView;
        webviewView.webview.options = { enableScripts: true };
        webviewView.webview.html = this.renderHtml();
        webviewView.webview.onDidReceiveMessage(message => {
            if (message?.type === 'send') {
                const content = typeof message.content === 'string' ? message.content.trim() : '';
                if (content.length === 0) {
                    return;
                }
                void vscode.commands.executeCommand('coderooms.sendChatMessage', content);
            }
        });
        this.postMessages();
    }
    postMessages() {
        if (!this.view) {
            return;
        }
        const messages = this.chatManager.getMessages();
        const chunkSize = 50;
        for (let i = 0; i < messages.length; i += chunkSize) {
            const slice = messages.slice(i, i + chunkSize);
            this.view.webview.postMessage({ type: 'messages', payload: slice, append: i > 0 });
        }
    }
    renderHtml() {
        const nonce = Math.random().toString(36).slice(2);
        return /* html */ `
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <style>
      :root {
        color-scheme: light dark;
        --bg: var(--vscode-sideBar-background);
        --panel: rgba(255,255,255,0.02);
        --border: rgba(128,128,128,0.28);
        --bubble: color-mix(in srgb, var(--vscode-editor-background) 90%, var(--vscode-button-background) 10%);
        --bubble-accent: color-mix(in srgb, var(--vscode-button-background) 45%, var(--vscode-editor-background) 55%);
        --system: rgba(128,128,128,0.18);
      }
      html, body {
        height: 100%;
      }
      body {
        margin: 0;
        padding: 0;
        background: radial-gradient(180% 60% at 20% 20%, rgba(255,255,255,0.06), transparent),
                    radial-gradient(140% 70% at 80% 10%, rgba(0,150,255,0.05), transparent),
                    var(--bg);
        color: var(--vscode-editor-foreground);
        font-family: var(--vscode-font-family);
        display: flex;
        flex-direction: column;
      }
      .wrapper {
        display: flex;
        flex-direction: column;
        height: 100%;
      }
      .messages {
        flex: 1;
        padding: 8px 10px;
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .row {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }
      .meta {
        font-size: 11px;
        opacity: 0.8;
      }
      .bubble {
        padding: 10px 12px;
        border-radius: 10px;
        border: 1px solid var(--border);
        background: var(--bubble);
        box-shadow: inset 0 1px 0 rgba(255,255,255,0.04);
        white-space: pre-wrap;
        word-break: break-word;
        line-height: 1.4;
      }
      .bubble.accent {
        background: var(--bubble-accent);
        border-color: color-mix(in srgb, var(--vscode-button-background) 60%, var(--border) 40%);
      }
      .bubble.system {
        background: var(--system);
        border-style: dashed;
        font-style: italic;
      }
      .composer {
        border-top: 1px solid var(--border);
        padding: 10px;
        background: var(--panel);
        display: flex;
        gap: 8px;
        align-items: center;
      }
      .input {
        flex: 1;
        border: 1px solid var(--border);
        border-radius: 12px;
        padding: 10px 12px;
        background: var(--vscode-editor-background);
        color: inherit;
        font-size: 13px;
        outline: none;
        resize: none;
        min-height: 40px;
        max-height: 120px;
      }
      .input:focus {
        border-color: var(--vscode-focusBorder);
        box-shadow: 0 0 0 1px var(--vscode-focusBorder);
      }
      .send {
        border: 1px solid var(--border);
        border-radius: 10px;
        padding: 10px 14px;
        background: var(--vscode-button-background);
        color: var(--vscode-button-foreground);
        cursor: pointer;
        min-width: 64px;
      }
      .send:hover {
        filter: brightness(1.05);
      }
      .hint {
        font-size: 11px;
        opacity: 0.7;
        margin-left: 4px;
      }
    </style>
  </head>
  <body>
    <div class="wrapper">
      <div id="messages" class="messages"></div>
      <form id="composer" class="composer">
        <textarea id="input" class="input" rows="1" placeholder="Type a message to everyone... (Enter to send, Shift+Enter for newline)"></textarea>
        <button class="send" type="submit">Send</button>
      </form>
    </div>
    <script nonce="${nonce}">
      const vscode = acquireVsCodeApi();
      const list = document.getElementById('messages');
      const form = document.getElementById('composer');
      const input = document.getElementById('input');

      const formatTime = ts => {
        try {
          return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        } catch {
          return '';
        }
      };

      function renderMessages(messages, append = false) {
        if (!append) {
          list.innerHTML = '';
        }
        (messages || []).forEach(msg => {
          const row = document.createElement('div');
          row.className = 'row';

          const meta = document.createElement('div');
          meta.className = 'meta';
          meta.textContent = \`\${msg.fromName} • \${msg.role} • \${formatTime(msg.timestamp)}\`;
          row.appendChild(meta);

          const bubble = document.createElement('div');
          bubble.className = 'bubble' + (msg.isSystem ? ' system' : msg.role === 'root' ? ' accent' : '');
          bubble.textContent = msg.content;
          row.appendChild(bubble);

          list.appendChild(row);
        });
        list.scrollTop = list.scrollHeight;
      }

      window.addEventListener('message', event => {
        if (event.data?.type === 'messages') {
          renderMessages(event.data.payload, event.data.append);
        }
        if (event.data?.type === 'focus') {
          input.focus();
        }
      });

      form.addEventListener('submit', event => {
        event.preventDefault();
        const value = (input.value || '').trim();
        if (!value) {
          return;
        }
        vscode.postMessage({ type: 'send', content: value });
        input.value = '';
        input.style.height = '40px';
        input.focus();
      });

      input.addEventListener('input', () => {
        input.style.height = '40px';
        input.style.height = Math.min(input.scrollHeight, 120) + 'px';
      });

      input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && !event.shiftKey) {
          event.preventDefault();
          form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
        }
      });

      setTimeout(() => input.focus(), 80);
    </script>
  </body>
</html>
    `;
    }
}
exports.ChatView = ChatView;
//# sourceMappingURL=ChatView.js.map