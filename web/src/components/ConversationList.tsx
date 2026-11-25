import { Alert, Button, NavLink, ScrollArea, Skeleton, Stack, Text } from '@mantine/core';
import { IconAlertCircle, IconMessageCircle, IconPlaneDeparture, IconPlus } from '@tabler/icons-react';
import type { BookingView, ConversationSummary } from '@app/shared';
import { formatTripDate, formatUpdatedAt } from '../formatTrip.util';
import type { LoadStatus } from '../useChat';
import classes from './ConversationList.module.css';

interface ConversationListProps {
  bookings: BookingView[];
  conversations: ConversationSummary[];
  status: LoadStatus;
  activeConversationId: string | null;
  onSelect: (conversationId: string) => void;
  onNewChat: () => void;
  onRetry: () => void;
}

export function ConversationList({
  bookings,
  conversations,
  status,
  activeConversationId,
  onSelect,
  onNewChat,
  onRetry,
}: ConversationListProps) {
  return (
    <Stack h="100%" gap="lg">
      <Button leftSection={<IconPlus size={16} />} color="clay" onClick={onNewChat} fullWidth radius="md">
        Plan a new trip
      </Button>

      <ScrollArea style={{ flex: 1 }} type="auto">
        <Stack gap="lg">
          {bookings.length > 0 && (
            <Stack gap="xs">
              <span className={classes.sectionLabel}>My trips</span>
              {bookings.map((booking) => (
                <TripItem key={booking.bookingRef} booking={booking} />
              ))}
            </Stack>
          )}

          <Stack gap={4}>
            <span className={classes.sectionLabel}>Recent chats</span>
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
                  className={classes.chat}
                  label={title}
                  description={formatUpdatedAt(updatedAt)}
                  leftSection={<IconMessageCircle size={16} stroke={1.6} />}
                  active={id === activeConversationId}
                  onClick={() => onSelect(id)}
                  styles={{ label: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 500 } }}
                />
              ))}
          </Stack>
        </Stack>
      </ScrollArea>
    </Stack>
  );
}

function TripItem({ booking }: { booking: BookingView }) {
  return (
    <div className={classes.trip}>
      <div className={classes.tripMark}>
        <IconPlaneDeparture size={15} stroke={1.7} />
      </div>
      <div style={{ minWidth: 0 }}>
        <div className={classes.tripName}>{booking.destinationName}</div>
        <Text fz="xs" c="dimmed">
          {formatTripDate(booking.startDate)} · {booking.nights} nights
        </Text>
        <Text fz="xs" c="dimmed">
          Ref {booking.bookingRef}
        </Text>
      </div>
    </div>
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
