# TERN WebSocket / Socket.IO Documentation

## Connection

**URL:** `ws://localhost:3000` (local) / `wss://hammerhead-app-t8l9y.ondigitalocean.app` (production)

**Transport:** WebSocket with polling fallback

### Authentication Handshake

Pass the JWT as `auth.token` in the Socket.IO connection options:

```javascript
import { io } from "socket.io-client";

const socket = io("http://localhost:3000", {
  auth: { token: "<jwt_from_login>" },
  transports: ["websocket", "polling"],
});
```

The server validates the JWT and rejects the connection with `401` if invalid or missing.

---

## Room Lifecycle

```
Client                          Server
  |                               |
  |--- room:join ---------------→ |  (join the model's collaboration room)
  |← presence:sync -------------- |  (full roster of current online users)
  |← activity:recent ------------ |  (last N activity entries for the model)
  |                               |
  |    ← presence:join -----→     |  (broadcast to other room members)
  |                               |
  |--- cursor:move -----→         |  (throttled, 50ms)
  |    ← cursor:move ------→      |  (broadcast to other room members)
  |                               |
  |--- lock:acquire -----→        |
  |← lock:acquired / lock:denied  |
  |    ← lock:acquired ----→      |  (broadcast to other room members)
  |                               |
  |--- entity:patch -----→        |  (coalesced, 20ms)
  |    ← entity:patch -----→      |  (broadcast to other room members)
  |                               |
  |--- lock:release -----→        |
  |    ← lock:released ----→      |  (broadcast to all room members)
  |                               |
  |  [disconnect]                 |
  |    ← presence:leave ---→      |  (broadcast to other room members)
  |    ← lock:released ----→      |  (all locks released on disconnect)
```

---

## Events: Client → Server (Emitted)

### `room:join`

Join a model's collaboration room. Must be sent before any other room-scoped event.

**Payload:**
```json
{
  "modelName": "BMRG Rainforests"
}
```
or
```json
{
  "modelId": 42
}
```

**Server response:** emits `presence:sync` + `activity:recent` back to caller; emits `presence:join` to other room members.

**Validation error:** emits `error:validation` if neither `modelName` nor `modelId` is provided.

---

### `cursor:move`

Broadcast the client's cursor position to other room members. Throttled to one broadcast per 50 ms (last value wins).

**Payload:**
```json
{
  "modelName": "BMRG Rainforests",
  "x": 412.5,
  "y": 200.0
}
```

**Server broadcasts to room:** `cursor:move` with `{userId, color, x, y}`

**Requires:** `room:join` sent first, and caller must be the active socket for their user in the room.

---

### `viewport:update`

Broadcast the client's canvas viewport to other room members. Throttled to one broadcast per 50 ms.

**Payload:**
```json
{
  "modelName": "BMRG Rainforests",
  "x": -100.0,
  "y": -50.0,
  "zoom": 1.25
}
```

**Server broadcasts to room:** `viewport:update` with `{userId, x, y, zoom}`

---

### `lock:acquire`

Request an exclusive editing lock on a specific entity (node or edge) within a model.

**Payload:**
```json
{
  "modelName": "BMRG Rainforests",
  "entityType": "node",
  "entityId": 101
}
```

**`entityType`**: `"node"` | `"edge"`

**Server response:**
- **Success:** emits `lock:acquired` to **all room members** (including caller)
- **Denied:** emits `lock:denied` only to caller
- **Model review-locked:** emits `error:lock` to caller
- **Not in room:** emits `error:validation` to caller

---

### `lock:release`

Release an entity lock held by the caller.

**Payload:**
```json
{
  "modelName": "BMRG Rainforests",
  "entityType": "node",
  "entityId": 101
}
```

**Server broadcasts to room:** `lock:released` if the lock existed and was deleted.

---

### `entity:patch`

Broadcast a field-level change to an entity. Caller must hold the lock on the entity. Patches are coalesced within a 20 ms window (last value wins per field).

**Payload:**
```json
{
  "modelName": "BMRG Rainforests",
  "entityType": "node",
  "entityId": 101,
  "field": "state_name",
  "value": "Degraded Woodland"
}
```

**Server broadcasts to room (excluding caller):** `entity:patch` with `{entityType, entityId, field, value, userId}`

**Requires:** caller must hold the lock on `(entityType, entityId)` in this model.

---

## Events: Server → Client (Received)

### `presence:sync`

Sent to the joining client only. Full snapshot of who is currently in the room.

**Payload:**
```json
{
  "users": [
    { "userId": 1, "email": "alice@example.com", "role": "Editor", "color": "#EF4444" },
    { "userId": 2, "email": "bob@example.com",   "role": "Viewer", "color": "#3B82F6" }
  ]
}
```

---

### `presence:join`

Broadcast to existing room members when a new user joins.

**Payload:**
```json
{ "user": { "userId": 3, "email": "carol@example.com", "role": "Editor", "color": "#22C55E" } }
```

---

### `presence:leave`

Broadcast to remaining room members when a user disconnects.

**Payload:**
```json
{ "userId": 3 }
```

---

### `activity:recent`

Sent to the joining client only. Last N activity entries for the model.

**Payload:**
```json
{
  "activity": [
    { "id": 55, "action": "model_saved", "entityType": null, "entityId": null,
      "detail": { "modelId": 42 }, "createdAt": "2026-04-28T10:00:00.000Z",
      "user": { "id": 1, "email": "alice@example.com" } }
  ]
}
```

---

### `activity:new`

Broadcast to all room members when any collaborative action occurs (comment posted, milestone created, model saved, node/edge deleted, etc.).

