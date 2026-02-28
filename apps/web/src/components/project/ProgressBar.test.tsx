// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render } from "solid-js/web";
import { ProgressBar } from "./ProgressBar";

describe("ProgressBar", () => {
  it("renders task fraction", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const dispose = render(() => <ProgressBar done={3} total={7} />, container);

    expect(container.textContent).toContain("3/7 tasks");

    dispose();
  });
});
