import { Alert, Button, NavLink, ScrollArea, Skeleton, Stack, Text } from '@mantine/core';
import { IconAlertCircle, IconPlus } from '@tabler/icons-react';
import type { ConversationSummary } from '@app/shared';
import { formatUpdatedAt } from '../formatTrip.util';
import type { LoadStatus } from '../useChat';

interface ConversationListProps {
  conversations: ConversationSummary[];
  status: LoadStatus;
  activeConversationId: string | null;
  onSelect: (conversationId: string) => void;
  onNewChat: () => void;
  onRetry: () => void;
}

export function ConversationList({
  conversations,
  status,
  activeConversationId,
  onSelect,
  onNewChat,
  onRetry,
}: ConversationListProps) {
  return (
    <Stack h="100%" gap="md">
      <Button leftSection={<IconPlus size={16} />} variant="default" onClick={onNewChat} fullWidth radius="md">
        New trip chat
      </Button>

      <Text size="xs" fw={600} c="dimmed" px="xs">
        Recent
      </Text>

      <ScrollArea style={{ flex: 1 }} type="auto" mt={-8}>
        {status === 'loading' && <ListSkeleton />}

        {status === 'error' && (
          <Alert color="red" variant="light" icon={<IconAlertCircle size={16} />} title="Couldn't load chats">
            <Button size="xs" variant="subtle" color="red" onClick={onRetry} px={0}>
              Try again
            </Button>
          </Alert>
        )}

        {status === 'ready' && conversations.length === 0 && (
          <Text size="sm" c="dimmed" px="xs">
            Your trip chats will appear here.
          </Text>
        )}

        {status === 'ready' &&
          conversations.map(({ id, title, updatedAt }) => (
            <NavLink
              key={id}
              label={title}
              description={formatUpdatedAt(updatedAt)}
              active={id === activeConversationId}
              variant="light"
              onClick={() => onSelect(id)}
              styles={{
                root: { borderRadius: 'var(--mantine-radius-md)', marginBottom: 2 },
                label: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 500 },
              }}
            />
          ))}
      </ScrollArea>
    </Stack>
  );
}

function ListSkeleton() {
  return (
    <Stack gap="xs" px="xs">
      {[0, 1, 2].map((row) => (
        <Skeleton key={row} height={40} radius="md" />
      ))}
    </Stack>
  );
}
