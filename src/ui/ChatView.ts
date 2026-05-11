import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { ChatManager } from '../core/ChatManager';
import { RoomState } from '../core/RoomState';
import { buildChatRenderPlan, chunkChatMessages } from './chatRenderPlan';

export class ChatView implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;
  private lastRenderedMessageIds: string[] = [];
  private postTimer?: NodeJS.Timeout;

  constructor(private readonly chatManager: ChatManager, private readonly roomState: RoomState) {
    this.chatManager.onDidChange(() => this.schedulePostMessages());
  }

  focusInput(): void {
    this.view?.webview.postMessage({ type: 'focus' });
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void | Thenable<void> {
    this.view = webviewView;
    this.lastRenderedMessageIds = [];
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html = this.renderHtml();
    webviewView.onDidDispose(() => {
      if (this.view === webviewView) {
        this.view = undefined;
        this.lastRenderedMessageIds = [];
      }
    });
    webviewView.webview.onDidReceiveMessage(message => {
      if (message?.type === 'send') {
        const content = typeof message.content === 'string' ? message.content.trim() : '';
        if (content.length === 0) {
          return;
        }
        void vscode.commands.executeCommand('coderooms.sendChatMessage', content);
      }
      if (message?.type === 'voice') {
        void vscode.commands.executeCommand('coderooms.joinVoice');
      }
    });
    this.schedulePostMessages();
  }

  private schedulePostMessages(): void {
    if (!this.view || this.postTimer) {
      return;
    }
    this.postTimer = setTimeout(() => {
      this.postTimer = undefined;
      this.postMessages();
    }, 0);
  }

  private postMessages(): void {
    if (!this.view) {
      return;
    }
    const plan = buildChatRenderPlan(this.lastRenderedMessageIds, this.chatManager.getMessages());
    this.lastRenderedMessageIds = plan.messageIds;

    if (plan.append && plan.messages.length === 0 && plan.dropHeadCount === 0) {
      return;
    }

    const chunks = chunkChatMessages(plan.messages, 50);
    const myUserId = this.roomState.getUserId();
    if (chunks.length === 0) {
      this.view.webview.postMessage({
        type: 'messages',
        payload: [],
        myUserId,
        append: plan.append,
        dropHeadCount: plan.dropHeadCount
      });
      return;
    }

    for (const [index, chunk] of chunks.entries()) {
      this.view.webview.postMessage({
        type: 'messages',
        payload: chunk,
        myUserId,
        append: plan.append || index > 0,
        dropHeadCount: index === 0 ? plan.dropHeadCount : 0
      });
    }
  }

  private renderHtml(): string {
    const nonce = crypto.randomBytes(16).toString('base64');
    return /* html */ `
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src data:;" />
    <style>
      :root {
        color-scheme: light dark;
        --bg: var(--vscode-sideBar-background);
        --border: var(--vscode-panel-border, rgba(128,128,128,0.2));
        --text-main: var(--vscode-editor-foreground);
        --text-dim: var(--vscode-descriptionForeground, rgba(128,128,128,0.7));
        
        --bubble-other: var(--vscode-editorWidget-background);
        --bubble-other-border: var(--vscode-editorWidget-border, transparent);
        
        --bubble-self: var(--vscode-button-background);
        --bubble-self-text: var(--vscode-button-foreground);
        
        --sys-bg: rgba(128,128,128,0.1);
        --link-color: var(--vscode-textLink-foreground);
        --accent: var(--vscode-focusBorder);
      }
      * { box-sizing: border-box; }
      html, body { height: 100%; margin: 0; padding: 0; }
      body {
        background: var(--bg);
        color: var(--text-main);
        font-family: var(--vscode-font-family), -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        font-size: 13px;
        display: flex;
        flex-direction: column;
        overflow: hidden;
      }

      .wrapper { display: flex; flex-direction: column; height: 100%; position: relative; }

      /* Sticky Header */
      .chat-header {
        padding: 12px 14px;
        background: color-mix(in srgb, var(--bg) 85%, transparent);
        backdrop-filter: blur(8px);
        -webkit-backdrop-filter: blur(8px);
        border-bottom: 1px solid var(--border);
        z-index: 10;
        flex-shrink: 0;
        display: flex;
        justify-content: space-between;
        align-items: center;
      }
      .header-main { flex: 1; min-width: 0; }
      .chat-title { font-weight: 600; font-size: 12px; letter-spacing: 0.3px; text-transform: uppercase; color: var(--text-dim); }
      
      .voice-btn {
        background: var(--accent); color: white; border: none; border-radius: 8px;
        padding: 4px 10px; font-size: 11px; font-weight: 600; cursor: pointer;
        display: flex; align-items: center; gap: 6px; transition: all 0.2s;
        margin-left: 12px; flex-shrink: 0;
      }
      .voice-btn:hover { filter: brightness(1.1); transform: translateY(-1px); }
      .voice-btn:active { transform: translateY(0); }
      .voice-btn svg { width: 12px; height: 12px; fill: currentColor; }

      .chat-hint-row { display: flex; justify-content: space-between; align-items: center; margin-top: 4px; }
      .chat-hint { font-size: 11px; color: var(--text-dim); }
      .chat-hint-row.hidden { display: none; }
      .chat-hint-dismiss {
        background: none; border: none; padding: 2px 4px; cursor: pointer;
        color: var(--text-dim); font-size: 11px; border-radius: 4px;
      }
      .chat-hint-dismiss:hover { background: rgba(128,128,128,0.2); color: var(--text-main); }

      /* Empty State */
      .empty-state {
        position: absolute; top: 0; left: 0; right: 0; bottom: 0;
        display: flex; flex-direction: column; align-items: center; justify-content: center;
        padding: 30px; text-align: center; pointer-events: none;
      }
      .empty-icon { font-size: 48px; margin-bottom: 16px; opacity: 0.2; filter: grayscale(1); }
      .empty-title { font-weight: 600; font-size: 14px; margin-bottom: 8px; opacity: 0.8; }
      .empty-sub { font-size: 12px; color: var(--text-dim); line-height: 1.5; }

      /* Messages Area */
      .messages {
        flex: 1; padding: 16px 14px; overflow-y: auto;
        display: flex; flex-direction: column; gap: 12px;
      }
      .messages::-webkit-scrollbar { width: 6px; }
      .messages::-webkit-scrollbar-track { background: transparent; }
      .messages::-webkit-scrollbar-thumb { background: rgba(128,128,128,0.2); border-radius: 10px; }
      .messages::-webkit-scrollbar-thumb:hover { background: rgba(128,128,128,0.4); }

      /* Date Divider */
      .date-divider {
        display: flex; align-items: center; justify-content: center;
        margin: 16px 0 8px; font-size: 10px; font-weight: 600;
        color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.5px;
      }
      .date-divider::before, .date-divider::after {
        content: ''; height: 1px; flex: 1; background: var(--border); margin: 0 12px; opacity: 0.5;
      }

      /* Chat Row */
      .chat-row {
        display: flex; flex-direction: column;
        max-width: 85%;
        animation: slideUp 0.2s cubic-bezier(0.1, 0.8, 0.2, 1);
        transform-origin: bottom center;
      }
      @keyframes slideUp {
        from { opacity: 0; transform: translateY(8px) scale(0.98); }
        to { opacity: 1; transform: translateY(0) scale(1); }
      }

      .chat-row.other { align-self: flex-start; }
      .chat-row.self { align-self: flex-end; }

      .msg-meta {
        font-size: 11px; margin-bottom: 4px; color: var(--text-dim);
        display: flex; align-items: center; gap: 6px;
      }
      .chat-row.other .msg-meta { margin-left: 4px; }
      .chat-row.self .msg-meta { margin-right: 4px; flex-direction: row-reverse; }

      .msg-name { font-weight: 600; color: var(--text-main); }
      
      .bubble {
        padding: 8px 12px; font-size: 13px; line-height: 1.45;
        word-break: break-word; position: relative;
        box-shadow: 0 1px 2px rgba(0,0,0,0.1);
      }
      
      .chat-row.other .bubble {
        background: var(--bubble-other);
        border: 1px solid var(--bubble-other-border);
        border-radius: 12px 12px 12px 2px;
      }
      
      .chat-row.self .bubble {
        background: var(--bubble-self);
        color: var(--bubble-self-text);
        border-radius: 12px 12px 2px 12px;
      }

      .bubble a { color: inherit; text-decoration: underline; opacity: 0.9; }
      .bubble a:hover { opacity: 1; }

      /* System Message */
      .system-row {
        align-self: center; margin: 4px 0;
        background: var(--sys-bg); padding: 4px 12px;
        border-radius: 12px; font-size: 11px; color: var(--text-dim);
        text-align: center; max-width: 90%; line-height: 1.4;
      }

      /* Composer */
      .composer-container {
        padding: 12px 14px;
        background: var(--bg);
        border-top: 1px solid var(--border);
        z-index: 10; flex-shrink: 0;
      }
      .composer {
        display: flex; align-items: flex-end; gap: 8px;
        background: var(--vscode-input-background, rgba(0,0,0,0.1));
        border: 1px solid var(--vscode-input-border, var(--border));
        border-radius: 16px; padding: 4px 4px 4px 12px;
        transition: border-color 0.2s;
      }
      .composer:focus-within { border-color: var(--accent); }

      .input {
        flex: 1; background: transparent; border: none; color: var(--vscode-input-foreground, inherit);
        font-family: inherit; font-size: 13px; line-height: 1.4; resize: none; outline: none;
        min-height: 20px; max-height: 120px; padding: 6px 0; margin-bottom: 2px;
      }
      .input::placeholder { color: var(--text-dim); opacity: 0.7; }

      .send-btn {
        width: 30px; height: 30px; border-radius: 12px; border: none;
        background: var(--accent); color: #fff; cursor: pointer;
        display: flex; align-items: center; justify-content: center;
        flex-shrink: 0; transition: all 0.2s cubic-bezier(0.1, 0.8, 0.2, 1);
        opacity: 0.5; transform: scale(0.9); pointer-events: none;
      }
      .send-btn.active { opacity: 1; transform: scale(1); pointer-events: auto; }
      .send-btn:hover { filter: brightness(1.1); }
      .send-btn:active { transform: scale(0.95); }
      .send-btn svg { width: 14px; height: 14px; fill: currentColor; transform: translateX(1px); }

      /* Scroll Anchor */
      .scroll-anchor {
        position: absolute; bottom: 70px; right: 14px;
        width: 32px; height: 32px; border-radius: 50%;
        background: var(--bubble-other); border: 1px solid var(--border);
        color: var(--text-main); cursor: pointer; display: none;
        align-items: center; justify-content: center; z-index: 20;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15); transition: opacity 0.2s;
      }
      .scroll-anchor.visible { display: flex; animation: slideUp 0.2s; }
      .scroll-anchor:hover { background: var(--hover-bg); }
    </style>
  </head>
  <body>
    <div class="wrapper">
      <div id="chatHeader" class="chat-header">
        <div class="header-main">
          <div id="chatTitle" class="chat-title">Session Chat</div>
          <div id="chatHintRow" class="chat-hint-row">
            <div class="chat-hint">Enter to send • Shift+Enter for new line</div>
            <button id="chatHintDismiss" class="chat-hint-dismiss" aria-label="Dismiss chat input tip" title="Dismiss chat input tip">Dismiss</button>
          </div>
        </div>
        <button id="voiceBtn" class="voice-btn" title="Join Voice Channel">
          <svg viewBox="0 0 16 16"><path d="M8 11a3 3 0 0 0 3-3V3a3 3 0 0 0-6 0v5a3 3 0 0 0 3 3z"/><path d="M13 8a5 5 0 0 1-10 0H2a6 6 0 0 0 12 0h-1z"/><path d="M8 14a1 1 0 1 0 0-2 1 1 0 0 0 0 2z"/></svg>
          Join Voice
        </button>
      </div>
      
      <div id="empty" class="empty-state">
        <div class="empty-icon">💭</div>
        <div class="empty-title">It's quiet here...</div>
        <div class="empty-sub">Send a message to start collaborating with the room. End-to-End Encrypted.</div>
      </div>

      <div id="messagesPanel" class="messages" role="log" aria-live="polite" aria-labelledby="chatTitle">
        <div id="messageList" aria-label="CodeRooms chat transcript"></div>
      </div>
      
      <button id="scrollBtn" class="scroll-anchor" aria-label="Scroll chat to the latest messages">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M8 11.5L2.5 6l1-.9L8 9.5l4.5-4.4 1 .9z"/></svg>
      </button>

      <div class="composer-container">
        <form id="composer" class="composer">
          <textarea id="input" class="input" rows="1" placeholder="Type a message..."></textarea>
          <button class="send-btn" type="submit" id="sendBtn" title="Send (Enter)">
            <svg viewBox="0 0 16 16"><path d="M1.7 1.1L14.7 7.6c.4.2.4.6 0 .8L1.7 14.9c-.4.2-.8-.1-.7-.5L2.5 9H8.5c.3 0 .5-.2.5-.5S8.8 8 8.5 8H2.5L1 1.6c-.1-.4.3-.7.7-.5z"/></svg>
          </button>
        </form>
      </div>
    </div>
    <script nonce="${nonce}">
      const vscode = acquireVsCodeApi();
      const panel = document.getElementById('messagesPanel');
      const list = document.getElementById('messageList');
      const empty = document.getElementById('empty');
      const form = document.getElementById('composer');
      const input = document.getElementById('input');
      const sendBtn = document.getElementById('sendBtn');
      const scrollBtn = document.getElementById('scrollBtn');
      const chatHintRow = document.getElementById('chatHintRow');

      let autoScroll = true;
      let viewState = vscode.getState() || {};
      let myUserId = null;

      if (viewState.chatHintDismissed) {
        chatHintRow.classList.add('hidden');
      }

      function formatTime(ts) {
        try { return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }
        catch { return ''; }
      }

      function formatDate(ts) {
        try {
          const d = new Date(ts);
          const today = new Date();
          if (d.toDateString() === today.toDateString()) return 'Today';
          return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
        } catch { return ''; }
      }

      function linkify(text) {
        return text.replace(/(https?:\\/\\/[^\\s<]+)/g, '<a href="$1" target="_blank">$1</a>');
      }
      function escapeHtml(s) {
        return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
      }

      let lastDate = '';
      let lastAuthor = '';
      let lastTime = 0;

      function renderMessages(messages, append = false, dropHeadCount = 0) {
        if (!append) {
          list.innerHTML = '';
          lastDate = ''; lastAuthor = ''; lastTime = 0;
        } else if (dropHeadCount > 0) {
          for (let i = 0; i < dropHeadCount && list.firstChild; i++) {
            list.removeChild(list.firstChild);
          }
        }

        const hasMessages = append ? list.children.length > 0 || messages.length > 0 : messages.length > 0;
        empty.style.display = hasMessages ? 'none' : 'flex';

        const fragment = document.createDocumentFragment();

        (messages || []).forEach(msg => {
          const msgDate = formatDate(msg.timestamp);
          if (msgDate && msgDate !== lastDate) {
            lastDate = msgDate;
            const div = document.createElement('div');
            div.className = 'date-divider'; div.textContent = msgDate;
            fragment.appendChild(div);
          }

          if (msg.isSystem) {
            const sys = document.createElement('div');
            sys.className = 'system-row';
            sys.innerHTML = '<strong>' + formatTime(msg.timestamp) + '</strong> &mdash; ' + escapeHtml(msg.content);
            fragment.appendChild(sys);
            lastAuthor = '';
            return;
          }

          const isSelf = msg.fromUserId === myUserId;
          const sameAuthor = msg.fromUserId === lastAuthor;
          const withinGroup = sameAuthor && (msg.timestamp - lastTime < 60000);

          const row = document.createElement('div');
          row.className = 'chat-row ' + (isSelf ? 'self' : 'other');
          
          if (!withinGroup) {
            const meta = document.createElement('div');
            meta.className = 'msg-meta';
            const name = document.createElement('span');
            name.className = 'msg-name';
            name.textContent = isSelf ? 'You' : msg.fromName;
            const time = document.createElement('span');
            time.textContent = formatTime(msg.timestamp);
            meta.appendChild(name);
            meta.appendChild(time);
            row.appendChild(meta);
          }

          const bubble = document.createElement('div');
          bubble.className = 'bubble';
          bubble.innerHTML = linkify(escapeHtml(msg.content));
          row.appendChild(bubble);

          fragment.appendChild(row);
          lastAuthor = msg.fromUserId;
          lastTime = msg.timestamp;
        });

        if (fragment.childNodes.length > 0) {
          list.appendChild(fragment);
        }

        if (autoScroll) {
          panel.scrollTop = panel.scrollHeight;
        }
      }

      panel.addEventListener('scroll', () => {
        const threshold = 40;
        const atBottom = panel.scrollHeight - panel.scrollTop - panel.clientHeight < threshold;
        autoScroll = atBottom;
        scrollBtn.classList.toggle('visible', !atBottom);
      });

      const voiceBtn = document.getElementById('voiceBtn');

      scrollBtn.addEventListener('click', () => {
        panel.scrollTop = panel.scrollHeight;
      });

      voiceBtn.addEventListener('click', () => {
        vscode.postMessage({ type: 'voice' });
      });

      document.getElementById('chatHintDismiss').addEventListener('click', () => {
        chatHintRow.classList.add('hidden');
        viewState = { ...viewState, chatHintDismissed: true };
        vscode.setState(viewState);
      });

      input.addEventListener('input', () => {
        input.style.height = '20px';
        input.style.height = Math.min(input.scrollHeight, 120) + 'px';
        const hasText = input.value.trim().length > 0;
        sendBtn.classList.toggle('active', hasText);
      });

      window.addEventListener('message', event => {
        if (event.data?.type === 'messages') {
          if (event.data.myUserId) myUserId = event.data.myUserId;
          renderMessages(event.data.payload, event.data.append, event.data.dropHeadCount || 0);
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
        input.style.height = '20px';
        sendBtn.classList.remove('active');
        input.focus();
      });

      input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && !event.shiftKey) {
          event.preventDefault();
          form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
        }
      });

      setTimeout(() => input.focus(), 100);
    </script>
  </body>
</html>
    `;
  }
}