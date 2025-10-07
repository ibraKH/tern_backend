### Prerequisites
- Node.js 18+
- **EITHER**: PostgreSQL running locally **OR** Docker + Docker Compose

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
PG_HOST=db
PG_USER=app
PG_PASSWORD=app
PG_DB=app_db
DATABASE_URL=postgres://${PG_USER}:${PG_PASSWORD}@${PG_HOST}:5432/${PG_DB}
```

> If you’re running Postgres **locally**, set `PG_HOST=localhost` (or just set `DATABASE_URL=postgres://user:pass@localhost:5432/yourdb`).

--- 

## Run (Local, no Docker)
```bash
npm run dev
npm run build
npm start
```

---

## Run (Docker)
> Uses the provided `Dockerfile` and `docker-compose.yml`.
```bash
# 1) Build images and start containers
docker compose up -d --build

# 2) See logs
docker compose logs -f app

# 3) Stop
docker compose down
# to remove db volume/data:
# docker compose down -v
```
### Create tables (no migrations yet)
Open psql inside the DB container and run your `CREATE TABLE ...`:
```bash
docker exec -it app_postgres psql -U ${PG_USER:-app} -d ${PG_DB:-app_db}
```

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

#### `GET /models/:name` (protected)
**Headers**
```
Authorization: Bearer <JWT_TOKEN>
```

**Response**
```json
{
    "stm_name": "GEN Eucalypt forest and woodlands",
    "version": "1.0",
    "release_date": "2025-02-23T13:00:00.000Z",
    "authorised_by": "Anna Richards",
    "contributing_experts": [
        {
            "name": "Megan Good",
            "email": "megan.good@goodecology.net",
            "contibution_type": "Author"
        }
    ],
    "region": "Test Region",
    "region_id": null,
    "climate": "Various",
    "ecosystem_type": "Eucalypt Forest and Woodlands",
    "aus_eco_archetype_code": "1001",
    "aus_eco_archetype_name": "Not applicable",
    "aus_eco_umbrella_code": 9999,
    "peer_reviewed": "no",
    "no_peer_reviewers": 0,
    "states": [
        {
            "state_id": 1,
            "state_name": "Reference overstorey with reference understorey",
            "vast_state": {
                "vast_class": "ClassI",
                "vast_name": "Residual",
                "vast_eks_state": null,
                "eks_overstorey_class": "Reference overstorey",
                "eks_understorey_class": "Reference understorey",
                "eks_substate": "Reference overstorey and understorey",
                "link": ""
            },
            "condition_upper": 1,
            "condition_lower": 0.76,
            "eks_condition_estimate": null,
            "elicitation_type": "NEAP estimate",
            "attributes": [
                {
                    "attribute_type": "max_canopy_height",
                    "value": "30",
                    "units": "m"
                }
            ]
        },
        {
            "state_id": 2,
            "state_name": "Reference overstorey with modified understorey",
            "vast_state": {
                "vast_class": "ClassI",
                "vast_name": "Residual",
                "vast_eks_state": null,
                "eks_overstorey_class": "Reference overstorey",
                "eks_understorey_class": "Reference understorey",
                "eks_substate": "Reference overstorey and understorey",
                "link": ""
            },
            "condition_upper": 0.75,
            "condition_lower": 0.51,
            "eks_condition_estimate": null,
            "elicitation_type": "NEAP estimate",
            "attributes": [
                {
                    "attribute_type": "native_forb_richness",
                    "value": "15",
                    "units": "species"
                }
            ]
        }
    ],
    "transitions": [
        {
            "transition_id": 1,
            "stm_name": "GEN Eucalypt forest and woodlands",
            "start_state": "Reference overstorey with reference understorey",
            "start_state_id": 1,
            "end_state": "Reference overstorey with modified understorey",
            "end_state_id": 2,
            "time_25": 1,
            "time_100": 1,
            "likelihood_25": null,
            "likelihood_100": null,
            "notes": "",
            "causal_chain": [
                {
                    "name": "management driver",
                    "chain_part": "Management Intervention",
                    "driver_id": 1
                }
            ],
            "transition_delta": null
        }
    ],
    "method_alignment": ""
}
```

#### `POST /models/save` (protected)
**Headers**
```
Authorization: Bearer <JWT_TOKEN>
```

**Body for save all**
 
