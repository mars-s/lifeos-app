"use client";

import { useAuthActions } from "@convex-dev/auth/react";
import { CalendarDots, Desktop, DownloadSimple, GearSix, GithubLogo, Keyboard, Moon, SignOut, Stamp } from "@phosphor-icons/react";
import { useState } from "react";
import { api } from "@lifeos/backend/api";
import { formatClock } from "@/components/lifeos/format";
import { Button } from "@/components/ui/action-button";
import { KeyCombo } from "@/components/ui/key-hint";
import { PERMISSIONS, useMac, type Mac, type Permission } from "@/lib/mac";
import { CalendarSwitches } from "../calendars-setting";
import { bar } from "../command-bar/store";
import { timeAgo } from "../dates";
import { useNow, useQuietView } from "../hooks";
import { ListPage } from "../list-page";
import { useOura } from "../oura";
import { useShell } from "../shell-context";
import { FeaturesSection } from "./features";
import { askFor, refreshMac, useMacState, type MacState } from "./mac-state";
import { PERMISSION_COPY, actionLabel, statusHint, statusTone, statusWord } from "./permission-copy";
import { Problem, SettingsGroup, SettingsRow, StatusLamp } from "./rows";

const IMPORT_PATIENCE_MS = 60_000;
const retiredFormat = new Intl.DateTimeFormat("en-AU", { day: "numeric", month: "long", year: "numeric" });
const counted = new Intl.NumberFormat("en-AU");

const Figure = ({ children }: { children: string }) => <span className="font-mono text-foreground tabular-nums">{children}</span>;

const AccountSection = () => {
  const { signOut } = useAuthActions();
  const account = useQuietView(api.platform.access.account, {});
  return (
    <SettingsGroup title="Account">
      <SettingsRow
        icon={GithubLogo}
        label={account?.login ? <span translate="no">@{account.login}</span> : "GitHub"}
        hint="Signed in with GitHub. Only this account can open this LifeOS."
      >
        <Button variant="secondary" icon={SignOut} onClick={() => void signOut()}>
          Sign out
        </Button>
      </SettingsRow>
    </SettingsGroup>
  );
};

const PermissionRow = ({ mac, state, permission }: { mac: Mac; state: MacState; permission: Permission }) => {
  const copy = PERMISSION_COPY[permission];
  const status = state.permissions[permission];
  const action = actionLabel(permission, status);
  return (
    <SettingsRow icon={copy.icon} label={copy.label} hint={statusHint(permission, status)}>
      <StatusLamp tone={statusTone(status)}>{statusWord(permission, status)}</StatusLamp>
      {action && (
        <Button
          variant={status === "notAsked" ? "primary" : "secondary"}
          loading={state.asking === permission}
          disabled={state.asking !== null}
          onClick={() => void askFor(mac, permission)}
        >
          {action}
        </Button>
      )}
    </SettingsRow>
  );
};

const PermissionsSection = ({ mac, state }: { mac: Mac | null; state: MacState | null }) => (
  <SettingsGroup title="Permissions" hint="What macOS lets LifeOS reach on this Mac. Asked once, changed here any time.">
    {mac && state ? (
      PERMISSIONS.map((permission) => <PermissionRow key={permission} mac={mac} state={state} permission={permission} />)
    ) : mac ? (
      <p className="px-3.5 py-3.5 text-small text-muted-foreground">Checking with macOS…</p>
    ) : (
      <SettingsRow
        icon={Desktop}
        label="These live in the Mac app"
        hint="Apple Calendar, Things data and the Keychain token are granted on your Mac. Open LifeOS there to see or change them."
      />
    )}
  </SettingsGroup>
);

const ThingsRow = ({ mac, state }: { mac: Mac | null; state: MacState | null }) => {
  const status = useQuietView(api.planner.things.status, {});
  const now = useNow();
  const [askedAt, setAskedAt] = useState<number | null>(null);
  const ranAt = Math.max(status?.syncedAt ?? 0, state?.report.things?.atMs ?? 0);
  const importing = askedAt !== null && ranAt < askedAt && (now ?? askedAt) - askedAt < IMPORT_PATIENCE_MS;
  const retired = status?.retiredAt !== undefined;
  const failure = retired ? null : (state?.report.things?.error ?? null);
  const start = () => {
    if (!mac) return;
    setAskedAt(Date.now());
    void mac.importThingsNow().then(() => refreshMac(mac));
  };
  return (
    <SettingsRow
      icon={DownloadSimple}
      label="Things Import"
      hint={
        status === undefined ? null : status === null ? (
          "Nothing has come across from Things yet."
        ) : retired ? (
          `Retired on ${retiredFormat.format(status.retiredAt)}. Things is no longer imported.`
        ) : (
          <>
            {importing ? "Importing from Things…" : `Last import ${now === null ? "" : timeAgo(status.syncedAt, Math.max(now, status.syncedAt))}.`}{" "}
            <Figure>{counted.format(status.counts.tasks)}</Figure> Tasks, <Figure>{counted.format(status.counts.projects)}</Figure> Projects,{" "}
            <Figure>{counted.format(status.counts.areas)}</Figure> Areas.
          </>
        )
      }
      below={
        retired ? null : (
          <>
            {failure && <Problem>The last import on this Mac did not finish: {failure}</Problem>}
            <p className="text-small text-pretty text-faint-foreground">
              {mac ? "" : "Imports run from the Mac app. "}Switch Day stays a terminal step: <code className="font-mono text-muted-foreground">pnpm things:switch</code>
            </p>
          </>
        )
      }
    >
      {mac && !retired && (
        <Button variant="secondary" loading={importing} onClick={start}>
          Import now
        </Button>
      )}
    </SettingsRow>
  );
};