**Payload:**
```json
{
  "entry": {
    "id": 56,
    "action": "comment_added",
    "entityType": "node",
    "entityId": 101,
    "detail": { "body": "Check this state condition" },
    "createdAt": "2026-04-28T10:05:00.000Z",
    "user": { "id": 2, "email": "bob@example.com" }
  }
}
```

**`action` values:** `model_saved`, `model_deleted`, `model_cloned_from_template`, `node_deleted`, `edge_deleted`, `comment_added`, `milestone_created`, `model_restored`, `template_flag_updated`

---

### `cursor:move`

Broadcast from server to room members (excluding sender) with throttled cursor position.

**Payload:**
```json
{ "userId": 1, "color": "#EF4444", "x": 412.5, "y": 200.0 }
```

---

### `viewport:update`

Broadcast from server to room members (excluding sender) with throttled viewport.

**Payload:**
```json
{ "userId": 1, "x": -100.0, "y": -50.0, "zoom": 1.25 }
```

---

### `lock:acquired`

Broadcast to **all** room members (including the requester) when a lock is successfully acquired.

**Payload:**
```json
{
  "entityType": "node",
  "entityId": 101,
  "modelName": "BMRG Rainforests",
  "userId": 1,
  "lockedBy": "alice@example.com",
  "color": "#EF4444"
}
```

---

### `lock:denied`

Sent only to the requester when a lock is already held by another user.

**Payload:**
```json
{
  "entityType": "node",
  "entityId": 101,
  "modelName": "BMRG Rainforests",
  "lockedBy": "bob@example.com"
}
```

---

### `lock:released`

Broadcast to all room members when a lock is released (explicit release or disconnect cleanup).

**Payload:**
```json
{
  "entityType": "node",
  "entityId": 101,
  "modelName": "BMRG Rainforests"
}
```

---

### `entity:patch`

Broadcast to room members (excluding the sender) when an entity field changes.

**Payload:**
```json
{
  "entityType": "node",
  "entityId": 101,
  "field": "state_name",
  "value": "Degraded Woodland",
  "userId": 1
}
```

---

### `comment:new`

Broadcast to all room members when a new comment is posted via `POST /collab/:modelName/comments`.

**Payload:**
```json
{
  "comment": {
    "id": 77,
    "modelName": "BMRG Rainforests",
    "entityType": "node",
    "entityId": 101,
    "body": "Check this state condition",
    "authorId": 2,
    "createdAt": "2026-04-28T10:05:00.000Z"
  },
  "entityType": "node",
  "entityId": 101
}
```

---

### `milestone:created`

Broadcast to all room members when a new milestone is created via `POST /collab/:modelName/milestones`.

**Payload:**
```json
{
  "id": 12,
  "modelName": "BMRG Rainforests",
  "label": "Sprint 1 baseline",
  "snapshot": { ... },
  "createdBy": 1,
  "createdAt": "2026-04-28T11:00:00.000Z"
}
```

---

### `model:restored`

Broadcast to all room members when a model is restored from a milestone via `POST /collab/:modelName/milestones/:id/restore`.

**Payload:**
```json
{
  "milestoneId": 12,
  "label": "Sprint 1 baseline",
  "restoredBy": "alice@example.com"
}
```

---

### `error:validation`

Sent to the caller only when a socket event payload fails validation.

**Payload:**
```json
{ "message": "lock:acquire requires { entityType, entityId, modelName }" }
```

---

### `error:lock`

Sent to the caller only when a lock or patch is attempted on a review-locked model.

**Payload:**
```json
{
  "reason": "model_locked",
  "message": "Model is locked for review",
  "is_locked": true,
  "locked_by": "admin@example.com",
  "locked_at": "2026-04-27T09:00:00.000Z",
  "lock_reason": "Approved for publication"
}
```

---

### `error:patch`

Sent to the caller only when an `entity:patch` is rejected (no lock / wrong owner).

**Payload:**
```json
{ "reason": "not_owner" }
```

---

## Disconnect Cleanup

On client disconnect, the server automatically:
1. Releases **all collab locks** held by that user across all models.
2. Broadcasts `lock:released` for each released lock to the affected rooms.
3. Calls `leaveRoom` for each room, broadcasting `presence:leave` to remaining members.
4. Cancels any pending throttled cursor/viewport broadcasts for that socket.
5. Cancels any pending patch coalescing timers for that socket.

---

## REST ↔ Socket Event Cross-Reference

| REST Action | Socket Event Broadcast |
|---|---|
| `POST /collab/:model/comments` | `comment:new`, `activity:new` |
| `POST /collab/:model/milestones` | `milestone:created`, `activity:new` |
| `POST /collab/:model/milestones/:id/restore` | `model:restored`, `activity:new` |
| `POST /models/save` | `activity:new` |
| `DELETE /models/:name/states/:stateId` | `activity:new` |
| `DELETE /models/:name/transitions/:transitionId` | `activity:new` |

---

## Implementation Notes

- **Lock TTL (REST):** REST-acquired model-level locks expire after 120 seconds. Use `POST /models/:name/lock/renew` to refresh.
- **Lock TTL (Socket):** Socket-acquired entity-level locks persist until explicitly released or the socket disconnects.
- **In-memory lock cache:** `src/collab/lockCache.ts` caches ownership in memory for fast `entity:patch` validation. Cache entries are evicted on release/disconnect. In a multi-instance deployment this cache is per-instance — use Redis for cross-instance correctness.
- **Cursor throttle:** 50 ms debounce (`COLLAB_THROTTLE_MS`)
- **Patch coalesce:** 20 ms last-write-wins window (`PATCH_COALESCE_MS`)
