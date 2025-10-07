import { normalizeReleaseDate, buildDynamicUpdate, upsertModelMetadata, upsertContributors, upsertStates, upsertTransitions, saveModel } from "../../../src/services/models/save.service";
import pool from "../../../src/config/database";
import { getAllModels, getModelByName } from "../../../src/services/models/show.service";
import { Contributor } from "../../../src/types/models.types";

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
    expect(result).toEqual({"202": 202});
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

describe("upsertContributors", () => {
  const mockClient = { query: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("inserts new contributor when not found, then links role", async () => {
    const contributors: Contributor[] = [
      { name: "Bob", email: "bob@test.com", contribution_type: "Reviewer" },
    ];


    mockClient.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 101 }] })
      .mockResolvedValueOnce(undefined);

    await upsertContributors(mockClient as any, 20, contributors);

    expect(mockClient.query).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("SELECT id FROM contributors"),
      ["bob@test.com"]
    );
    expect(mockClient.query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("INSERT INTO contributors"),
      ["Bob", "bob@test.com"]
    );
    expect(mockClient.query).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining("INSERT INTO model_contributions"),
      [20, 101, "Reviewer"]
    );
  });

  it("uses existing contributor when email exists (no insert into contributors)", async () => {
    const contributors: Contributor[] = [
      { name: "Carol", email: "carol@test.com", contribution_type: "Reviewer" },
    ];

    mockClient.query
      .mockResolvedValueOnce({ rows: [{ id: 55 }] })
      .mockResolvedValueOnce(undefined);

    await upsertContributors(mockClient as any, 33, contributors);

    expect(mockClient.query).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("SELECT id FROM contributors"),
      ["carol@test.com"]
    );
    expect(
      (mockClient.query as jest.Mock).mock.calls.some(([sql]: any[]) =>
        (sql as string).includes("INSERT INTO contributors")
      )
    ).toBe(false);

    expect(mockClient.query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("INSERT INTO model_contributions"),
      [33, 55, "Reviewer"]
    );
  });

  it("updates existing contributor when contributor_id provided, then links role", async () => {
    const contributors: Contributor[] = [
      {
        name: "Alice",
        email: "alice@test.com",
        contribution_type: "Author",
        contributor_id: 77,
      },
    ];

    mockClient.query
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined);

    await upsertContributors(mockClient as any, 44, contributors);

    expect(mockClient.query).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("UPDATE contributors SET name = $1, email = $2 WHERE id = $3"),
      ["Alice", "alice@test.com", 77]
    );

    expect(mockClient.query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("INSERT INTO model_contributions"),
      [44, 77, "Author"]
    );
  });

  it("normalizes/trims email to lowercase before querying", async () => {
    const contributors: Contributor[] = [
      { name: "Bob", email: "  BOB@TesT.com  ", contribution_type: "Reviewer" },
    ];

    mockClient.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 101 }] })
      .mockResolvedValueOnce(undefined);

    await upsertContributors(mockClient as any, 20, contributors);

    expect(mockClient.query).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("SELECT id FROM contributors"),
      ["bob@test.com"]
    );
  });

  it("does nothing when contributors array is empty", async () => {
    await upsertContributors(mockClient as any, 30, []);
    expect(mockClient.query).not.toHaveBeenCalled();
  });
});


describe('upsertTransitions', () => {
  let mockClient: any;

  beforeEach(() => {
    mockClient = { query: jest.fn() };
  });

  it('should insert new transition, causal_chain, drivers, and chain_part', async () => {
    const stm_name = 'STM1';
    const stateMap = { 1: 101, 2: 102 };

    const transitions = [
      {
        start_state_id: 1,
        end_state_id: 2,
        transition_id: 10,
        time_25: 1,
        time_100: 2,
        likelihood_25: 0.25,
        likelihood_100: 0.5,
        transition_delta: 0.1,
        causal_chain: [
          {
            name: 'Chain A',
            chain_part: 'management intervention',
            drivers: [
              {
                driver: 'Driver A1',
                description: 'desc A1',
                driver_group: 'Group1',
              },
              {
                driver: 'Driver A2',
                description: 'desc A2',
                driver_group: 'Group2',
              },
            ],
          },
        ],
      },
    ];

    // --- mock database results (exact order matters) ---
    mockClient.query
      // transition insert
      .mockResolvedValueOnce({ rows: [{ id: 201 }] })
      // causal_chain insert
      .mockResolvedValueOnce({ rows: [{ id: 301 }] })
      // driver1 insert
      .mockResolvedValueOnce({ rows: [{ id: 401 }] })
      // SELECT from chain_part (empty)
      .mockResolvedValueOnce({ rows: [] })
      // chain_part insert
      .mockResolvedValueOnce({ rows: [{ id: 501 }] })
      // driver2 insert
      .mockResolvedValueOnce({ rows: [{ id: 402 }] })
      // SELECT from chain_part (empty)
      .mockResolvedValueOnce({ rows: [] })
      // chain_part insert
      .mockResolvedValueOnce({ rows: [{ id: 502 }] });

    const result = await upsertTransitions(mockClient, stm_name, transitions, stateMap);

    // --- assertions ---
    expect(result).toEqual([201]);
    expect(mockClient.query).toHaveBeenCalledTimes(8);

    // Verify transition insert
    expect(mockClient.query).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('INSERT INTO transitions'),
      expect.arrayContaining([stm_name, 101, 102])
    );

    // Verify causal_chain insert
    expect(mockClient.query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('INSERT INTO causal_chain'),
      expect.arrayContaining([201, 'Chain A', 'Management Intervention'])
    );

    // Verify driver inserts
    expect(mockClient.query).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining('INSERT INTO drivers'),
      expect.arrayContaining(['Driver A1', 'desc A1', 'Group1'])
    );
    expect(mockClient.query).toHaveBeenNthCalledWith(
      6,
      expect.stringContaining('INSERT INTO drivers'),
      expect.arrayContaining(['Driver A2', 'desc A2', 'Group2'])
    );

    // Verify chain_part inserts
    expect(mockClient.query).toHaveBeenNthCalledWith(
      5,
      expect.stringContaining('INSERT INTO chain_part'),
      [301, 401]
    );
    expect(mockClient.query).toHaveBeenNthCalledWith(
      8,
      expect.stringContaining('INSERT INTO chain_part'),
      [301, 402]
    );
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