const CalendarRow = ({ state }: { state: MacState | null }) => {
  const view = useQuietView(api.calendar.calendars.list, {});
  const hours = useQuietView(api.calendar.workingHours.get, {});
  const now = useNow();
  const failure = state?.report.calendar?.error ?? null;
  const counting = view?.calendars.filter((calendar) => calendar.included).length ?? 0;
  return (
    <SettingsRow
      icon={CalendarDots}
      label="Apple Calendar"
      hint={
        view === undefined
          ? null
          : view.syncedAt === null
            ? "Open LifeOS on your Mac and allow calendar access to bring in Apple Calendar."
            : `Read on your Mac ${now === null ? "" : timeAgo(view.syncedAt, Math.max(now, view.syncedAt))}. Calendars that are on count against your free time.`
      }
      below={
        <>
          {failure && <Problem>The last send from this Mac did not finish: {failure}</Problem>}
          <CalendarSwitches className="-mx-2.5" />
          {hours && (
            <p className="pt-1 text-small text-muted-foreground">
              Working hours{" "}
              <Figure>
                {`${formatClock(hours.startMinute)} to ${formatClock(hours.endMinute)}`}
              </Figure>
            </p>
          )}
        </>
      }
    >
      {view && view.calendars.length > 0 && (
        <span className="text-small whitespace-nowrap text-muted-foreground">
          <Figure>{String(counting)}</Figure> of <Figure>{String(view.calendars.length)}</Figure> count
        </span>
      )}
    </SettingsRow>
  );
};

const OuraRow = () => {
  const { today } = useShell();
  const { status, syncing, problem, needsConnect, line, startConnect, startSync } = useOura(today);
  return (
    <SettingsRow
      icon={Moon}
      label="Oura"
      hint={
        !status
          ? null
          : status.setup === "not_configured"
            ? "Oura is not set up on this LifeOS yet. Once its app is registered, your sleep shows on the Timebox."
            : status.setup === "not_connected"
              ? "Connect your ring to see your sleep on the Timebox, with Oura's bedtime and your usual wake."
              : line
      }
      below={problem ? <Problem>{problem}</Problem> : null}
    >
      {status?.setup === "connected" && !needsConnect && (
        <Button variant="secondary" loading={syncing} onClick={startSync}>
          Sync now
        </Button>
      )}
      {status && status.setup !== "not_configured" && needsConnect && (
        <Button variant="primary" onClick={startConnect}>
          {status.setup === "connected" ? "Connect again" : "Connect Oura"}
        </Button>
      )}
    </SettingsRow>
  );
};

const TemplatesSection = () => {
  const { navigate } = useShell();
  return (
    <SettingsGroup title="Templates">
      <SettingsRow icon={Stamp} label="Templates" hint="Saved Task shapes you start new Tasks from.">
        <Button variant="secondary" onClick={() => navigate({ kind: "templates" }, "pointer")}>
          Open
        </Button>
      </SettingsRow>
    </SettingsGroup>
  );
};

export const SettingsScreen = () => {
  const mac = useMac();
  const state = useMacState(mac);
  return (
    <ListPage title="Settings" icon={GearSix}>
      <AccountSection />
      <PermissionsSection mac={mac} state={state} />
      <SettingsGroup title="Connections and sync" hint="Where your Tasks, calendar and sleep come from, and when each was last read.">
        <ThingsRow mac={mac} state={state} />
        <CalendarRow state={state} />
        <OuraRow />
      </SettingsGroup>
      <FeaturesSection />
      <TemplatesSection />
      <SettingsGroup title="Keyboard">
        <SettingsRow icon={Keyboard} label="Keyboard shortcuts" hint="Every key that works where you are.">
          <KeyCombo keys="?" />
          <Button variant="secondary" onClick={bar.shortcuts}>
            Show
          </Button>
        </SettingsRow>
      </SettingsGroup>
    </ListPage>
  );
};
