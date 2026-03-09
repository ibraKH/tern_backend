jest.mock('../../src/config/database', () => ({
  __esModule: true,
  default: { query: jest.fn() },
}));

import http from 'http';
import { io as Client } from 'socket.io-client';

import app from '../../src/app';
import { initIo } from '../../src/socket';

describe('socket.io bootstrap', () => {
  let server: http.Server;
  let port: number;

  beforeAll((done) => {
    process.env.FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

    server = http.createServer(app);
    initIo(server, process.env.FRONTEND_URL);

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

  it('allows a client to establish a connection', async () => {
    const url = `http://localhost:${port}`;

    await new Promise<void>((resolve, reject) => {
      const socket = Client(url, {
        transports: ['websocket'],
        timeout: 2500,
        extraHeaders: {
          Origin: process.env.FRONTEND_URL as string,
        },
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
  });
});
