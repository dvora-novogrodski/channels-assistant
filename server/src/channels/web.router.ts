import { Router, type Response } from 'express';
import { z } from 'zod';
import { PROPOSAL_DECISIONS, SAVED_PAYMENT_METHODS } from '@app/shared';
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
import type { TravelService } from '../core/travelService.js';
import { parseRequest } from '../http/parseRequest.js';

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
  decision: z.enum(PROPOSAL_DECISIONS),
  paymentMethodId: z.enum(SAVED_PAYMENT_METHOD_IDS).optional(),
}) satisfies z.ZodType<ResolveProposalRequest>;

const ConversationParamsSchema = z.object({ conversationId: z.string().min(1) });
const ProposalParamsSchema = ConversationParamsSchema.extend({ proposalId: z.string().min(1) });

interface WebRouterDependencies {
  service: TravelService;
}

function toWebOwnerId(userId: string): string {
  return `web:${userId}`;
}

export function createWebRouter({ service }: WebRouterDependencies): Router {
  const router = Router();

  router.get('/conversations', (req, res: Response<ConversationSummary[]>) => {
    const { userId } = parseRequest(UserQuerySchema, req.query);
    res.json(service.listConversations(toWebOwnerId(userId)));
  });

  router.get('/bookings', (req, res: Response<BookingView[]>) => {
    const { userId } = parseRequest(UserQuerySchema, req.query);
    res.json(service.listBookings(toWebOwnerId(userId)));
  });

  router.post('/conversations', (req, res: Response<ConversationSummary>) => {
    const { userId } = parseRequest(CreateConversationSchema, req.body);
    const summary = service.startConversation(toWebOwnerId(userId));
    res.status(201).json(summary);
  });

  router.get('/conversations/:conversationId/messages', (req, res: Response<ChatMessage[]>) => {
    const { conversationId } = parseRequest(ConversationParamsSchema, req.params);
    const { userId } = parseRequest(UserQuerySchema, req.query);
    res.json(service.listMessages(toWebOwnerId(userId), conversationId));
  });

  router.post('/conversations/:conversationId/messages', async (req, res: Response<SendMessageResponse>) => {
    const { conversationId } = parseRequest(ConversationParamsSchema, req.params);
    const { userId, text } = parseRequest(SendMessageSchema, req.body);
    res.json(await service.sendMessage(toWebOwnerId(userId), conversationId, text));
  });

  router.post(
    '/conversations/:conversationId/proposals/:proposalId',
    (req, res: Response<ResolveProposalResponse>) => {
      const { conversationId, proposalId } = parseRequest(ProposalParamsSchema, req.params);
      const { userId, decision, paymentMethodId } = parseRequest(ResolveProposalSchema, req.body);
      res.json(service.resolveProposal(toWebOwnerId(userId), conversationId, proposalId, decision, paymentMethodId));
    },
  );

  return router;
}
