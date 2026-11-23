import { useEffect, useRef } from 'react';
import { Alert, Box, Button, Center, Container, Group, Loader, Paper, ScrollArea, Stack, Text } from '@mantine/core';
import { IconAlertCircle } from '@tabler/icons-react';
import type { ProposalDecision } from '../chatApi';
import type { LoadStatus, UiMessage } from '../useChat';
import { Composer } from './Composer';
import { MessageBubble } from './MessageBubble';
import { WelcomePanel } from './WelcomePanel';

interface ChatViewProps {
  messages: UiMessage[];
  status: LoadStatus;
  isSending: boolean;
  onSend: (text: string) => void;
  onRetry: (messageId: string) => void;
  onReload: () => void;
  onResolveProposal: (proposalId: string, decision: ProposalDecision) => Promise<void>;
}

export function ChatView({ messages, status, isSending, onSend, onRetry, onReload, onResolveProposal }: ChatViewProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
  }, [messages, isSending]);

  const showWelcome = status === 'ready' && messages.length === 0 && !isSending;

  return (
    <>
      <ScrollArea style={{ flex: 1, minHeight: 0 }} type="auto">
        <Container size="md" py="md">
          {status === 'loading' && (
            <Center py="xl">
              <Loader />
            </Center>
          )}

          {status === 'error' && (
            <Alert color="red" variant="light" icon={<IconAlertCircle size={18} />} title="Couldn't load this chat">
              <Button size="xs" variant="light" color="red" onClick={onReload}>
                Try again
              </Button>
            </Alert>
          )}

          {showWelcome && <WelcomePanel onPick={onSend} />}

          {status === 'ready' && (
            <Stack gap="md">
              {messages.map((message) => (
                <MessageBubble
                  key={message.id}
                  message={message}
                  onRetry={onRetry}
                  onResolveProposal={onResolveProposal}
                />
              ))}
              {isSending && <ThinkingIndicator />}
            </Stack>
          )}
          <div ref={bottomRef} />
        </Container>
      </ScrollArea>

      <Box py="sm" style={{ borderTop: '1px solid var(--mantine-color-default-border)' }}>
        <Container size="md">
          <Composer isSending={isSending} disabled={status !== 'ready'} onSend={onSend} />
        </Container>
      </Box>
    </>
  );
}

function ThinkingIndicator() {
  return (
    <Group justify="flex-start">
      <Paper px="md" py="xs" radius="lg" bg="var(--mantine-color-default-hover)">
        <Group gap="xs">
          <Loader size="xs" type="dots" />
          <Text size="sm" c="dimmed">
            Thinking…
          </Text>
        </Group>
      </Paper>
    </Group>
  );
}
