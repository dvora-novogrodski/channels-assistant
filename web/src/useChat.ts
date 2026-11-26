import { useCallback, useEffect, useRef, useState } from 'react';
import {
  BOOKING_STEPS,
  BOOKING_STEP_MS,
  type BookingView,
  type ChatMessage,
  type ConversationSummary,
  type ErrorKind,
  type ProposalDecision,
  type ProposalView,
} from '@app/shared';
import { ApiRequestError, chatApi } from './chatApi';
import { getOrCreateUserId, readActiveConversationId, saveActiveConversationId } from './browserStorage.util';

export type LoadStatus = 'loading' | 'ready' | 'error';
export type UiErrorKind = ErrorKind | 'network';

export interface UiMessage extends Omit<ChatMessage, 'error'> {
  error?: { kind: UiErrorKind; retryable: boolean };
  retry?: { text: string; userMessageId: string };
}

const userId = getOrCreateUserId();

function describeError(error: unknown): string {
  return error instanceof ApiRequestError ? error.message : 'Something went wrong. Please try again.';
}

function localMessage(role: UiMessage['role'], text: string, error?: UiMessage['error']): UiMessage {
  return { id: `local-${crypto.randomUUID()}`, role, text, createdAt: new Date().toISOString(), error };
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function withProposal(messages: UiMessage[], proposal: ProposalView | undefined): UiMessage[] {
  if (!proposal) return messages;
  return messages.map((message) => (message.proposal?.id === proposal.id ? { ...message, proposal } : message));
}

export function useChat() {
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [conversationsStatus, setConversationsStatus] = useState<LoadStatus>('loading');
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [messagesStatus, setMessagesStatus] = useState<LoadStatus>('ready');
  const [isSending, setIsSending] = useState(false);
  const [bookings, setBookings] = useState<BookingView[]>([]);

  const activeConversationRef = useRef<string | null>(null);

  const activate = useCallback((conversationId: string | null) => {
    activeConversationRef.current = conversationId;
    setActiveConversationId(conversationId);
    saveActiveConversationId(conversationId);
  }, []);

  const refreshBookings = useCallback(async () => {
    try {
      setBookings(await chatApi.listBookings(userId));
    } catch {
      return;
    }
  }, []);

  const refreshConversations = useCallback(async (): Promise<ConversationSummary[] | null> => {
    void refreshBookings();
    try {
      const list = await chatApi.listConversations(userId);
      setConversations(list);
      setConversationsStatus('ready');
      return list;
    } catch {
      setConversationsStatus('error');
      return null;
    }
  }, [refreshBookings]);

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

  const createConversationFor = useCallback(async (): Promise<string> => {
    const created = await chatApi.createConversation(userId);
    void refreshConversations();
    if (activeConversationRef.current === null) activate(created.id);
    return created.id;
  }, [activate, refreshConversations]);

  const sendMessage = useCallback(
    async (text: string, replacedMessageIds: string[] = []) => {
      if (isSending) return;
      const startedIn = activeConversationRef.current;
      const userMessage = localMessage('user', text);
      const retry = { text, userMessageId: userMessage.id };
      let conversationId = startedIn;

      setIsSending(true);
      setMessages((previous) => [...previous.filter(({ id }) => !replacedMessageIds.includes(id)), userMessage]);
      try {
        conversationId = startedIn ?? (await createConversationFor());
        const { reply, updatedProposal } = await chatApi.sendMessage(userId, conversationId, text);
        if (activeConversationRef.current !== conversationId) return;
        const uiReply: UiMessage = reply.error?.retryable ? { ...reply, retry } : reply;
        setMessages((previous) => withProposal([...previous, uiReply], updatedProposal));
        void refreshConversations();
      } catch (error) {
        if (activeConversationRef.current !== conversationId) return;
        const failure = { ...localMessage('assistant', describeError(error), { kind: 'network', retryable: true }), retry };
        setMessages((previous) => [...previous, failure]);
      } finally {
        setIsSending(false);
      }
    },
    [isSending, createConversationFor, refreshConversations],
  );

  const retryMessage = useCallback(
    (failedMessageId: string) => {
      const retry = messages.find(({ id }) => id === failedMessageId)?.retry;
      if (!retry) return;
      void sendMessage(retry.text, [failedMessageId, retry.userMessageId]);
    },
    [messages, sendMessage],
  );

  const resolveProposal = useCallback(async (proposalId: string, decision: ProposalDecision, paymentMethodId?: string) => {
    const conversationId = activeConversationRef.current;
    if (!conversationId) return;

    try {
      const minimumDuration = decision === 'confirm' ? BOOKING_STEPS.length * BOOKING_STEP_MS : 0;
      const [{ proposal, reply }] = await Promise.all([
        chatApi.resolveProposal(userId, conversationId, proposalId, decision, paymentMethodId),
        wait(minimumDuration),
      ]);
      if (activeConversationRef.current !== conversationId) return;
      setMessages((previous) => withProposal([...previous, reply], proposal));
      void refreshBookings();
    } catch (error) {
      throw new Error(describeError(error));
    }
  }, [refreshBookings]);

  const reloadMessages = useCallback(() => {
    if (activeConversationRef.current) void loadMessages(activeConversationRef.current);
  }, [loadMessages]);

  return {
    bookings,
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
