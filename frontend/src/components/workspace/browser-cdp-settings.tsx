import type { ReactNode } from "react";
import type { Plugin } from "../../api/types";
import { Input } from "../ui/input";

const timeouts = [
  ["connectTimeoutMs", "Connection timeout (ms)", 15000],
  ["actionTimeoutMs", "Action timeout (ms)", 10000],
] as const;

export function BrowserCdpSettings({
  configuration,
  disabled,
  onChange,
}: {
  configuration: Plugin["configuration"];
  disabled: boolean;
  onChange: (key: string, value: string | number | undefined) => void;
}): ReactNode {
  const { cdpEndpoint, authMode, sessionId } = configuration;
  return (
    <fieldset className="space-y-3" disabled={disabled}>
      <label>
        Browser endpoint
        <Input
          type="url"
          value={typeof cdpEndpoint === "string" ? cdpEndpoint : ""}
          placeholder="http://localhost:9222"
          aria-describedby="browser-endpoint-help"
          onChange={(event) =>
            onChange("cdpEndpoint", event.target.value || undefined)
          }
        />
      </label>
      <p className="small" id="browser-endpoint-help">
        Enter the HTTP or WebSocket address of a running Chrome, Chromium, or
        Steel browser. The project runner must be able to reach it.
      </p>
      <label>
        Authentication
        <select
          value={typeof authMode === "string" ? authMode : "none"}
          onChange={(event) => onChange("authMode", event.target.value)}
        >
          <option value="none">None</option>
          <option value="bearer">Bearer token</option>
          <option value="steel">Steel Cloud API key</option>
        </select>
      </label>
      {authMode === "steel" || typeof sessionId === "string" ? (
        <label>
          Existing Steel session ID
          <Input
            value={typeof sessionId === "string" ? sessionId : ""}
            onChange={(event) =>
              onChange("sessionId", event.target.value || undefined)
            }
          />
        </label>
      ) : null}
      <details>
        <summary>Connection and action timeouts</summary>
        {timeouts.map(([key, label, defaultValue]) => {
          const value = configuration[key];
          return (
            <label key={key}>
              {label}
              <Input
                type="number"
                min={1}
                max={120000}
                value={typeof value === "number" ? value : ""}
                placeholder={String(defaultValue)}
                onChange={(event) =>
                  onChange(
                    key,
                    event.target.value ? event.target.valueAsNumber : undefined,
                  )
                }
              />
            </label>
          );
        })}
      </details>
    </fieldset>
  );
}
