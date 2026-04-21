import { createServer } from 'http';

import app from './app';
import { FRONTEND_URL } from './config/env';
import { initIo } from './socket';
import { socketAuthMiddleware } from './collab/auth.middleware';
import { registerCollabHandlers } from './collab/socket';
import { startLockCleanupJob, stopLockCleanupJob } from './collab/lockCleanup';

const PORT = process.env.PORT || 3000;

const server = createServer(app);
const io = initIo(server, FRONTEND_URL);

// Wire up Socket.IO: auth → collab event handlers.
io.use(socketAuthMiddleware);
registerCollabHandlers(io);

// Sweep expired editing locks every 10 s.
startLockCleanupJob(io);

server.listen(PORT, () => {
  console.log(`[server] running on ${PORT}`);
});

// Clean shutdown.
process.on('SIGTERM', () => {
  stopLockCleanupJob();
  server.close();
});
