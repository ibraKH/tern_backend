import http from 'http';

import app from './app';
import { initIo } from './socket';
import { socketAuthMiddleware } from './collab/auth.middleware';
import { registerCollabHandlers } from './collab/socket';

const PORT = process.env.PORT || 3000;
const frontendUrl = process.env.FRONTEND_URL;

if (!frontendUrl) {
  throw new Error(
    '[config] FRONTEND_URL is required to start the server (used for Socket.IO CORS). Add it to your .env file, e.g. FRONTEND_URL=http://localhost:5173'
  );
}

const server = http.createServer(app);
const io = initIo(server, frontendUrl);
io.use(socketAuthMiddleware);
registerCollabHandlers(io);

server.listen(PORT, () => {
  console.log(`[server] running on ${PORT}`);
});