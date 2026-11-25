import { useEffect, useRef } from 'react';
import { Alert, Box, Button, Center, Container, Group, Loader, ScrollArea, Stack, Text } from '@mantine/core';
import { IconAlertCircle } from '@tabler/icons-react';
import type { ProposalDecision } from '../chatApi';
import type { LoadStatus, UiMessage } from '../useChat';
import { Composer } from './Composer';
import { AssistantAvatar, MessageBubble } from './MessageBubble';
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
  const quickReplies = isSending ? undefined : messages.at(-1)?.quickReplies;

  return (
    <>
      <ScrollArea style={{ flex: 1, minHeight: 0 }} type="auto">
        <Container size={760} px="md" py="xl">
          {status === 'loading' && (
            <Center py="xl">
              <Loader size="sm" />
            </Center>
          )}

          {status === 'error' && (
            <Alert color="red" variant="light" icon={<IconAlertCircle size={18} />} title="Couldn't load this chat">
              <Button size="xs" variant="white" color="red" onClick={onReload}>
                Try again
              </Button>
            </Alert>
          )}

          {showWelcome && <WelcomePanel onPick={onSend} />}

          {status === 'ready' && (
            <Stack gap="xl">
              {messages.map((message) => (
                <MessageBubble
                  key={message.id}
                  message={message}
                  onRetry={onRetry}
                  onResolveProposal={onResolveProposal}
                />
              ))}
              {isSending && <ThinkingIndicator />}
              {quickReplies && <QuickReplies options={quickReplies} onPick={onSend} />}
            </Stack>
          )}
          <div ref={bottomRef} />
        </Container>
      </ScrollArea>

      <Box pb="md" pt="xs">
        <Container size={760} px="md">
          <Composer isSending={isSending} disabled={status !== 'ready'} onSend={onSend} />
          <Text fz={11} c="dimmed" ta="center" mt={8}>
            Demo app: sample destinations, simulated flights and bookings, no real payments.
          </Text>
        </Container>
      </Box>
    </>
  );
}

function QuickReplies({ options, onPick }: { options: string[]; onPick: (text: string) => void }) {
  return (
    <Group gap="xs" pl={42}>
      {options.map((option) => (
        <Button key={option} variant="default" radius="xl" size="xs" fw={500} onClick={() => onPick(option)}>
          {option}
        </Button>
      ))}
    </Group>
  );
}

function ThinkingIndicator() {
  return (
    <Group align="center" gap="sm" wrap="nowrap">
      <AssistantAvatar />
      <Group gap={8}>
        <Loader size={14} type="dots" />
        <Text fz="sm" c="dimmed">
          Planning your trip…
        </Text>
      </Group>
    </Group>
  );
}
