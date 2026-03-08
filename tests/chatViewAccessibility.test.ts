import { describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => ({}));

import { ChatView } from '../src/ui/ChatView';

describe('ChatView accessibility markup', () => {
  it('renders semantic transcript structure and recovery affordances', () => {
    const chatView = new ChatView({
      onDidChange: () => ({ dispose: () => {} }),
      getMessages: () => []
    } as any);

    const html = (chatView as any).renderHtml() as string;

    expect(html).toContain('id="chatTitle"');
    expect(html).toContain('id="messagesPanel"');
    expect(html).toContain('id="messageList"');
    expect(html).toContain('aria-labelledby="chatTitle"');
    expect(html).toContain('aria-label="CodeRooms chat transcript"');
    expect(html).toContain('aria-label="Scroll chat to the latest messages"');
  });
});
