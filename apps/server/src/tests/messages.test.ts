import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { makeApp, cleanup, login, bearer, uniqueSlug } from './helpers.js';

let app: FastifyInstance;
beforeAll(async () => {
  app = await makeApp();
});
afterAll(async () => {
  await cleanup(app);
});

async function generalChannelId(token: string): Promise<string> {
  const res = await app.inject({ method: 'GET', url: '/v1/channels', headers: bearer(token) });
  const channels = JSON.parse(res.body).data as { id: string; slug: string }[];
  return (channels.find((c) => c.slug === 'general') ?? channels[0]).id;
}

describe('messages', () => {
  it('sends, edits, and soft-deletes an own message', async () => {
    const alice = await login(app);
    const channelId = await generalChannelId(alice.token);

    const sent = await app.inject({
      method: 'POST',
      url: `/v1/channels/${channelId}/messages`,
      headers: bearer(alice.token),
      payload: { body: 'hello world' },
    });
    expect(sent.statusCode).toBe(201);
    const message = JSON.parse(sent.body).message;
    expect(message.body).toBe('hello world');
    expect(message.author.username).toBe(alice.profile.username);

    const edited = await app.inject({
      method: 'PATCH',
      url: `/v1/messages/${message.id}`,
      headers: bearer(alice.token),
      payload: { body: 'hello, edited' },
    });
    expect(edited.statusCode).toBe(200);
    const editedMsg = JSON.parse(edited.body).message;
    expect(editedMsg.body).toBe('hello, edited');
    expect(editedMsg.editedAt).toBeTruthy();

    const deleted = await app.inject({
      method: 'DELETE',
      url: `/v1/messages/${message.id}`,
      headers: bearer(alice.token),
    });
    expect(deleted.statusCode).toBe(200);

    const list = await app.inject({
      method: 'GET',
      url: `/v1/channels/${channelId}/messages?limit=50`,
      headers: bearer(alice.token),
    });
    const found = (JSON.parse(list.body).data as { id: string; deleted: boolean }[]).find(
      (m) => m.id === message.id,
    );
    expect(found?.deleted).toBe(true);
  });

  it('forbids editing or deleting another user’s message', async () => {
    const alice = await login(app);
    const bob = await login(app);
    const channelId = await generalChannelId(alice.token);

    const sent = await app.inject({
      method: 'POST',
      url: `/v1/channels/${channelId}/messages`,
      headers: bearer(alice.token),
      payload: { body: 'aliceonly' },
    });
    const messageId = JSON.parse(sent.body).message.id;

    const edit = await app.inject({
      method: 'PATCH',
      url: `/v1/messages/${messageId}`,
      headers: bearer(bob.token),
      payload: { body: 'hacked' },
    });
    expect(edit.statusCode).toBe(403);

    const del = await app.inject({
      method: 'DELETE',
      url: `/v1/messages/${messageId}`,
      headers: bearer(bob.token),
    });
    expect(del.statusCode).toBe(403);
  });

  it('enforces private channel access', async () => {
    const alice = await login(app);
    const bob = await login(app);

    const created = await app.inject({
      method: 'POST',
      url: '/v1/channels',
      headers: bearer(alice.token),
      payload: { slug: uniqueSlug('secret'), name: 'Secret', visibility: 'PRIVATE' },
    });
    expect(created.statusCode).toBe(201);
    const channelId = JSON.parse(created.body).channel.id;

    // Owner can read; non-member cannot.
    const ownerView = await app.inject({
      method: 'GET',
      url: `/v1/channels/${channelId}/messages`,
      headers: bearer(alice.token),
    });
    expect(ownerView.statusCode).toBe(200);

    const intruder = await app.inject({
      method: 'GET',
      url: `/v1/channels/${channelId}/messages`,
      headers: bearer(bob.token),
    });
    expect(intruder.statusCode).toBe(403);
  });

  it('paginates with a cursor', async () => {
    const alice = await login(app);
    const channelId = await generalChannelId(alice.token);
    for (let i = 0; i < 6; i += 1) {
      await app.inject({
        method: 'POST',
        url: `/v1/channels/${channelId}/messages`,
        headers: bearer(alice.token),
        payload: { body: `page msg ${i}` },
      });
    }
    const page1 = await app.inject({
      method: 'GET',
      url: `/v1/channels/${channelId}/messages?limit=3`,
      headers: bearer(alice.token),
    });
    const body1 = JSON.parse(page1.body);
    expect(body1.data).toHaveLength(3);
    expect(body1.nextCursor).toBeTruthy();

    const page2 = await app.inject({
      method: 'GET',
      url: `/v1/channels/${channelId}/messages?limit=3&cursor=${encodeURIComponent(body1.nextCursor)}`,
      headers: bearer(alice.token),
    });
    const body2 = JSON.parse(page2.body);
    expect(body2.data.length).toBeGreaterThan(0);
    // No overlap between pages.
    const ids1 = new Set(body1.data.map((m: { id: string }) => m.id));
    for (const m of body2.data as { id: string }[]) expect(ids1.has(m.id)).toBe(false);
  });
});
