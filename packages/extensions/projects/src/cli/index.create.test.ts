import { describe, expect, it } from "vitest";
import { resolveCreateArea } from "./index.js";

describe("resolveCreateArea", () => {
  it("returns a valid area id", async () => {
    const client = {
      listAreas: async () => [{ id: "aihub", title: "AIHub" }],
    };

    await expect(resolveCreateArea(client, "aihub")).resolves.toBe("aihub");
  });

  it("throws with valid ids when the area is unknown", async () => {
    const client = {
      listAreas: async () => [
        { id: "aihub", title: "AIHub" },
        { id: "ops", title: "Ops" },
      ],
    };

    await expect(resolveCreateArea(client, "bad-area")).rejects.toThrow(
      'Error: Invalid area "bad-area". Valid areas: aihub, ops'
    );
  });
});
