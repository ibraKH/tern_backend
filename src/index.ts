import http from 'http';

import app from './app';
import { initIo } from './socket';
import { socketAuthMiddleware } from './collab/auth.middleware';
import { registerCollabHandlers } from './collab/socket';
import { FRONTEND_URL } from './config/env';

const PORT = process.env.PORT || 3000;
const frontendUrl = FRONTEND_URL;

const server = http.createServer(app);
// Bind Socket.IO to the same HTTP server so REST and WS share one port.
// This keeps deployment surface and shutdown lifecycle unified.
const io = initIo(server, frontendUrl);
// Apply JWT auth before event registration so every collab handler sees socket.data.user.
io.use(socketAuthMiddleware);
registerCollabHandlers(io);

server.listen(PORT, () => {
  console.log(`[server] running on ${PORT}`);
});