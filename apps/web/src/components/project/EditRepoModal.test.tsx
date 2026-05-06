// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "solid-js/web";
import { createSignal, Show } from "solid-js";
import { EditRepoModal } from "./EditRepoModal";

function wait() {
  return new Promise<void>((resolve) => setTimeout(resolve, 0));
}

function setup(
  options: {
    initialRepo?: string;
    onSave?: ReturnType<typeof vi.fn>;
  } = {}
) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const onClose = vi.fn();
  const showToast = vi.fn();
  const onSave =
    options.onSave ??
    vi.fn(async () => ({
      frontmatter: { repo: options.initialRepo ?? "/tmp/repo" },
      repoValid: true,
    }));
  const dispose = render(
    () => (
      <EditRepoModal
        initialRepo={options.initialRepo ?? "/tmp/repo"}
        onClose={onClose}
        onSave={onSave}
        showToast={showToast}
        getErrorMessage={() => "Path not found"}
      />
    ),
    container
  );
  return { container, dispose, onClose, onSave, showToast };
}

describe("EditRepoModal", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  it("renders with input pre-filled from props", async () => {
    const { container, dispose } = setup({ initialRepo: "/Users/thinh/code" });
    await wait();

    const input = container.querySelector(
      ".edit-repo-modal__input"
    ) as HTMLInputElement;
    expect(input.value).toBe("/Users/thinh/code");
    expect(document.activeElement).toBe(input);

    dispose();
  });

  it("pressing Escape calls onClose and not onSave", async () => {
    const { dispose, onClose, onSave } = setup();
    await wait();

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSave).not.toHaveBeenCalled();
    dispose();
  });

  it("clicking the overlay calls onClose and not onSave", async () => {
    const { container, dispose, onClose, onSave } = setup();
    await wait();

    const overlay = container.querySelector(
      "[data-testid='edit-repo-overlay']"
    ) as HTMLDivElement;
    overlay.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSave).not.toHaveBeenCalled();
    dispose();
  });

  it("clicking the panel does not call onClose", async () => {
    const { container, dispose, onClose } = setup();
    await wait();

    const panel = container.querySelector(".edit-repo-modal") as HTMLElement;
    panel.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));

    expect(onClose).not.toHaveBeenCalled();
    dispose();
  });

  it("clicking Cancel calls onClose and not onSave", async () => {
    const { container, dispose, onClose, onSave } = setup();
    await wait();

    const cancel = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "Cancel"
    ) as HTMLButtonElement;
    cancel.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSave).not.toHaveBeenCalled();
    dispose();
  });

  it("clicking Save calls onSave with the input value", async () => {
    const { container, dispose, onSave } = setup();
    await wait();

    const input = container.querySelector(
      ".edit-repo-modal__input"
    ) as HTMLInputElement;
    input.value = "/tmp/next";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    const save = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "Save"
    ) as HTMLButtonElement;
    save.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await wait();

    expect(onSave).toHaveBeenCalledWith("/tmp/next");
    dispose();
  });

  it("keeps modal mounted and shows inline error on repoValid false", async () => {
    const onSave = vi.fn(async () => ({
      frontmatter: { repo: "/tmp/missing" },
      repoValid: false,
    }));
    const { container, dispose, onClose, showToast } = setup({ onSave });
    await wait();

    const save = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "Save"
    ) as HTMLButtonElement;
    save.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await wait();

    expect(container.querySelector(".edit-repo-modal")).not.toBeNull();
    expect(container.textContent).toContain("⚠ Path not found");
    expect(onClose).not.toHaveBeenCalled();
    expect(showToast).not.toHaveBeenCalled();
    dispose();
  });

  it("closes and toasts on repoValid true", async () => {
    const onSave = vi.fn(async () => ({
      frontmatter: { repo: "/tmp/repo" },
      repoValid: true,
    }));
    const { container, dispose, onClose, showToast } = setup({ onSave });
    await wait();

    const save = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "Save"
    ) as HTMLButtonElement;
    save.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await wait();

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(showToast).toHaveBeenCalledWith("Repo set to /tmp/repo", "success");
    dispose();
  });

  it("focus trap loops from Save back to input", async () => {
    const { container, dispose } = setup();
    await wait();

    const input = container.querySelector(
      ".edit-repo-modal__input"
    ) as HTMLInputElement;
    const save = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "Save"
    ) as HTMLButtonElement;
    save.focus();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab" }));

    expect(document.activeElement).toBe(input);
    dispose();
  });

  it("success close unmounts when parent owns open state", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const [open, setOpen] = createSignal(true);
    const dispose = render(
      () => (
        <Show when={open()}>
          <EditRepoModal
            initialRepo="/tmp/repo"
            onClose={() => setOpen(false)}
            onSave={async () => ({
              frontmatter: { repo: "/tmp/repo" },
              repoValid: true,
            })}
            showToast={() => {}}
          />
        </Show>
      ),
      container
    );
    await wait();

    const save = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "Save"
    ) as HTMLButtonElement;
    save.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await wait();

    expect(container.querySelector(".edit-repo-modal")).toBeNull();
    dispose();
  });
});
