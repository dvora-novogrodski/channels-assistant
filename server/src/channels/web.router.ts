import { Router, type Response } from 'express';
import { z } from 'zod';
import { SAVED_PAYMENT_METHODS } from '@app/shared';
import type {
  BookingView,
  ChatMessage,
  ConversationSummary,
  CreateConversationRequest,
  ResolveProposalRequest,
  ResolveProposalResponse,
  SendMessageRequest,
  SendMessageResponse,
} from '@app/shared';
import type { TripAssistant } from '../core/assistant.js';
import type { ConversationStore } from '../core/store.js';

export const MAX_MESSAGE_LENGTH = 2000;
const SAVED_PAYMENT_METHOD_IDS = SAVED_PAYMENT_METHODS.map(({ id }) => id);

const UserQuerySchema = z.object({ userId: z.uuid() });

const CreateConversationSchema = z.object({ userId: z.uuid() }) satisfies z.ZodType<CreateConversationRequest>;

const SendMessageSchema = z.object({
  userId: z.uuid(),
  text: z.string().trim().min(1).max(MAX_MESSAGE_LENGTH),
}) satisfies z.ZodType<SendMessageRequest>;

const ResolveProposalSchema = z.object({
  userId: z.uuid(),
  decision: z.enum(['confirm', 'cancel']),
  paymentMethodId: z.enum(SAVED_PAYMENT_METHOD_IDS).optional(),
}) satisfies z.ZodType<ResolveProposalRequest>;

const ConversationParamsSchema = z.object({ conversationId: z.string().min(1) });
const ProposalParamsSchema = ConversationParamsSchema.extend({ proposalId: z.string().min(1) });

interface WebRouterDependencies {
  store: ConversationStore;
  assistant: TripAssistant;
}

// Web user ids are namespaced so they can never collide with Slack user ids in the shared store.
function toOwnerId(userId: string): string {
  return `web:${userId}`;
}

export function createWebRouter({ store, assistant }: WebRouterDependencies): Router {
  const router = Router();

  router.get('/conversations', (req, res: Response<ConversationSummary[]>) => {
    const { userId } = UserQuerySchema.parse(req.query);
    res.json(store.listConversations(toOwnerId(userId)));
  });

  router.get('/bookings', (req, res: Response<BookingView[]>) => {
    const { userId } = UserQuerySchema.parse(req.query);
    res.json([...store.getUser(toOwnerId(userId)).bookings].reverse());
  });

  router.post('/conversations', (req, res: Response<ConversationSummary>) => {
    const { userId } = CreateConversationSchema.parse(req.body);
    const { id, title, updatedAt } = store.createConversation(toOwnerId(userId));
    res.status(201).json({ id, title, updatedAt });
  });

  router.get('/conversations/:conversationId/messages', (req, res: Response<ChatMessage[]>) => {
    const { conversationId } = ConversationParamsSchema.parse(req.params);
    const { userId } = UserQuerySchema.parse(req.query);
    res.json(store.listMessages(toOwnerId(userId), conversationId));
  });

  router.post('/conversations/:conversationId/messages', async (req, res: Response<SendMessageResponse>) => {
    const { conversationId } = ConversationParamsSchema.parse(req.params);
    const { userId, text } = SendMessageSchema.parse(req.body);
    res.json(await assistant.handleMessage(toOwnerId(userId), conversationId, text));
  });

  router.post(
    '/conversations/:conversationId/proposals/:proposalId',
    (req, res: Response<ResolveProposalResponse>) => {
      const { conversationId, proposalId } = ProposalParamsSchema.parse(req.params);
      const { userId, decision, paymentMethodId } = ResolveProposalSchema.parse(req.body);
      res.json(assistant.resolveProposal(toOwnerId(userId), conversationId, proposalId, decision, paymentMethodId));
    },
  );

  return router;
}
