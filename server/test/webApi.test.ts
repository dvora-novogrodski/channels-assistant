import { randomUUID } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import type { ConversationSummary, ResolveProposalResponse, SendMessageResponse } from '@app/shared';
import { createApp } from '../src/app.js';
import { TripAssistant } from '../src/core/assistant.js';
import { LlmError } from '../src/core/llm/types.js';
import { InMemoryConversationStore } from '../src/core/store.js';
import { ScriptedLlm, textReply, toolReply } from './scriptedLlm.js';

const ALICE = randomUUID();
const BOB = randomUUID();
const TODAY = new Date('2027-01-10T12:00:00Z');

let server: Server | undefined;

afterEach(() => {
  server?.close();
  server = undefined;
});

async function startServer(llm = new ScriptedLlm(), webDistPath?: string) {
  const store = new InMemoryConversationStore();
  const assistant = new TripAssistant({ store, llm, now: () => TODAY });
  server = createApp({ store, assistant, webDistPath }).listen(0);
  await new Promise<void>((resolve) => server?.once('listening', resolve));
  const { port } = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}`;

  async function request<T>(method: string, route: string, body?: unknown) {
    const response = await fetch(`${baseUrl}${route}`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const contentType = response.headers.get('content-type') ?? '';
    const data = contentType.includes('application/json') ? ((await response.json()) as T) : await response.text();
    return { status: response.status, data: data as T };
  }

  async function createConversation(userId = ALICE) {
    const { data } = await request<ConversationSummary>('POST', '/api/conversations', { userId });
    return data.id;
  }

  return { baseUrl, request, createConversation };
}

describe('web API', () => {
  it('reports health', async () => {
    const { request } = await startServer();

    expect(await request('GET', '/api/health')).toEqual({ status: 200, data: { ok: true } });
  });

  it('creates and lists conversations per user', async () => {
    const { request, createConversation } = await startServer();
    const conversationId = await createConversation();

    const alice = await request<ConversationSummary[]>('GET', `/api/conversations?userId=${ALICE}`);
    const bob = await request<ConversationSummary[]>('GET', `/api/conversations?userId=${BOB}`);

    expect(alice.data).toEqual([{ id: conversationId, title: 'New chat', updatedAt: expect.any(String) }]);
    expect(bob.data).toEqual([]);
  });

  it('sends a message and returns it in the history', async () => {
    const { request, createConversation } = await startServer(new ScriptedLlm(textReply('Try Lisbon in May.')));
    const conversationId = await createConversation();

    const sent = await request<SendMessageResponse>('POST', `/api/conversations/${conversationId}/messages`, {
      userId: ALICE,
      text: 'Europe in May?',
    });
    const history = await request('GET', `/api/conversations/${conversationId}/messages?userId=${ALICE}`);

    expect(sent).toMatchObject({ status: 200, data: { reply: { role: 'assistant', text: 'Try Lisbon in May.' } } });
    expect(history.data).toMatchObject([{ role: 'user', text: 'Europe in May?' }, { role: 'assistant' }]);
  });

  it("returns 404 for another user's conversation", async () => {
    const { request, createConversation } = await startServer();
    const conversationId = await createConversation(ALICE);

    const response = await request('GET', `/api/conversations/${conversationId}/messages?userId=${BOB}`);

    expect(response).toEqual({ status: 404, data: { error: 'Conversation not found' } });
  });

  it('returns 400 for invalid input', async () => {
    const { request, createConversation } = await startServer();
    const conversationId = await createConversation();

    const missingText = await request('POST', `/api/conversations/${conversationId}/messages`, { userId: ALICE });
    const badUserId = await request('GET', '/api/conversations?userId=not-a-uuid');

    expect(missingText.status).toBe(400);
    expect(missingText.data).toEqual({ error: expect.stringContaining('text:') });
    expect(badUserId.status).toBe(400);
  });

  it('returns 400 for malformed JSON', async () => {
    const { baseUrl } = await startServer();

    const response = await fetch(`${baseUrl}/api/conversations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"userId":',
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Malformed JSON body' });
  });

  it('returns a JSON 404 for unknown API routes', async () => {
    const { request } = await startServer();

    expect(await request('GET', '/api/does-not-exist')).toEqual({ status: 404, data: { error: 'Not found' } });
  });

  it('returns an LLM failure as a chat message, not an HTTP error', async () => {
    const { request, createConversation } = await startServer(new ScriptedLlm(new LlmError('unavailable', '503')));
    const conversationId = await createConversation();

    const response = await request<SendMessageResponse>('POST', `/api/conversations/${conversationId}/messages`, {
      userId: ALICE,
      text: 'Hi',
    });

    expect(response.status).toBe(200);
    expect(response.data.reply.error).toEqual({ kind: 'unavailable', retryable: true });
  });

  it('confirms a proposal and 404s for an unknown one', async () => {
    const llm = new ScriptedLlm(
      toolReply({
        name: 'propose_trip',
        args: { destinationId: 'lisbon-pt', startDate: '2027-05-12', nights: 5, travelers: 2 },
      }),
      textReply('Confirm to book.'),
    );
    const { request, createConversation } = await startServer(llm);
    const conversationId = await createConversation();
    const { data } = await request<SendMessageResponse>('POST', `/api/conversations/${conversationId}/messages`, {
      userId: ALICE,
      text: 'Book Lisbon',
    });
    const proposalsRoute = `/api/conversations/${conversationId}/proposals`;

    const confirmed = await request<ResolveProposalResponse>('POST', `${proposalsRoute}/${data.reply.proposal?.id}`, {
      userId: ALICE,
      decision: 'confirm',
    });
    const unknown = await request('POST', `${proposalsRoute}/missing`, { userId: ALICE, decision: 'confirm' });

    expect(confirmed.data.proposal).toMatchObject({ status: 'confirmed', bookingRef: expect.stringMatching(/^TRV-/) });
    expect(unknown).toEqual({ status: 404, data: { error: 'Proposal not found' } });
  });

  it('serves the built web app for non-API routes', async () => {
    const webDistPath = mkdtempSync(path.join(tmpdir(), 'web-dist-'));
    writeFileSync(path.join(webDistPath, 'index.html'), '<!doctype html><title>Travel Assistant</title>');
    const { request } = await startServer(new ScriptedLlm(), webDistPath);

    const response = await request<string>('GET', '/some/client/route');

    expect(response.status).toBe(200);
    expect(response.data).toContain('<title>Travel Assistant</title>');
  });
});
