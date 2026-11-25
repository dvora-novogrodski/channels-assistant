import { Alert, Box, Button, Group, Stack, Text, Typography } from '@mantine/core';
import { IconAlertTriangle, IconClockPause, IconPlaneTilt, IconRefresh, IconWifiOff } from '@tabler/icons-react';
import Markdown, { type Components } from 'react-markdown';
import type { ProposalDecision } from '../chatApi';
import type { UiErrorKind, UiMessage } from '../useChat';
import { ProposalCard } from './ProposalCard';
import classes from './MessageBubble.module.css';

const ERROR_PRESENTATION: Record<UiErrorKind, { title: string; color: string; icon: typeof IconAlertTriangle }> = {
  rate_limit: { title: 'The AI is busy', color: 'yellow', icon: IconClockPause },
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

export function AssistantAvatar() {
  return (
    <div className={classes.avatar} aria-hidden>
      <IconPlaneTilt size={15} stroke={1.6} />
    </div>
  );
}

export function MessageBubble({ message, onRetry, onResolveProposal }: MessageBubbleProps) {
  if (message.error) return <ErrorMessage message={message} onRetry={onRetry} />;
  if (message.role === 'user') return <UserMessage text={message.text} />;

  const { proposal } = message;
  return (
    <Group align="flex-start" gap="sm" wrap="nowrap">
      <AssistantAvatar />
      <Stack gap="md" style={{ flex: 1, minWidth: 0 }} pt={4}>
        <Typography className={classes.markdown}>
          <Markdown components={MARKDOWN_COMPONENTS}>{message.text}</Markdown>
        </Typography>
        {proposal && (
          <ProposalCard proposal={proposal} onDecision={(decision) => onResolveProposal(proposal.id, decision)} />
        )}
      </Stack>
    </Group>
  );
}

function UserMessage({ text }: { text: string }) {
  return (
    <Group justify="flex-end">
      <Box className={classes.userBubble} px="md" py={10} maw="78%">
        <Text fz="sm" className={classes.userText}>
          {text}
        </Text>
      </Box>
    </Group>
  );
}

function ErrorMessage({ message, onRetry }: Pick<MessageBubbleProps, 'message' | 'onRetry'>) {
  const presentation = ERROR_PRESENTATION[message.error?.kind ?? 'internal'];
  const Icon = presentation.icon;

  return (
    <Group align="flex-start" gap="sm" wrap="nowrap">
      <AssistantAvatar />
      <Alert
        style={{ flex: 1 }}
        radius="lg"
        variant="light"
        color={presentation.color}
        title={presentation.title}
        icon={<Icon size={18} />}
      >
        <Stack gap="xs" align="flex-start">
          <Text fz="sm">{message.text}</Text>
          {message.retry && (
            <Button
              size="xs"
              variant="white"
              color={presentation.color}
              leftSection={<IconRefresh size={14} />}
              onClick={() => onRetry(message.id)}
            >
              Try again
            </Button>
          )}
        </Stack>
      </Alert>
    </Group>
  );
}
