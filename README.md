### Prerequisites
- Node.js 18+
- PostgreSQL running locally (or a connection string)

### Install
```bash
npm i    
```

### Environment
Create a `.env` file in the project root:

```env
# Server
PORT=3000
NODE_ENV=development

# JWT
JWT_SECRET="Write here"
JWT_EXPIRES_IN=1d
BCRYPT_SALT_ROUNDS="Write here"
BCRYPT_PEPPER="Write here"

# Database
DATABASE_URL=postgres://user:pass@localhost:5432/"yourdb"
```
--- 

### Run
```bash
npm run dev
npm run build
```

---

## 🔑 API Endpoints

### Auth

#### `POST /auth/signup`
**Body**
```json
{ "name": "Demo", "email": "demo@local", "password": "12345678" }
```

#### `POST /auth/login`
**Body**
```json
{ "email": "demo@local", "password": "12345678" }
```



### Models

#### `GET /models/all` (protected)
**Headers**
```
Authorization: Bearer <JWT_TOKEN>
```

**Response**
```json
["demo-stm", "forest-v1", "wetland-baseline"]
```

#### `POST /models/save` (protected)
**Headers**
```
Authorization: Bearer <JWT_TOKEN>
```

**Body**
```json
{
  "model_name": "demo-stm",
  "description": "tiny example",
  "states": [
    { "id": 1, "name": "Start" },
    { "id": 2, "name": "End" }
  ],
  "transitions": [
    { "id": 10, "from_state_id": 1, "to_state_id": 2, "label": "go" }
  ]
}
```

**Response**
```json
{ "success": true, "modelId": 101 }
```
#### `POST /models/:name` (protected)
**Headers**
```
Authorization: Bearer <JWT_TOKEN>
```

**Response**
```json
{
  "stm_name": "demo-stm",
  "version": "1.0",
  "release_date": "2025-08-24",
  "authorised_by": "Jane Doe",
  "contributing_experts": [{ "name": "Expert A", "email": "a@x.com", "contribution_type": "Reviewer" }],
  "region": "South",
  "region_id": 1,
  "climate": "Temperate",
  "ecosystem_type": "Forest",
  "aus_eco_archetype_code": "A1",
  "aus_eco_archetype_name": "Example",
  "aus_eco_umbrella_code": "U1",
  "peer_reviewed": true,
  "no_peer_reviewers": 2,
  "states": [
    {
      "state_id": 1,
      "state_name": "Start",
      "vast_state": {
        "vast_class": "Class I",
        "vast_name": "Open",
        "vast_eks_state": 0.8,
        "eks_overstorey_class": "High",
        "eks_understorey_class": "Low",
        "eks_substate": "S1",
        "link": "https://example.com"
      },
      "condition_upper": 0.9,
      "condition_lower": 0.7,
      "eks_condition_estimate": 0.8,
      "elicitation_type": "Pilot region",
      "attributes": []
    }
  ],
  "transitions": [
    {
      "transition_id": 10,
      "stm_name": "demo-stm",
      "start_state": "Start",
      "start_state_id": 1,
      "end_state": "End",
      "end_state_id": 2,
      "time_25": 1,
      "time_100": 4,
      "likelihood_25": 0.3,
      "likelihood_100": 0.8,
      "notes": "",
      "causal_chain": [],
      "transition_delta": 0.1
    }
  ],
  "method_alignment": ""
}
```
---

Run tests:
```bash
npm test
```

---

## ⚠️ Error handling
- **404** → `{ "error": "Page not found" }`
- **500** → `{ "error": "Internal Server Error" }`