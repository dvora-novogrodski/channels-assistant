import { useState, type KeyboardEvent } from 'react';
import { ActionIcon, Group, Paper, Textarea } from '@mantine/core';
import { IconArrowUp } from '@tabler/icons-react';

export const MAX_MESSAGE_LENGTH = 2000;

interface ComposerProps {
  isSending: boolean;
  disabled: boolean;
  onSend: (text: string) => void;
}

export function Composer({ isSending, disabled, onSend }: ComposerProps) {
  const [text, setText] = useState('');
  const canSend = text.trim().length > 0 && !isSending && !disabled;

  function submit() {
    if (!canSend) return;
    onSend(text.trim());
    setText('');
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    submit();
  }

  return (
    <Paper
      radius="xl"
      px="md"
      py={6}
      style={{ background: 'var(--app-surface)', border: '1px solid var(--app-border)', boxShadow: 'var(--app-shadow)' }}
    >
      <Group align="flex-end" gap="xs" wrap="nowrap">
        <Textarea
          style={{ flex: 1 }}
          variant="unstyled"
          autosize
          minRows={1}
          maxRows={6}
          maxLength={MAX_MESSAGE_LENGTH}
          placeholder="Where to? Try “a quiet beach in March for two”"
          aria-label="Message"
          value={text}
          disabled={disabled}
          onChange={(event) => setText(event.currentTarget.value)}
          onKeyDown={handleKeyDown}
        />
        <ActionIcon
          size={34}
          radius="xl"
          mb={4}
          aria-label="Send message"
          onClick={submit}
          disabled={!canSend}
          loading={isSending}
        >
          <IconArrowUp size={18} />
        </ActionIcon>
      </Group>
    </Paper>
  );
}
