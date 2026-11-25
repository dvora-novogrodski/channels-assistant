import { Alert, Button, Group, Paper, Stack, Text, Typography } from '@mantine/core';
import { IconAlertTriangle, IconClockPause, IconRefresh, IconWifiOff } from '@tabler/icons-react';
import Markdown, { type Components } from 'react-markdown';
import type { ProposalDecision } from '../chatApi';
import type { UiErrorKind, UiMessage } from '../useChat';
import { ProposalCard } from './ProposalCard';
import classes from './MessageBubble.module.css';

const ERROR_PRESENTATION: Record<UiErrorKind, { title: string; color: string; icon: typeof IconAlertTriangle }> = {
  rate_limit: { title: 'AI is busy', color: 'yellow', icon: IconClockPause },
  busy: { title: 'Still working', color: 'yellow', icon: IconClockPause },
  unavailable: { title: 'AI service unavailable', color: 'red', icon: IconAlertTriangle },
  blocked: { title: "Can't help with that", color: 'orange', icon: IconAlertTriangle },
  internal: { title: 'Something went wrong', color: 'red', icon: IconAlertTriangle },
  network: { title: 'Connection problem', color: 'red', icon: IconWifiOff },
};

const MARKDOWN_COMPONENTS: Components = {
  a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer" />,
};

interface MessageBubbleProps {
  message: UiMessage;
  onRetry: (messageId: string) => void;
  onResolveProposal: (proposalId: string, decision: ProposalDecision) => Promise<void>;
}

export function MessageBubble({ message, onRetry, onResolveProposal }: MessageBubbleProps) {
  if (message.error) return <ErrorBubble message={message} onRetry={onRetry} />;

  const isUser = message.role === 'user';
  const { proposal } = message;
  return (
    <Group justify={isUser ? 'flex-end' : 'flex-start'} wrap="nowrap">
      <Stack gap="xs" maw="85%">
        <Paper
          px="md"
          py="xs"
          radius="lg"
          bg={isUser ? 'blue.6' : 'var(--mantine-color-default-hover)'}
          c={isUser ? 'white' : undefined}
        >
          {isUser ? (
            <Text size="sm" className={classes.userText}>
              {message.text}
            </Text>
          ) : (
            <Typography className={classes.markdown} fz="sm">
              <Markdown components={MARKDOWN_COMPONENTS}>{message.text}</Markdown>
            </Typography>
          )}
        </Paper>
        {proposal && (
          <ProposalCard proposal={proposal} onDecision={(decision) => onResolveProposal(proposal.id, decision)} />
        )}
      </Stack>
    </Group>
  );
}

function ErrorBubble({ message, onRetry }: Pick<MessageBubbleProps, 'message' | 'onRetry'>) {
  const presentation = ERROR_PRESENTATION[message.error?.kind ?? 'internal'];
  const Icon = presentation.icon;

  return (
    <Group justify="flex-start" wrap="nowrap">
      <Alert
        maw="85%"
        radius="lg"
        variant="light"
        color={presentation.color}
        title={presentation.title}
        icon={<Icon size={18} />}
      >
        <Stack gap="xs" align="flex-start">
          <Text size="sm">{message.text}</Text>
          {message.retry && (
            <Button
              size="xs"
              variant="light"
              color={presentation.color}
              leftSection={<IconRefresh size={14} />}
              onClick={() => onRetry(message.id)}
            >
              Retry
            </Button>
          )}
        </Stack>
      </Alert>
    </Group>
  );
}
