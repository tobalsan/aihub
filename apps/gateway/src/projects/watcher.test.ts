import { describe, expect, it } from "vitest";
import { inferProjectIdFromDirName } from "./watcher.js";

describe("project watcher id inference", () => {
  it("extracts PRO id from project directory name", () => {
    expect(
      inferProjectIdFromDirName(
        "PRO-159_need_immediate_feedback_when_clicking_stop"
      )
    ).toBe("PRO-159");
  });

  it("returns directory prefix for non-standard names", () => {
    expect(inferProjectIdFromDirName("sample_project")).toBe("sample");
  });

  it("returns exact value when no separator exists", () => {
    expect(inferProjectIdFromDirName("PRO-200")).toBe("PRO-200");
  });
});
