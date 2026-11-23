import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChatMessage, ConversationSummary, ErrorKind, ProposalView } from '@app/shared';
import { ApiRequestError, chatApi, type ProposalDecision } from './chatApi';
import { getOrCreateUserId, readActiveConversationId, saveActiveConversationId } from './browserStorage.util';

export type LoadStatus = 'loading' | 'ready' | 'error';
export type UiErrorKind = ErrorKind | 'network';

export interface UiMessage extends Omit<ChatMessage, 'error'> {
  error?: { kind: UiErrorKind; retryable: boolean };
  retryText?: string;
}

const userId = getOrCreateUserId();

function describeError(error: unknown): string {
  return error instanceof ApiRequestError ? error.message : 'Something went wrong. Please try again.';
}

function localMessage(role: UiMessage['role'], text: string, error?: UiMessage['error']): UiMessage {
  return { id: `local-${crypto.randomUUID()}`, role, text, createdAt: new Date().toISOString(), error };
}

function withProposal(messages: UiMessage[], proposal: ProposalView | undefined): UiMessage[] {
  if (!proposal) return messages;
  return messages.map((message) => (message.proposal?.id === proposal.id ? { ...message, proposal } : message));
}

function toUiReply(reply: ChatMessage, sentText: string): UiMessage {
  return reply.error?.retryable ? { ...reply, retryText: sentText } : reply;
}

export function useChat() {
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [conversationsStatus, setConversationsStatus] = useState<LoadStatus>('loading');
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [messagesStatus, setMessagesStatus] = useState<LoadStatus>('ready');
  const [isSending, setIsSending] = useState(false);

  // Replies that arrive after the user switched chats must not be rendered into the new chat.
  const activeConversationRef = useRef<string | null>(null);

  const activate = useCallback((conversationId: string | null) => {
    activeConversationRef.current = conversationId;
    setActiveConversationId(conversationId);
    saveActiveConversationId(conversationId);
  }, []);

  const refreshConversations = useCallback(async (): Promise<ConversationSummary[] | null> => {
    try {
      const list = await chatApi.listConversations(userId);
      setConversations(list);
      setConversationsStatus('ready');
      return list;
    } catch {
      setConversationsStatus('error');
      return null;
    }
  }, []);

  const loadMessages = useCallback(async (conversationId: string) => {
    setMessagesStatus('loading');
    try {
      const history = await chatApi.listMessages(userId, conversationId);
      if (activeConversationRef.current !== conversationId) return;
      setMessages(history);
      setMessagesStatus('ready');
    } catch {
      if (activeConversationRef.current === conversationId) setMessagesStatus('error');
    }
  }, []);

  const selectConversation = useCallback(
    (conversationId: string) => {
      if (conversationId === activeConversationRef.current) return;
      activate(conversationId);
      setMessages([]);
      void loadMessages(conversationId);
    },
    [activate, loadMessages],
  );

  const startNewChat = useCallback(() => {
    activate(null);
    setMessages([]);
    setMessagesStatus('ready');
  }, [activate]);

  useEffect(() => {
    void (async () => {
      const list = await refreshConversations();
      const savedId = readActiveConversationId();
      if (savedId && list?.some(({ id }) => id === savedId)) selectConversation(savedId);
    })();
  }, [refreshConversations, selectConversation]);

  const ensureConversation = useCallback(async (): Promise<string> => {
    if (activeConversationRef.current) return activeConversationRef.current;
    const created = await chatApi.createConversation(userId);
    activate(created.id);
    return created.id;
  }, [activate]);

  const sendMessage = useCallback(
    async (text: string) => {
      if (isSending) return;
      setIsSending(true);
      setMessages((previous) => [...previous, localMessage('user', text)]);
      try {
        const conversationId = await ensureConversation();
        const { reply, updatedProposal } = await chatApi.sendMessage(userId, conversationId, text);
        if (activeConversationRef.current !== conversationId) return;
        setMessages((previous) => withProposal([...previous, toUiReply(reply, text)], updatedProposal));
        void refreshConversations();
      } catch (error) {
        const failure = { ...localMessage('assistant', describeError(error), { kind: 'network', retryable: true }), retryText: text };
        setMessages((previous) => [...previous, failure]);
      } finally {
        setIsSending(false);
      }
    },
    [isSending, ensureConversation, refreshConversations],
  );

  const retryMessage = useCallback(
    (failedMessageId: string) => {
      const failedIndex = messages.findIndex(({ id }) => id === failedMessageId);
      const retryText = messages[failedIndex]?.retryText;
      if (failedIndex === -1 || !retryText) return;

      // The server saved neither the failed message nor its reply, so drop both and send again.
      setMessages((previous) => previous.filter((_message, index) => index !== failedIndex && index !== failedIndex - 1));
      void sendMessage(retryText);
    },
    [messages, sendMessage],
  );

  const resolveProposal = useCallback(async (proposalId: string, decision: ProposalDecision) => {
    const conversationId = activeConversationRef.current;
    if (!conversationId) return;

    try {
      const { proposal, reply } = await chatApi.resolveProposal(userId, conversationId, proposalId, decision);
      if (activeConversationRef.current !== conversationId) return;
      setMessages((previous) => withProposal([...previous, reply], proposal));
    } catch (error) {
      throw new Error(describeError(error));
    }
  }, []);

  const reloadMessages = useCallback(() => {
    if (activeConversationRef.current) void loadMessages(activeConversationRef.current);
  }, [loadMessages]);

  return {
    conversations,
    conversationsStatus,
    activeConversationId,
    messages,
    messagesStatus,
    isSending,
    refreshConversations,
    selectConversation,
    startNewChat,
    sendMessage,
    retryMessage,
    resolveProposal,
    reloadMessages,
  };
}
