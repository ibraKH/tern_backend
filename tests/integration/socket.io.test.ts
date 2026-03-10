jest.mock('../../src/config/database', () => ({
  __esModule: true,
  default: { query: jest.fn() },
}));

import http from 'http';
import { io as Client } from 'socket.io-client';

import app from '../../src/app';
import { initIo } from '../../src/socket';
import { socketAuthMiddleware } from '../../src/collab/auth.middleware';
import { signToken } from '../../src/utils/jwt';
import jwt from 'jsonwebtoken';

describe('socket.io bootstrap', () => {
  let server: http.Server;
  let port: number;
  let frontendUrl: string;

  beforeAll((done) => {
    frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:5173';
    process.env.FRONTEND_URL = frontendUrl;

    server = http.createServer(app);
    const io = initIo(server, frontendUrl);
    io.use(socketAuthMiddleware);

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

  afterAll((done) => {
    server.close(done);
  });

  function connect(url: string, opts: Parameters<typeof Client>[1]) {
    return new Promise<void>((resolve, reject) => {
      const socket = Client(url, {
        transports: ['websocket'],
        timeout: 2500,
        ...opts,
      });

      socket.on('connect', () => {
        socket.disconnect();
        resolve();
      });

      socket.on('connect_error', (err) => {
        socket.close();
        reject(err);
      });
    });
  }

  it('accepts token from handshake auth and Authorization header', async () => {
    const url = `http://localhost:${port}`;

    const token = signToken({ uid: 1, email: 'a@b.com', role: 'Editor' });

    await connect(url, {
      auth: { token },
      extraHeaders: { Origin: frontendUrl },
    });

    await connect(url, {
      extraHeaders: { Origin: frontendUrl, Authorization: `Bearer ${token}` },
    });
  });

  it('rejects socket with no token', async () => {
    const url = `http://localhost:${port}`;

    await expect(
      connect(url, {
        extraHeaders: { Origin: frontendUrl },
      })
    ).rejects.toMatchObject({ message: 'Unauthorized' });
  });

  it('rejects expired JWT', async () => {
    const url = `http://localhost:${port}`;

    const secret = process.env.JWT_SECRET as string;
    const issuer = process.env.JWT_ISSUER || 'tern-backend';
    const audience = process.env.JWT_AUDIENCE || 'tern-api';

    const expiredToken = jwt.sign(
      { uid: 1, email: 'a@b.com', role: 'Editor' },
      secret,
      { expiresIn: -10, issuer, audience }
    );

    await expect(
      connect(url, {
        auth: { token: expiredToken },
        extraHeaders: { Origin: frontendUrl },
      })
    ).rejects.toMatchObject({ message: 'Unauthorized' });
  });

  it('rejects tampered JWT', async () => {
    const url = `http://localhost:${port}`;

    const token = signToken({ uid: 1, email: 'a@b.com', role: 'Editor' });
    const parts = token.split('.');
    const tampered = `${parts[0]}.${parts[1]}.${parts[2].slice(0, -1)}${parts[2].slice(-1) === 'a' ? 'b' : 'a'}`;

    await expect(
      connect(url, {
        auth: { token: tampered },
        extraHeaders: { Origin: frontendUrl },
      })
    ).rejects.toMatchObject({ message: 'Unauthorized' });
  });
});
