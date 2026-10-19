import { Chip, Group, Select, Stack, Switch, Text, TextInput } from "@mantine/core";
import { useEffect, useState } from "react";
import { STORAGE_PREFIX } from "../../layout/usePersistentFlag";
import {
  ACTIVE_HOURS_DEFAULT,
  API,
  deviceTimeZone,
  normalizeActiveHours,
  type ActiveHours,
} from "../../shared";

const STORAGE_KEY = `${STORAGE_PREFIX}notify-hours`;
const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function defaultHours(): ActiveHours {
  return {
    on: false,
    days: [...ACTIVE_HOURS_DEFAULT.days],
    start: ACTIVE_HOURS_DEFAULT.start,
    end: ACTIVE_HOURS_DEFAULT.end,
    zone: deviceTimeZone() || "UTC",
  };
}

function savedHours(): ActiveHours {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return (raw ? normalizeActiveHours(JSON.parse(raw)) : null) ?? defaultHours();
  } catch {
    return defaultHours();
  }
}

async function post(body: {
  endpoint: string;
  activeHours?: ActiveHours;
}): Promise<Response | null> {
  try {
    return await fetch(`./${API.pushSettings}`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    return null;
  }
}

const zones = (current: string): string[] => {
  const listed =
    (Intl as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf?.("timeZone") ??
    [];
  return [...new Set([current, ...listed])];
};

/**
 * Per-device quiet hours for notifications: outside the window, replies and questions are not
 * pushed to this device (an error still is). The gateway applies them; this device keeps a copy so
 * the form survives a gateway restart.
 */
export function NotificationHours({ endpoint }: { endpoint: string }) {
  const [hours, setHours] = useState<ActiveHours>(savedHours);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The gateway's copy wins; a device that has none yet sends what it has saved.
  useEffect(() => {
    let cancelled = false;
    void post({ endpoint }).then(async (response) => {
      if (cancelled || !response?.ok) return;
      const body = (await response.json().catch(() => null)) as { activeHours?: unknown } | null;
      const remote = normalizeActiveHours(body?.activeHours);
      if (cancelled) return;
      if (remote) setHours(remote);
      else if (savedHours().on) void post({ endpoint, activeHours: savedHours() });
    });
    return () => {
      cancelled = true;
    };
  }, [endpoint]);

  const persist = async (next: ActiveHours) => {
    if (!normalizeActiveHours(next)) return;
    setHours(next);
    setSaving(true);
    setError(null);
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Kept on the gateway only.
    }
    const response = await post({ endpoint, activeHours: next });
    setSaving(false);
    if (!response?.ok) setError("Couldn't save these hours. Try again.");
  };

  return (
    <Stack gap="xs">
      <Switch
        size="sm"
        label="Only notify during set hours"
        description="This device only. Errors still notify, and the app badge still updates."
        checked={hours.on}
        disabled={saving}
        onChange={(event) => void persist({ ...hours, on: event.currentTarget.checked })}
      />
      {hours.on && (
        <>
          <Chip.Group
            multiple
            value={hours.days.map(String)}
            onChange={(days) => days.length && void persist({ ...hours, days: days.map(Number) })}
          >
            <Group gap="xs">
              {DAY_LABELS.map((label, day) => (
                <Chip key={label} value={String(day)} size="xs" variant="outline">
                  {label}
                </Chip>
              ))}
            </Group>
          </Chip.Group>
          <Group grow>
            <TextInput
              type="time"
              label="From"
              value={hours.start}
              onChange={(event) =>
                event.currentTarget.value &&
                void persist({ ...hours, start: event.currentTarget.value })
              }
            />
            <TextInput
              type="time"
              label="Until"
              value={hours.end}
              onChange={(event) =>
                event.currentTarget.value &&
                void persist({ ...hours, end: event.currentTarget.value })
              }
            />
          </Group>
          <Select
            searchable
            allowDeselect={false}
            label="Time zone"
            value={hours.zone}
            data={zones(hours.zone)}
            onChange={(zone) => zone && void persist({ ...hours, zone })}
          />
        </>
      )}
      {error && (
        <Text size="xs" c="red" role="alert">
          {error}
        </Text>
      )}
    </Stack>
  );
}
