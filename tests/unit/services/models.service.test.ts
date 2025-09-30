import { normalizeReleaseDate, buildDynamicUpdate, upsertModelMetadata, upsertContributors, upsertStates, upsertTransitions, saveModel } from "../../../src/services/models.service";
import pool from "../../../src/config/database";
import { getAllModels, getModelByName } from "../../../src/services/models.service";

describe('normalizeReleaseDate', () => {
    it('should normalize "Aug-24" to "2024-08-01"', () => {
        expect(normalizeReleaseDate("Aug-24")).toBe("2024-08-01");
        expect(normalizeReleaseDate("Oct-25")).toBe("2025-10-01");
    });

    it('should normalize ISO date string', () => {
        expect(normalizeReleaseDate("2024-09-29")).toBe("2024-09-29");
    });

    it('should return null if input is undefined', () => {
        expect(normalizeReleaseDate(undefined)).toBeNull();
    });

    it('should throw error for invalid format', () => {
        expect(() => normalizeReleaseDate("NotADate")).toThrow("Invalid release_date format");
    });
});

describe('buildDynamicUpdate', () => {
    const mockClient = {
        query: jest.fn().mockResolvedValue({ rows: [{ id: 1 }] }),
    };

    it('should build update query with provided fields', async () => {
        const result = await buildDynamicUpdate(mockClient, "stmmodel", "id", 1, {
            stm_name: "Test STM",
            climate: "Tropical",
            version: undefined, // should be skipped
            authorised_by: null, // should clear field
        });

        expect(mockClient.query).toHaveBeenCalledWith(
            expect.stringContaining("UPDATE stmmodel"),
            ["Test STM", "Tropical", null, 1]
        );
        expect(result).toBe(1);
    });

    it('should return id if no fields to update', async () => {
        const result = await buildDynamicUpdate(mockClient, "stmmodel", "id", 99, {
            stm_name: undefined,
        });
        expect(result).toBe(99);
    });

    it('should throw 404 error if no rows returned', async () => {
        mockClient.query.mockResolvedValueOnce({ rows: [] });
        await expect(
            buildDynamicUpdate(mockClient, "stmmodel", "id", 123, { stm_name: "X" })
        ).rejects.toMatchObject({ status: 404 });
    });
});

describe('upsertModelMetadata', () => {
    const mockClient = {
        query: jest.fn(),
    };

    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('should insert new model if no id', async () => {
        mockClient.query.mockResolvedValueOnce({ rows: [{ id: 42 }] });
        const modelData: any = {
            stm_name: "BMRG Rainforests",
            version: "pre peer review",
            release_date: "Aug-24",
            authorised_by: "Megan Good",
            region_id: null,
            climate: "Tropical",
            ecosystem_type: "Rainforests",
            aus_eco_archetype_code: "1.2",
            aus_eco_archetype_name: "Non-marine influenced rainforest",
            aus_eco_umbrella_code: 1,
            peer_reviewed: "No",
            no_peer_reviewers: 0,
        };

        const modelId = await upsertModelMetadata(mockClient, modelData);
        expect(modelId).toBe(42);
        expect(mockClient.query).toHaveBeenCalled();
    });

    it('should update model if id exists', async () => {
        mockClient.query.mockResolvedValueOnce({ rows: [{ id: 23 }] });

        const modelData: any = {
            id: 23,
            stm_name: "Test STM",
            release_date: "Aug-24",
        };

        const modelId = await upsertModelMetadata(mockClient, modelData);
        expect(modelId).toBe(23);
    });

    it('should throw conflict error if unique violation', async () => {
        const err: any = new Error("duplicate key");
        err.code = "23505";
        mockClient.query.mockRejectedValueOnce(err);

        const modelData: any = {
            stm_name: "Conflict Model",
            release_date: "2024-09-29",
        };

        await expect(upsertModelMetadata(mockClient, modelData)).rejects.toMatchObject({
            status: 409,
        });
    });
});

