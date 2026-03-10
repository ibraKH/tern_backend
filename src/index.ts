import http from 'http';

import app from './app';
import { initIo } from './socket';
import { socketAuthMiddleware } from './collab/auth.middleware';
import { registerCollabHandlers } from './collab/socket';
import { FRONTEND_URL } from './config/env';

const PORT = process.env.PORT || 3000;
const frontendUrl = FRONTEND_URL;

const server = http.createServer(app);
const io = initIo(server, frontendUrl);
io.use(socketAuthMiddleware);
registerCollabHandlers(io);

server.listen(PORT, () => {
  console.log(`[server] running on ${PORT}`);
});