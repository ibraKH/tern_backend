import pool from "../../../src/config/database";
import { getAllModels, getModelByName } from "../../../src/services/models.service";

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
