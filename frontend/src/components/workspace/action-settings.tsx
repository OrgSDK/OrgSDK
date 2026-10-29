import type { Action } from "../../api/types";
import { formText } from "../../lib/form-fields";
import type { ReactNode } from "react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
export function ActionSettings({
  action,
  isBusy,
  save,
}: {
  action: Action;
  isBusy: boolean;
  save: (body: { name: string; description: string; enabled: boolean }) => void;
}): ReactNode {
  return (
    <details className="panel">
      <summary>Action settings</summary>
      <form
        className="mt-4"
        onSubmit={(event) => {
          event.preventDefault();
          const fields = new FormData(event.currentTarget);
          save({
            name: formText(fields, "name"),
            description: formText(fields, "description"),
            enabled: fields.has("enabled"),
          });
        }}
      >
        <label>
          Action name
          <Input
            name="name"
            required
            defaultValue={action.name}
            disabled={isBusy}
          />
        </label>
        <label>
          Description
          <Input
            name="description"
            defaultValue={action.description}
            disabled={isBusy}
          />
        </label>
        <label className="check">
          <input
            name="enabled"
            type="checkbox"
            defaultChecked={action.enabled}
            disabled={isBusy}
          />
          Enabled for new runs
        </label>
        <p className="small">
          Disable an action to prevent new runs while preserving its saved
          versions and run history.
        </p>
        <div className="row">
          <Button type="submit" disabled={isBusy}>
            Save action settings
          </Button>
        </div>
      </form>
    </details>
  );
}