describe('upsertStates', () => {
    const mockClient = { query: jest.fn() };

    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('should insert new state with vast_state and attributes', async () => {
        mockClient.query
            .mockResolvedValueOnce({ rows: [{ id: 101 }] }) // vast_state insert
            .mockResolvedValueOnce({ rows: [{ id: 202 }] }) // state insert
            .mockResolvedValueOnce({ rows: [{ id: 303 }] }); // state_attributes insert

        const states = [
            {
                state_name: 'Rainforest',
                vast_state: { vast_class: 'Class I', vast_name: 'TestVast' },
                attributes: [
                    { attribute_type: 'max_canopy_height', value: '30', units: 'm' },
                ],
            },
        ];

        const result = await upsertStates(mockClient, 'STM1', states);

        expect(mockClient.query).toHaveBeenCalledWith(
            expect.stringContaining('INSERT INTO vast_states'),
            expect.any(Array),
        );
        expect(mockClient.query).toHaveBeenCalledWith(
            expect.stringContaining('INSERT INTO states'),
            expect.any(Array),
        );
        expect(mockClient.query).toHaveBeenCalledWith(
            expect.stringContaining('INSERT INTO state_attributes'),
            expect.any(Array),
        );
        expect(result).toEqual([202]);
    });

    it('should throw error for invalid elicitation_type', async () => {
        const states = [
            { state_name: 'BadState', elicitation_type: 'wrong type' },
        ];
        await expect(upsertStates(mockClient, 'STM1', states)).rejects.toThrow(
            'Invalid elicitation_type',
        );
    });
});

describe('upsertContributors', () => {
    const mockClient = { query: jest.fn() };

    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('should insert new contributors if contributor_id does not exist', async () => {
        const contributors = [
            { name: 'Bob', email: 'bob@test.com', contribution_type: 'Reviewer' },
        ];

        mockClient.query.mockResolvedValueOnce({ rows: [{ id: 101 }] });

        const result = await upsertContributors(mockClient, 20, contributors);

        expect(mockClient.query).toHaveBeenCalledWith(
            expect.stringContaining('INSERT INTO contributors'),
            [20, 'Bob', 'bob@test.com', 'Reviewer']
        );

        expect(result).toBeUndefined();
    });

    it('should do nothing if contributors array is empty', async () => {
        const result = await upsertContributors(mockClient, 30, []);
        expect(mockClient.query).not.toHaveBeenCalled();
        expect(result).toBeUndefined();
    });
});

describe('upsertTransitions', () => {
  const mockClient = { query: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should insert new transition, drivers, and causal_chain for multiple drivers', async () => {
    const transitions = [
      {
        start_state_id: 1,
        end_state_id: 2,
        transition_id: 1001,  
        time_100: 50,
        time_25: 25,
        likelihood_25: 0.3,
        likelihood_100: 0.8,
        transition_delta: 5,
        causal_chain: [
          {
            name: 'Chain1',
            chain_part: 'management intervention',
            drivers: [
              { driver: 'Driver1', description: 'Desc1', driver_group: 'Group1' },
              { driver: 'Driver2', description: 'Desc2', driver_group: 'Group2' }
            ]
          }
        ]
      }
    ];

mockClient.query
  .mockResolvedValueOnce({ rows: [{ id: 101 }] }) // transition insert
  .mockResolvedValueOnce({ rows: [{ id: 201 }] }) // driver1 insert
  .mockResolvedValueOnce({ rows: [{ id: 301 }] }) // causal_chain for driver1
  .mockResolvedValueOnce({ rows: [{ id: 202 }] }) // driver2 insert
  .mockResolvedValueOnce({ rows: [{ id: 302 }] }); // causal_chain for driver2

    const result = await upsertTransitions(mockClient, 'STM1', transitions);

    // transition insert
    expect(mockClient.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO transitions'),
      expect.arrayContaining([ 'STM1', 1, 2, 1001, 50, 25, 0.3, 0.8, 5 ])
    );

    // driver inserts
    expect(mockClient.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO drivers'),
      expect.arrayContaining([ 'Driver1', 'Desc1', 'Group1' ])
    );
    expect(mockClient.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO drivers'),
      expect.arrayContaining([ 'Driver2', 'Desc2', 'Group2' ])
    );

    expect(mockClient.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO causal_chain'),
      expect.arrayContaining([ 1001, 'Chain1', 'Management Intervention', 201 ])
    );
    expect(mockClient.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO causal_chain'),
      expect.arrayContaining([ 1001, 'Chain1', 'Management Intervention', 202 ])
    );

    expect(result).toEqual([101]);
  });

  it('should do nothing if transitions array is empty', async () => {
    const result = await upsertTransitions(mockClient, 'STM1', []);
    expect(mockClient.query).not.toHaveBeenCalled();
    expect(result).toEqual([]);
  });
});

