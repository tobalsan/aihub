type AreaEditDraft = {
  title: string;
  color: string;
  order: string;
  repo: string;
};

type AreaEditFormProps = {
  draft: AreaEditDraft;
  saving: boolean;
  error: string | null;
  onChange: (patch: Partial<AreaEditDraft>) => void;
  onSave: () => void;
  onCancel: () => void;
};

export function AreaEditForm(props: AreaEditFormProps) {
  return (
    <form
      class="area-edit-form"
      onSubmit={(event) => {
        event.preventDefault();
        props.onSave();
      }}
    >
      <label class="area-edit-label">
        <span>Title</span>
        <input
          class="area-edit-input"
          type="text"
          value={props.draft.title}
          onInput={(event) =>
            props.onChange({ title: event.currentTarget.value })
          }
          required
        />
      </label>
      <div class="area-edit-row">
        <label class="area-edit-label">
          <span>Color</span>
          <input
            class="area-edit-input area-edit-color"
            type="text"
            value={props.draft.color}
            onInput={(event) =>
              props.onChange({ color: event.currentTarget.value })
            }
            placeholder="#3b82f6"
            required
          />
        </label>
        <label class="area-edit-label">
          <span>Order</span>
          <input
            class="area-edit-input"
            type="number"
            value={props.draft.order}
            onInput={(event) =>
              props.onChange({ order: event.currentTarget.value })
            }
            placeholder="1"
          />
        </label>
      </div>
      <label class="area-edit-label">
        <span>Repo path</span>
        <input
          class="area-edit-input"
          type="text"
          value={props.draft.repo}
          onInput={(event) =>
            props.onChange({ repo: event.currentTarget.value })
          }
          placeholder="~/code/repo"
        />
      </label>
      {props.error && <div class="area-edit-error">{props.error}</div>}
      <div class="area-edit-actions">
        <button
          class="area-edit-btn save"
          type="submit"
          disabled={props.saving}
        >
          {props.saving ? "Saving..." : "Save"}
        </button>
        <button
          class="area-edit-btn cancel"
          type="button"
          onClick={props.onCancel}
          disabled={props.saving}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

export type { AreaEditDraft };
