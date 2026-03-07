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
        --border: rgba(128,128,128,0.2);
        --bubble: color-mix(in srgb, var(--vscode-editor-background) 92%, var(--vscode-button-background) 8%);
        --bubble-accent: color-mix(in srgb, var(--vscode-button-background) 35%, var(--vscode-editor-background) 65%);
        --bubble-self: color-mix(in srgb, var(--vscode-button-background) 18%, var(--vscode-editor-background) 82%);
        --system-bg: rgba(128,128,128,0.08);
        --system-border: rgba(128,128,128,0.15);
        --text-dim: rgba(128,128,128,0.7);
        --avatar-root: #e8a830;
        --avatar-collab: #4c9ce8;
        --avatar-viewer: #888;
        --hover-bg: rgba(128,128,128,0.06);
        --link-color: var(--vscode-textLink-foreground);
      }
      * { box-sizing: border-box; }
      html, body { height: 100%; }
      body {
        margin: 0; padding: 0;
        background: var(--bg);
        color: var(--vscode-editor-foreground);
        font-family: var(--vscode-font-family);
        font-size: 13px;
        display: flex;
        flex-direction: column;
      }

      .wrapper { display: flex; flex-direction: column; height: 100%; }

      /* Empty state */
      .empty-state {
        flex: 1; display: flex; flex-direction: column;
        align-items: center; justify-content: center; gap: 8px;
        opacity: 0.5; padding: 24px; text-align: center;
      }
      .empty-state .icon { font-size: 32px; }
      .empty-state .title { font-size: 14px; font-weight: 500; }
      .empty-state .subtitle { font-size: 12px; }

      /* Messages */
      .messages {
        flex: 1; padding: 6px 8px; overflow-y: auto;
        display: flex; flex-direction: column; gap: 2px;
      }
      .messages::-webkit-scrollbar { width: 6px; }
      .messages::-webkit-scrollbar-track { background: transparent; }
      .messages::-webkit-scrollbar-thumb { background: rgba(128,128,128,0.3); border-radius: 3px; }

      /* Date divider */
      .date-divider {
        display: flex; align-items: center; gap: 8px;
        margin: 12px 0 6px; font-size: 11px; color: var(--text-dim);
      }
      .date-divider::before, .date-divider::after {
        content: ''; flex: 1; height: 1px;
        background: var(--border);
      }

      /* System messages */
      .system-row {
        display: flex; align-items: center; gap: 6px;
        padding: 4px 10px; margin: 2px 0;
        border-radius: 6px;
        background: var(--system-bg); border: 1px solid var(--system-border);
        font-size: 12px; color: var(--text-dim);
        font-style: italic;
      }
      .system-row .sys-icon { opacity: 0.6; font-size: 12px; }
      .system-row .sys-time { margin-left: auto; font-size: 10px; opacity: 0.7; }

      /* Chat rows */
      .chat-row {
        display: flex; gap: 8px; padding: 6px 4px;
        border-radius: 8px; transition: background 0.1s;
      }
      .chat-row:hover { background: var(--hover-bg); }

      .avatar {
        width: 30px; height: 30px; border-radius: 50%;
        display: flex; align-items: center; justify-content: center;
        font-size: 13px; font-weight: 600; flex-shrink: 0;
        color: #fff; text-transform: uppercase;
        margin-top: 2px;
      }
      .avatar.root { background: var(--avatar-root); }
      .avatar.collaborator { background: var(--avatar-collab); }
      .avatar.viewer { background: var(--avatar-viewer); }

      .msg-body { flex: 1; min-width: 0; }

      .msg-header {
        display: flex; align-items: baseline; gap: 6px;
        margin-bottom: 2px;
      }
      .msg-name {
        font-size: 13px; font-weight: 600;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      }
      .msg-role {
        font-size: 10px; padding: 1px 5px;
        border-radius: 3px; font-weight: 500;
        text-transform: uppercase; letter-spacing: 0.3px;
      }
      .msg-role.root { background: rgba(232,168,48,0.2); color: var(--avatar-root); }
      .msg-role.collaborator { background: rgba(76,156,232,0.2); color: var(--avatar-collab); }
      .msg-role.viewer { background: rgba(128,128,128,0.2); color: var(--avatar-viewer); }
      .msg-time { font-size: 11px; color: var(--text-dim); margin-left: auto; white-space: nowrap; }

      .msg-content {
        white-space: pre-wrap; word-break: break-word;
        line-height: 1.45; font-size: 13px;
      }
      .msg-content a {
        color: var(--link-color); text-decoration: none;
      }
      .msg-content a:hover { text-decoration: underline; }

      /* Grouped: hide avatar if same author within 2 min */
      .chat-row.grouped { padding-top: 1px; }
      .chat-row.grouped .avatar { visibility: hidden; height: 0; width: 30px; }
      .chat-row.grouped .msg-header { display: none; }

      /* Composer */
      .composer {
        border-top: 1px solid var(--border);
        padding: 8px 10px;
        background: var(--panel);
        display: flex; gap: 6px; align-items: flex-end;
      }
      .input {
        flex: 1;
        border: 1px solid var(--border);
        border-radius: 10px;
        padding: 8px 12px;
        background: var(--vscode-input-background, var(--vscode-editor-background));
        color: var(--vscode-input-foreground, inherit);
        font-family: inherit; font-size: 13px;
        outline: none; resize: none;
        min-height: 36px; max-height: 120px;
        line-height: 1.4;
        transition: border-color 0.15s, box-shadow 0.15s;
      }
      .input::placeholder { color: var(--text-dim); }
      .input:focus {
        border-color: var(--vscode-focusBorder);
        box-shadow: 0 0 0 1px var(--vscode-focusBorder);
      }
      .send-btn {
        border: none; border-radius: 50%;
        width: 34px; height: 34px;
        background: var(--vscode-button-background);
        color: var(--vscode-button-foreground);
        cursor: pointer; display: flex;
        align-items: center; justify-content: center;
        transition: opacity 0.15s, transform 0.1s;
        flex-shrink: 0;
      }
      .send-btn:hover { opacity: 0.9; transform: scale(1.05); }
      .send-btn:active { transform: scale(0.95); }
      .send-btn:disabled { opacity: 0.4; cursor: default; transform: none; }
      .send-btn svg { width: 16px; height: 16px; fill: currentColor; }

      /* Scroll-to-bottom button */
      .scroll-anchor {
        position: sticky; bottom: 0; align-self: center;
        background: var(--vscode-button-background);
        color: var(--vscode-button-foreground);
        border: none; border-radius: 50%;
        width: 28px; height: 28px;
        cursor: pointer; display: none;
        align-items: center; justify-content: center;
        box-shadow: 0 2px 8px rgba(0,0,0,0.25);
        z-index: 10; margin-bottom: 4px;
        font-size: 14px;
      }
      .scroll-anchor.visible { display: flex; }
    </style>
  </head>
  <body>
    <div class="wrapper">
      <div id="empty" class="empty-state">
        <div class="icon">\ud83d\udcac</div>
        <div class="title">Room chat</div>
        <div class="subtitle">Messages appear here once someone sends one</div>
      </div>
      <div id="messages" class="messages" style="display:none;"></div>
      <button id="scrollBtn" class="scroll-anchor" title="Scroll to bottom">\u2193</button>
      <form id="composer" class="composer">
        <textarea id="input" class="input" rows="1" placeholder="Message the room\u2026 (Enter to send)"></textarea>
        <button class="send-btn" type="submit" id="sendBtn" disabled title="Send message">
          <svg viewBox="0 0 16 16"><path d="M1.7 1.1L14.7 7.6c.4.2.4.6 0 .8L1.7 14.9c-.4.2-.8-.1-.7-.5L2.5 9H8.5c.3 0 .5-.2.5-.5S8.8 8 8.5 8H2.5L1 1.6c-.1-.4.3-.7.7-.5z"/></svg>
        </button>
      </form>
    </div>
    <script nonce="${nonce}">
      const vscode = acquireVsCodeApi();
      const list = document.getElementById('messages');
      const empty = document.getElementById('empty');
      const form = document.getElementById('composer');
      const input = document.getElementById('input');
      const sendBtn = document.getElementById('sendBtn');
      const scrollBtn = document.getElementById('scrollBtn');

      let autoScroll = true;

      const formatTime = ts => {
        try { return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }
        catch { return ''; }
      };

      const formatDate = ts => {
        try {
          const d = new Date(ts);
          const today = new Date();
          if (d.toDateString() === today.toDateString()) return 'Today';
          const yesterday = new Date(today);
          yesterday.setDate(yesterday.getDate() - 1);
          if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
          return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
        } catch { return ''; }
      };

      const linkify = text => {
        return text.replace(/(https?:\\/\\/[^\\s<]+)/g, '<a href="$1" title="$1">$1</a>');
      };

      const initial = name => (name || '?')[0];

      let lastDate = '';
      let lastAuthor = '';
      let lastTime = 0;

      function renderMessages(messages, append = false) {
        if (!append) {
          list.innerHTML = '';
          lastDate = '';
          lastAuthor = '';
          lastTime = 0;
        }

        const hasMessages = append ? list.children.length > 0 || messages.length > 0 : messages.length > 0;
        empty.style.display = hasMessages ? 'none' : '';
        list.style.display = hasMessages ? '' : 'none';

        (messages || []).forEach(msg => {
          // Date divider
          const msgDate = formatDate(msg.timestamp);
          if (msgDate && msgDate !== lastDate) {
            lastDate = msgDate;
            lastAuthor = '';
            const divider = document.createElement('div');
            divider.className = 'date-divider';
            divider.textContent = msgDate;
            list.appendChild(divider);
          }

          if (msg.isSystem) {
            const sysRow = document.createElement('div');
            sysRow.className = 'system-row';
            sysRow.innerHTML =
              '<span class="sys-icon">\u2139\ufe0f</span>' +
              '<span>' + escapeHtml(msg.content) + '</span>' +
              '<span class="sys-time">' + formatTime(msg.timestamp) + '</span>';
            list.appendChild(sysRow);
            lastAuthor = '';
            return;
          }

          // Group consecutive messages from same author within 2 min
          const sameAuthor = msg.fromUserId === lastAuthor;
          const withinGroup = sameAuthor && (msg.timestamp - lastTime < 120000);

          const row = document.createElement('div');
          row.className = 'chat-row' + (withinGroup ? ' grouped' : '');

          const avatar = document.createElement('div');
          avatar.className = 'avatar ' + (msg.role || 'viewer');
          avatar.textContent = initial(msg.fromName);
          row.appendChild(avatar);

          const body = document.createElement('div');
          body.className = 'msg-body';

          const header = document.createElement('div');
          header.className = 'msg-header';
          const name = document.createElement('span');
          name.className = 'msg-name';
          name.textContent = msg.fromName;
          header.appendChild(name);

          const roleBadge = document.createElement('span');
          roleBadge.className = 'msg-role ' + (msg.role || 'viewer');
          roleBadge.textContent = msg.role === 'root' ? 'owner' : msg.role || 'guest';
          header.appendChild(roleBadge);

          const time = document.createElement('span');
          time.className = 'msg-time';
          time.textContent = formatTime(msg.timestamp);
          header.appendChild(time);

          body.appendChild(header);

          const content = document.createElement('div');
          content.className = 'msg-content';
          content.innerHTML = linkify(escapeHtml(msg.content));
          body.appendChild(content);

          row.appendChild(body);
          list.appendChild(row);

          lastAuthor = msg.fromUserId;
          lastTime = msg.timestamp;
        });

        if (autoScroll) {
          list.scrollTop = list.scrollHeight;
        }
      }

      function escapeHtml(s) {
        const div = document.createElement('div');
        div.textContent = s;
        return div.innerHTML;
      }

      // Auto-scroll detection
      list.addEventListener('scroll', () => {
        const threshold = 60;
        const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < threshold;
        autoScroll = atBottom;
        scrollBtn.classList.toggle('visible', !atBottom);
      });

      scrollBtn.addEventListener('click', () => {
        list.scrollTop = list.scrollHeight;
        autoScroll = true;
        scrollBtn.classList.remove('visible');
      });

      // Enable/disable send button
      input.addEventListener('input', () => {
        input.style.height = '36px';
        input.style.height = Math.min(input.scrollHeight, 120) + 'px';
        sendBtn.disabled = !input.value.trim();
      });

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
        if (!value) return;
        vscode.postMessage({ type: 'send', content: value });
        input.value = '';
        input.style.height = '36px';
        sendBtn.disabled = true;
        input.focus();
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