jest.mock('../../src/config/database', () => ({
  __esModule: true,
  default: { query: jest.fn(), connect: jest.fn() },
}));

import http from 'http';
import { io as Client, type Socket as ClientSocket } from 'socket.io-client';
import request from 'supertest';

import app from '../../src/app';
import { initIo } from '../../src/socket';
import { socketAuthMiddleware } from '../../src/collab/auth.middleware';
import { registerCollabHandlers } from '../../src/collab/socket';
import { signToken } from '../../src/utils/jwt';
import pool from '../../src/config/database';

describe('collab comment socket events', () => {
  let server: http.Server;
  let port: number;
  let frontendUrl: string;
  let ioServer: any;
  let closeIo: (() => Promise<void>) | undefined;
  let nextCommentId: number;
  let mentionDirectory: Record<string, { id: number; email: string }>;

  beforeAll((done) => {
    frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:5173';
    process.env.FRONTEND_URL = frontendUrl;

    server = http.createServer((_req, res) => res.end('ok'));
    ioServer = initIo(server, frontendUrl);
    ioServer.use(socketAuthMiddleware);
    registerCollabHandlers(ioServer);

    closeIo = () => new Promise<void>((resolve) => ioServer.close(() => resolve()));

    server.listen(0, () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        done(new Error('Failed to bind test server'));
        return;
      }
      port = address.port;
      done();
    });
  });

  afterAll(async () => {
    if (closeIo) await closeIo();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  beforeEach(() => {
    jest.clearAllMocks();
    nextCommentId = 450;
    mentionDirectory = {};

    // createComment now uses pool.connect(); delegate client.query to the existing pool.query mock.
    (pool.connect as jest.Mock).mockResolvedValue({
      query: (text: string, values?: unknown[]) => (pool.query as jest.Mock)(text, values),
      release: jest.fn(),
    });

    (pool.query as jest.Mock).mockImplementation(async (text: string, values?: unknown[]) => {
      const sql = text.replace(/\s+/g, ' ').trim().toLowerCase();

      if (sql.includes('from auth_users') && sql.includes('where id = $1')) {
        const uid = Number((values ?? [])[0] ?? 1);
        return {
          rows: [{ id: uid, email: `user${uid}@test.com`, role: 'Editor', contributor_id: null }],
        };
      }

      if (sql.includes('select id from stmmodel where stm_name = $1')) {
        return { rows: [{ id: 123 }] };
      }

      if (sql.includes('insert into collab_comments')) {
        const userId = Number((values ?? [])[1] ?? 0);
        const entityType = ((values ?? [])[2] as 'node' | 'edge' | null | undefined) ?? null;
        const entityId = ((values ?? [])[3] as number | null | undefined) ?? null;
        const body = String((values ?? [])[4] ?? '');

        return {
          rows: [{
            id: nextCommentId++,
            model_id: 123,
            user_id: userId,
            entity_type: entityType,
            entity_id: entityId,
            body,
            resolved: false,
            resolved_at: null,
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-01-01T00:00:00Z',
          }],
        };
      }

      if (sql.includes('select id, email from auth_users where lower(email) = any($1)')) {
        const emails = ((values ?? [])[0] as string[] | undefined) ?? [];
        const rows = emails
          .map((e) => String(e).toLowerCase())
          .map((e) => mentionDirectory[e])
          .filter((u): u is { id: number; email: string } => Boolean(u));

        return { rows };
      }

      if (sql.includes('insert into collab_mentions')) {
        return { rows: [] };
      }

      if (sql.includes('insert into collab_activity')) {
        return { rows: [] };
      }

      if (sql.includes('select id from auth_users where lower(email) = $1 limit 1')) {
        const email = String((values ?? [])[0] ?? '').toLowerCase();
        const user = mentionDirectory[email];
        return { rows: user ? [{ id: user.id }] : [] };
      }

      if (sql.includes('select x, y from stmnode') || sql.includes('select x, y from stmedge')) {
        return { rows: [{ x: 100, y: 200 }] };
      }

      return { rows: [] };
    });
  });

  function connectClient(token: string): Promise<ClientSocket> {
    const url = `http://localhost:${port}`;

    return new Promise((resolve, reject) => {
      const socket = Client(url, {
        transports: ['websocket'],
        timeout: 2500,
        auth: { token },
        extraHeaders: { Origin: frontendUrl },
      });

      socket.on('connect', () => resolve(socket));
      socket.on('connect_error', (err) => {
        socket.close();
        reject(err);
      });
    });
  }

  function once<T>(socket: ClientSocket, event: string): Promise<T> {
    return new Promise((resolve) => socket.once(event, (data: T) => resolve(data)));
  }

  function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  it('POST /collab/:modelName/comments broadcasts comment:new to all sockets in room', async () => {
    const modelName = `comment-test-${Date.now()}-1`;
    const token1 = signToken({ uid: 101, email: 'user1@test.com', role: 'Editor' });
    const token2 = signToken({ uid: 102, email: 'user2@test.com', role: 'Editor' });

    // Connect two clients to the room
    const s1 = await connectClient(token1);
    const s2 = await connectClient(token2);

    const joinP1 = once<any>(s1, 'presence:sync');
    s1.emit('room:join', { modelName });
    await joinP1;

    const joinP2 = once<any>(s2, 'presence:sync');
    s2.emit('room:join', { modelName });
    await joinP2;

    // Set up listeners for comment:new
    const s1CommentP = once<any>(s1, 'comment:new');
    const s2CommentP = once<any>(s2, 'comment:new');

    // Create comment via HTTP
    const res = await request(app)
      .post(`/collab/${modelName}/comments`)
      .set('Authorization', `Bearer ${signToken({ uid: 101, email: 'user1@test.com', role: 'Editor' })}`)
      .send({ body: 'test comment' });

    expect(res.status).toBe(201);
    expect(res.body.comment).toBeDefined();

    // Both sockets should receive comment:new
    const [comment1, comment2] = await Promise.all([s1CommentP, s2CommentP]);

    expect(comment1.comment.body).toBe('test comment');
    expect(comment2.comment.body).toBe('test comment');

    s1.close();
    s2.close();
  });

  it('POST /collab/:modelName/comments with @mention sends comment:mention to mentioned user if online', async () => {
    const modelName = `mention-test-${Date.now()}-1`;
    const token1 = signToken({ uid: 201, email: 'author@test.com', role: 'Editor' });
    const token2 = signToken({ uid: 202, email: 'mentioned@test.com', role: 'Editor' });

    // Connect author and mentioned user
    const sAuthor = await connectClient(token1);
    const sMentioned = await connectClient(token2);

    const joinAuthorP = once<any>(sAuthor, 'presence:sync');
    sAuthor.emit('room:join', { modelName });
    await joinAuthorP;

    const joinMentionedP = once<any>(sMentioned, 'presence:sync');
    sMentioned.emit('room:join', { modelName });
    await joinMentionedP;

    // Set up listener for comment:mention on mentioned user's socket
    const mentionEventP = once<any>(sMentioned, 'comment:mention');

    mentionDirectory['mentioned@test.com'] = { id: 202, email: 'mentioned@test.com' };

    // Create comment with mention
    const res = await request(app)
      .post(`/collab/${modelName}/comments`)
      .set('Authorization', `Bearer ${token1}`)
      .send({ body: 'hey @mentioned@test.com' });

    expect(res.status).toBe(201);

    // Mentioned user should receive comment:mention
    const mentionEvent = await mentionEventP;
    expect(mentionEvent.comment.body).toContain('@mentioned@test.com');
    expect(mentionEvent.modelName).toBe(modelName);

    sAuthor.close();
    sMentioned.close();
  });

  it('POST /collab/:modelName/comments with @mention of offline user is no-op (no error, no event sent)', async () => {
    const modelName = `offline-mention-${Date.now()}-1`;
    const token = signToken({ uid: 301, email: 'author@test.com', role: 'Editor' });

    const sAuthor = await connectClient(token);

    const joinP = once<any>(sAuthor, 'presence:sync');
    sAuthor.emit('room:join', { modelName });
    await joinP;

    // Track if any error event is sent
    let errorReceived = false;
    sAuthor.on('error:mention', () => {
      errorReceived = true;
    });

    // Create comment with mention to offline user
    const res = await request(app)
      .post(`/collab/${modelName}/comments`)
      .set('Authorization', `Bearer ${token}`)
      .send({ body: 'hey @offline@test.com' });

    expect(res.status).toBe(201);

    // Wait a bit and verify no error event was sent
    await delay(100);
    expect(errorReceived).toBe(false);

    sAuthor.close();
  });

  it('viewport:navigate-to with valid entity emits viewport:fly-to to requesting socket only', async () => {
    const modelName = `nav-test-${Date.now()}-1`;
    const token1 = signToken({ uid: 401, email: 'nav1@test.com', role: 'Editor' });
    const token2 = signToken({ uid: 402, email: 'nav2@test.com', role: 'Editor' });

    const s1 = await connectClient(token1);
    const s2 = await connectClient(token2);

    const join1P = once<any>(s1, 'presence:sync');
    s1.emit('room:join', { modelName });
    await join1P;

    const join2P = once<any>(s2, 'presence:sync');
    s2.emit('room:join', { modelName });
    await join2P;

    // Set up listener for viewport:fly-to on s1
    const flyToP = once<any>(s1, 'viewport:fly-to');

    // Track if s2 receives the event (it shouldn't)
    let s2ReceeivedFlyTo = false;
    s2.on('viewport:fly-to', () => {
      s2ReceeivedFlyTo = true;
    });

    // Mock database query for node lookup
    (pool.query as jest.Mock).mockResolvedValueOnce({ rows: [{ x: 100, y: 200 }] });

    // Send navigate-to event from s1
    s1.emit('viewport:navigate-to', {
      modelName,
      entityType: 'node',
      entityId: 42,
    });

    // s1 should receive viewport:fly-to with coordinates
    const flyTo = await flyToP;
    expect(flyTo).toEqual({ x: 100, y: 200 });

    // s2 should not receive the event
    await delay(100);
    expect(s2ReceeivedFlyTo).toBe(false);

    s1.close();
    s2.close();
  });

  it('viewport:navigate-to with invalid entityId emits error:not_found to sender', async () => {
    const modelName = `nav-error-${Date.now()}-1`;
    const token = signToken({ uid: 501, email: 'nav-error@test.com', role: 'Editor' });

    const s = await connectClient(token);

    const joinP = once<any>(s, 'presence:sync');
    s.emit('room:join', { modelName });
    await joinP;

    // Mock database query returning no results
    (pool.query as jest.Mock).mockResolvedValueOnce({ rows: [] });

    // Set up listener for error:not_found
    const errorP = once<any>(s, 'error:not_found');

    s.emit('viewport:navigate-to', {
      modelName,
      entityType: 'node',
      entityId: 9999, // non-existent entity
    });

    const error = await errorP;
    expect(error.message).toContain('not found');

    s.close();
  });

  it('viewport:navigate-to with invalid payload emits error:validation', async () => {
    const modelName = `nav-validation-${Date.now()}-1`;
    const token = signToken({ uid: 601, email: 'nav-val@test.com', role: 'Editor' });

    const s = await connectClient(token);

    const joinP = once<any>(s, 'presence:sync');
    s.emit('room:join', { modelName });
    await joinP;

    const errorP = once<any>(s, 'error:validation');

    // Send invalid payload (missing entityId)
    s.emit('viewport:navigate-to', {
      modelName,
      entityType: 'node',
      // entityId is missing
    });

    const error = await errorP;
    expect(error.message).toMatch(/entityId|required/i);

    s.close();
  });

  it('comment broadcast to room happens regardless of whether mentions exist', async () => {
    const modelName = `broadcast-no-mention-${Date.now()}-1`;
    const token1 = signToken({ uid: 701, email: 'br1@test.com', role: 'Editor' });
    const token2 = signToken({ uid: 702, email: 'br2@test.com', role: 'Editor' });

    const s1 = await connectClient(token1);
    const s2 = await connectClient(token2);

    const join1 = once<any>(s1, 'presence:sync');
    s1.emit('room:join', { modelName });
    await join1;

    const join2 = once<any>(s2, 'presence:sync');
    s2.emit('room:join', { modelName });
    await join2;

    const commentP = once<any>(s2, 'comment:new');

    const res = await request(app)
      .post(`/collab/${modelName}/comments`)
      .set('Authorization', `Bearer ${token1}`)
      .send({ body: 'comment without mentions' });

    expect(res.status).toBe(201);

    // s2 should still receive comment:new even though no mentions exist
    const comment = await commentP;
    expect(comment.comment.body).toBe('comment without mentions');

    s1.close();
    s2.close();
  });
});
