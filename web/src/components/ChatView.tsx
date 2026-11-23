import { useEffect, useRef } from 'react';
import { Alert, Box, Button, Center, Container, Group, Loader, Paper, ScrollArea, Stack, Text } from '@mantine/core';
import { IconAlertCircle } from '@tabler/icons-react';
import type { ProposalDecision } from '../chatApi';
import type { LoadStatus, UiMessage } from '../useChat';
import { BrandMark } from './BrandLogo';
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

      <Box py="sm">
        <Container size="md">
          <Composer isSending={isSending} disabled={status !== 'ready'} onSend={onSend} />
          <Text size="xs" c="dimmed" ta="center" mt={6}>
            Wayfarer books stays only (no flights). Bookings are simulated and no payment is taken.
          </Text>
        </Container>
      </Box>
    </>
  );
}

function ThinkingIndicator() {
  return (
    <Group justify="flex-start" align="flex-start" gap="sm">
      <BrandMark size={30} />
      <Paper px="md" py="sm" radius="lg" withBorder>
        <Group gap="xs">
          <Loader size="xs" type="dots" />
          <Text size="sm" c="dimmed">
            Checking destinations…
          </Text>
        </Group>
      </Paper>
    </Group>
  );
}
