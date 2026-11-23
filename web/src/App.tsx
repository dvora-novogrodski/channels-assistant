import { AppShell, Badge, Burger, Group } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { BrandLogo } from './components/BrandLogo';
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
      header={{ height: 64 }}
      navbar={{ width: 288, breakpoint: 'sm', collapsed: { mobile: !isNavbarOpen } }}
      padding={0}
    >
      <AppShell.Header className={classes.header}>
        <Group h="100%" px="md" justify="space-between" wrap="nowrap">
          <Group gap="sm" wrap="nowrap">
            <Burger opened={isNavbarOpen} onClick={toggleNavbar} hiddenFrom="sm" size="sm" aria-label="Toggle chats" />
            <BrandLogo showTagline />
          </Group>
          <Group gap="sm" wrap="nowrap">
            <Badge variant="light" color="gray" visibleFrom="md">
              Sample data · simulated stays
            </Badge>
            <ColorSchemeToggle />
          </Group>
        </Group>
      </AppShell.Header>

      <AppShell.Navbar p="sm" className={classes.navbar}>
        <ConversationList
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
