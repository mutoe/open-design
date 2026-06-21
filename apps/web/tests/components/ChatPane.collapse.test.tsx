// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { forwardRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ChatPane } from '../../src/components/ChatPane';
import type { ChatMessage } from '../../src/types';

vi.mock('../../src/i18n', () => ({
  useT: () => (key: string) => key,
  useI18n: () => ({ locale: 'en', setLocale: () => undefined, t: (key: string) => key }),
}));

vi.mock('../../src/components/AssistantMessage', () => ({
  AssistantMessage: ({ message }: { message: ChatMessage }) => (
    <div data-testid={`assistant-${message.id}`}>{message.content}</div>
  ),
}));

vi.mock('../../src/components/ChatComposer', () => ({
  ChatComposer: forwardRef((_props, _ref) => <div data-testid="composer" />),
}));

afterEach(() => {
  cleanup();
});

function renderChatPane(onCollapse?: () => void) {
  return render(
    <ChatPane
      messages={[]}
      streaming={false}
      error={null}
      projectId="project-1"
      projectFiles={[]}
      onEnsureProject={async () => 'project-1'}
      onSend={vi.fn()}
      onStop={vi.fn()}
      conversations={[]}
      activeConversationId={null}
      onSelectConversation={vi.fn()}
      onDeleteConversation={vi.fn()}
      onCollapse={onCollapse}
    />,
  );
}

describe('ChatPane collapse affordance', () => {
  it('renders a collapse button in the header when onCollapse is provided', () => {
    renderChatPane(vi.fn());
    expect(screen.getByTestId('chat-collapse-toggle')).toBeTruthy();
  });

  it('omits the collapse button when no onCollapse handler is given', () => {
    renderChatPane(undefined);
    expect(screen.queryByTestId('chat-collapse-toggle')).toBeNull();
  });

  it('invokes onCollapse when the collapse button is clicked', () => {
    const onCollapse = vi.fn();
    renderChatPane(onCollapse);
    fireEvent.click(screen.getByTestId('chat-collapse-toggle'));
    expect(onCollapse).toHaveBeenCalledTimes(1);
  });
});
