import { AppShell, Burger, Group } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { IconPlaneTilt } from '@tabler/icons-react';
import { ChatView } from './components/ChatView';
import { ColorSchemeToggle } from './components/ColorSchemeToggle';
import { ConversationList } from './components/ConversationList';
import { useChat } from './useChat';
import classes from './App.module.css';

export function App() {
  const chat = useChat();
  const [isNavbarOpen, { toggle: toggleNavbar, close: closeNavbar }] = useDisclosure();

  function selectConversation(conversationId: string) {
    chat.selectConversation(conversationId);
    closeNavbar();
  }

  function startNewChat() {
    chat.startNewChat();
    closeNavbar();
  }

  return (
    <AppShell
      header={{ height: 68 }}
      navbar={{ width: 280, breakpoint: 'sm', collapsed: { mobile: !isNavbarOpen } }}
      padding={0}
    >
      <AppShell.Header className={classes.header}>
        <Group h="100%" px="lg" justify="space-between" wrap="nowrap">
          <Group gap="sm" wrap="nowrap">
            <Burger opened={isNavbarOpen} onClick={toggleNavbar} hiddenFrom="sm" size="sm" aria-label="Toggle chats" />
            <div className={classes.brandMark}>
              <IconPlaneTilt size={18} stroke={1.8} />
            </div>
            <div>
              <div className={classes.wordmark}>Travel Assistant</div>
              <div className={classes.tagline}>Plan · Book · Go</div>
            </div>
          </Group>

          <ColorSchemeToggle />
        </Group>
      </AppShell.Header>

      <AppShell.Navbar p="md" className={classes.navbar}>
        <ConversationList
          bookings={chat.bookings}
          conversations={chat.conversations}
          status={chat.conversationsStatus}
          activeConversationId={chat.activeConversationId}
          onSelect={selectConversation}
          onNewChat={startNewChat}
          onRetry={() => void chat.refreshConversations()}
        />
      </AppShell.Navbar>

      <AppShell.Main className={classes.main}>
        <ChatView
          messages={chat.messages}
          status={chat.messagesStatus}
          isSending={chat.isSending}
          onSend={(text) => void chat.sendMessage(text)}
          onRetry={chat.retryMessage}
          onReload={chat.reloadMessages}
          onResolveProposal={chat.resolveProposal}
        />
      </AppShell.Main>
    </AppShell>
  );
}