jest.mock("../../../src/config/database", () => {
  const client = {
    query: jest.fn(),
    release: jest.fn(),
  };
  return {
    __esModule: true,
    default: {
      connect: jest.fn(async () => client),
      _client: client,
    },
  };
});

const client: any = (pool as any)._client;

describe("model.service", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("getAllModels()", () => {
    it("returns all model names", async () => {
      client.query.mockResolvedValueOnce({
        rows: [{ stm_name: "ModelA" }, { stm_name: "ModelB" }],
      });

      const models = await getAllModels();
      expect(client.query).toHaveBeenCalledWith(
        expect.stringContaining("SELECT stm_name FROM stmmodel"),
      );
      expect(models).toEqual(["ModelA", "ModelB"]);
    });
  });

  describe("getModelByName()", () => {
    it("returns full model data when found", async () => {
      // --- mock basic info ---
      client.query
        .mockResolvedValueOnce({
          rows: [
            {
              id: 1,
              stm_name: "ModelX",
              version: "1.0",
              release_date: "2025-01-01",
              authorised_by: "Dr. A",
              region: "Region1",
              region_id: 10,
              ecosystem_type: "Forest",
              aus_eco_archetype_code: "ARC1",
              aus_eco_archetype_name: "Archetype1",
              aus_eco_umbrella_code: "UMB1",
              peer_reviewed: true,
              no_peer_reviewers: 3,
              climate: "Tropical",
            },
          ],
        })
        // --- mock contributors ---
        .mockResolvedValueOnce({
          rows: [{ name: "Alice", email: "a@b.com", contibution_type: "author" }],
        })
        // --- mock states ---
        .mockResolvedValueOnce({
          rows: [
            {
              id: 100,
              state_name: "State1",
              eks_condition_estimate: "Good",
              condition_lower: 0.2,
              condition_upper: 0.8,
              ellictation_type: "Expert",
              vast_class: "V1",
              vast_name: "Vast1",
              eks_overstorey_class: "Tree",
              eks_understorey_class: "Shrub",
              eks_substate: "Sub1",
              link: "http://example.com",
            },
          ],
        })
        // --- mock attributes for state ---
        .mockResolvedValueOnce({
          rows: [{ attribute_type: "Height", value: 10, units: "m" }],
        })
        // --- mock transitions ---
        .mockResolvedValueOnce({
          rows: [
            {
              id: 200,
              stm_name: "ModelX",
              start_state_id: 100,
              end_state_id: 100,
              time_25: 5,
              time_100: 20,
              likelihood_25: 0.2,
              likelihood_100: 0.8,
              transition_delta: 0.6,
            },
          ],
        })
        // --- mock causal chain ---
        .mockResolvedValueOnce({
          rows: [{ name: "Fire", chain_part: "Driver", driver_id: 1 }],
        })
        // --- mock method alignment ---
        .mockResolvedValueOnce({
          rows: [{ method_name: "Method1" }],
        });

      const model = await getModelByName("ModelX");

      expect(client.query).toHaveBeenCalled();
      expect(model?.stm_name).toBe("ModelX");
      expect(model?.contributing_experts).toHaveLength(1);
      expect(model?.states[0].attributes[0].attribute_type).toBe("Height");
      expect(model?.transitions[0].causal_chain[0].name).toBe("Fire");
      expect(model?.method_alignment).toBe("Method1");
    });

    it("returns null when model not found", async () => {
      client.query.mockResolvedValueOnce({ rows: [] });
      const model = await getModelByName("NoSuchModel");
      expect(model).toBeNull();
    });
  });
});