```json
{
  "stm_name": "BMRG Rainforests Test",
  "version": "pre peer review",
  "release_date": "Aug-24",
  "authorised_by": "Megan Good",
  "contributing_experts": [
    {
      "name": "add",
      "email": "add@test.com",
      "contribution_type": "Author"
    }
  ],
  "region": "",
  "region_id": 1,
  "climate": "Tropical",
  "ecosystem_type": "Rainforests",
  "aus_eco_archetype_code": 1.2,
  "aus_eco_archetype_name": "Non-marine influenced rainforest and vine thickets",
  "aus_eco_umbrella_code": 1.0,
  "peer_reviewed": "",
  "no_peer_reviewers": -9999,
  "states": [
    {
      "fake_state_id": 1,
      "state_name": "Reference",
      "vast_state": {
        "vast_class": "Class I",
        "vast_name": "Residual",
        "vast_eks_state": 1,
        "eks_overstorey_class": "Reference overstorey",
        "eks_understorey_class": "Reference understorey",
        "eks_substate": "Reference overstorey and reference understorey",
        "link": ""
      },
      "condition_upper": 1.0,
      "condition_lower": 0.9,
      "eks_condition_estimate": -9999,
      "elicitation_type": "pilot region",
      "attributes": [
        {
          "attribute_type": "native_canopy_dominance",
          "value": "90",
          "units": "%"
        }
      ]
    },
    {
      "fake_state_id": 2,
      "state_name": "Reference overstorey, modified understorey",
      "vast_state": {
        "vast_class": "Class II",
        "vast_name": "Modified",
        "vast_eks_state": 2,
        "eks_overstorey_class": "Reference overstorey",
        "eks_understorey_class": "Modified understorey",
        "eks_substate": "Reference overstorey with modified understorey",
        "link": ""
      },
      "condition_upper": 0.9,
      "condition_lower": 0.75,
      "eks_condition_estimate": -9999,
      "elicitation_type": "pilot region",
      "attributes": null
    }
  ],
  "transitions": [
    {
      "start_state": "Reference",
      "start_state_id": 1,
      "end_state": "Reference overstorey, modified understorey",
      "end_state_id": 2,
      "time_25": 1,
      "time_100": 0,
      "likelihood_25": -9999,
      "likelihood_100": -9999,
      "notes": "",
      "causal_chain": [
        {
          "chain_part": "management intervention",
          "drivers": [
            {
              "driver": "Weed management - physical, chemical, ecological",
              "driver_group": "Weeds and exotic plants"
            },
            {
              "driver": "Weed control - reduction in weed propagules in landscape",
              "driver_group": "Landscape"
            },
            {
              "driver": "Manage and maintain appropriate total grazing pressure (includes native and introduced herbivores, and 'ferals')",
              "driver_group": "Fauna and livestock"
            },
            {
              "driver": "Exclude livestock",
              "driver_group": "Fauna and livestock"
            }
          ]
        },
        {
          "chain_part": "hazard",
          "drivers": [
            {
              "driver": "Unfavourable climatic conditions (drought, heat)",
              "driver_group": "Environmental drivers"
            },
            {
              "driver": "High intensity fire (catastrophic wildfire, bushfire)",
              "driver_group": "Fire"
            }
          ]
        },
        {
          "chain_part": "biotic process",
          "drivers": [
            {
              "driver": "Native propagules available (soil seedbank or local species pool)",
              "driver_group": "Biotic process"
            }
          ]
        }
      ],
      "transition_delta": 0.03
    },
    {
      "start_state": "Reference overstorey, modified understorey",
      "start_state_id": 2,
      "end_state": "Reference overstorey, highly modified understorey",
      "end_state_id": 1,
      "time_25": 1,
      "time_100": 0,
      "likelihood_25": -9999,
      "likelihood_100": -9999,
      "notes": "",
      "causal_chain": [
        {
          "chain_part": "management intervention",
          "drivers": [
            {
              "driver": "Total grazing pressure (including livestock and feral animals) exceeds that to maintain <Ecosystem State> understorey",
              "driver_group": "Fauna and livestock"
            },
            {
              "driver": "Increased or ongoing edge effects (light levels, temperature, exotic propagules, feral animal incursions)",
              "driver_group": "Biotic process"
            }
          ]
        }
      ],
      "transition_delta": 0.0
    }
  ],
  "method_alignment": "None"
}
```

**Response**
```json
{
    "success": true,
    "modelId": {
        "modelId": 1
    }
}
```

**Body for edit stmmodel (example)**
 
```json
{
  "id": 1,
  "stm_name": "Test edit",
  "version": "v1.1",
  "release_date": "Oct-11",
  "authorised_by": "Test Edit"
}
```
**Body for edit contributors (example)**
 
```json
{
  "id": 1,
  "contributing_experts": [
    {
      "name": "add",
      "email": "add@test.com",
      "contribution_type": "Author"
    },
    {
      "contributor_id": 1,
      "name": "edit",
      "email": "edit@test.com",
      "contribution_type": "Reviewer"
    }
  ]
}
```
**Body for update  driver, causal_chain and transitions  (example)**
 
```json
{
  "id": 1,
  "states": [
    {
      "fake_state_id": 10,
      "state_name": "test_add_new_state",
      "vast_state": {
        "vast_state_id": 2
      }
    }
  ],
  "transitions": [
    {
      "id": 1,
      "start_state_id": 1,
      "end_state_id": 10,
      "likelihood_100": 0.1,
      "causal_chain": [
        {
          "causal_chain_id": 1,
          "chain_part": "hazard",
          "drivers": [
            {
              "driver_id": 1,
              "driver": "edit driver"
            }
          ]
        },
        {
          "chain_part": "biotic process",
          "drivers": [
            {
              "driver_id": 2
            },
            {
              "driver": "add driver"
            }
          ]
        }
      ]
    }
  ]
}
```
**Body for update states, vast_state, state_attributes  (example)**
 
```json
{
  "id": 1,
  "states": [
    {
      "state_id": 1,
      "attributes": [
        {
          "state_attribute_id": 1,
          "attribute_type": "native_canopy_dominance",
          "value": "90",
          "units": "edit%"
        }
      ]
    },
    {
      "state_id": 2,
      "state_name": "test_edit_state_name_with_id_2",
      "vast_state": {
        "vast_class": "Class III",
        "vast_name": "test_add_edit_vast_state",
        "vast_eks_state": 1
      }
    },
    {
      "fake_state_id": 3,
      "state_name": "test_add_new_state",
      "vast_state": {
        "vast_state_id": 2
      }
    }
  ]
}

```

---

Run tests:
```bash
# Local
npm test

# Docker (runs in app container)
docker compose run --rm app npm test -- --runInBand
```

---

## ⚠️ Error handling
- **404** → `{ "error": "Page not found" }`
- **500** → `{ "error": "Internal Server Error" }`
