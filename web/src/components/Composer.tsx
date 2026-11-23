import { useState, type KeyboardEvent } from 'react';
import { ActionIcon, Group, Textarea } from '@mantine/core';
import { IconSend } from '@tabler/icons-react';

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
    <Group align="flex-end" gap="xs" wrap="nowrap">
      <Textarea
        style={{ flex: 1 }}
        autosize
        minRows={1}
        maxRows={6}
        radius="lg"
        maxLength={MAX_MESSAGE_LENGTH}
        placeholder='Ask about destinations, or say "book Lisbon for 2 in May"'
        aria-label="Message"
        value={text}
        disabled={disabled}
        onChange={(event) => setText(event.currentTarget.value)}
        onKeyDown={handleKeyDown}
      />
      <ActionIcon
        size={36}
        radius="xl"
        aria-label="Send message"
        onClick={submit}
        disabled={!canSend}
        loading={isSending}
      >
        <IconSend size={18} />
      </ActionIcon>
    </Group>
  );
}
