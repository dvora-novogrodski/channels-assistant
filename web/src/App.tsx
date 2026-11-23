import { AppShell, Box, Burger, Group, Text, ThemeIcon, Title } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { IconPlaneTilt } from '@tabler/icons-react';
import { ChatView } from './components/ChatView';
import { ColorSchemeToggle } from './components/ColorSchemeToggle';
import { ConversationList } from './components/ConversationList';
import { useChat } from './useChat';

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
      header={{ height: 56 }}
      navbar={{ width: 280, breakpoint: 'sm', collapsed: { mobile: !isNavbarOpen } }}
      padding={0}
    >
      <AppShell.Header>
        <Group h="100%" px="md" gap="sm" wrap="nowrap">
          <Burger opened={isNavbarOpen} onClick={toggleNavbar} hiddenFrom="sm" size="sm" aria-label="Toggle chats" />
          <ThemeIcon variant="light" radius="md">
            <IconPlaneTilt size={18} />
          </ThemeIcon>
          <Title order={4}>Travel Assistant</Title>
          <Text size="xs" c="dimmed" visibleFrom="sm">
            Suggestions from sample data · bookings are simulated
          </Text>
          <Box ml="auto">
            <ColorSchemeToggle />
          </Box>
        </Group>
      </AppShell.Header>

      <AppShell.Navbar p="sm">
        <ConversationList
          conversations={chat.conversations}
          status={chat.conversationsStatus}
          activeConversationId={chat.activeConversationId}
          onSelect={selectConversation}
          onNewChat={startNewChat}
          onRetry={() => void chat.refreshConversations()}
        />
      </AppShell.Navbar>

      <AppShell.Main style={{ display: 'flex', flexDirection: 'column', height: '100dvh' }}>
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
