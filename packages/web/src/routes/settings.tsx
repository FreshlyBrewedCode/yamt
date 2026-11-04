import { createFileRoute } from "@tanstack/react-router";
import { PUSH_EVENTS, type PushEvent, type PushSubscriptionView } from "@yamt/shared";
import { cn } from "cn";
import { Bell, BellOff, Check, ClipboardPaste, Copy, Info, Share, SquarePlus } from "lucide-react";
import { type ReactNode, useState } from "react";
import { AgentSettings } from "@/components/agent-settings";
import {
  BackButton,
  Band,
  BottomSlab,
  iconButtonClass,
  Label,
  SafeBottom,
  SlabButton,
  Strip,
} from "@/components/slab";
import { type PushDevice, requestPermission } from "@/lib/push";
import {
  usePush,
  usePushDevice,
  useSetPushEvents,
  useTestPush,
  useTurnOffPush,
  useTurnOnPush,
} from "@/lib/queries";

export const Route = createFileRoute("/settings")({ component: Settings });

/** Where notifications stand on this device. */
type PushState = "loading" | "on" | "off" | "blocked" | "not-installed" | "unsupported" | "error";

const EVENTS: Record<PushEvent, { title: string; detail: string }> = {
  analysed: { title: "Analysed", detail: "The meal's title and kcal" },
  needs_input: { title: "Needs input", detail: "The agent's question" },
  failed: { title: "Failed", detail: "What went wrong" },
};

const HEADLINE: Record<PushState, string> = {
  loading: "…",
  on: "On",
  off: "Off",
  blocked: "Blocked",
  "not-installed": "Not installed",
  unsupported: "Not available",
  error: "—",
};

const EXPLAIN: Record<PushState, string> = {
  loading: "Checking this device…",
  on: "This device hears when an analysis is done, needs your input or failed. A tap opens the meal.",
  off: "Get a notification when an analysis is done, needs your input or failed.",
  blocked: "Notifications for yamt are turned off in this device's settings.",
  "not-installed": "On iPhone, notifications only work in yamt opened from the Home Screen.",
  unsupported: "This browser can't receive push notifications.",
  error: "Can't reach yamt right now.",
};

function pushState(
  device: PushDevice | undefined,
  mine: PushSubscriptionView | null,
  serverError: boolean,
): PushState {
  if (!device) return "loading";
  if (device.support !== "supported") return device.support;
  if (device.permission === "denied") return "blocked";
  if (serverError) return "error";
  return mine ? "on" : "off";
}

/**
 * Settings: notifications for this device (Web Push, #13), the agent that analyses meals (#28),
 * and how to share from other apps into yamt (#26). Turning them on asks for permission
 * from the tap itself (iOS asks only from a gesture) and only works in the home-screen app on
 * iOS, so outside it the screen explains how to add yamt to the Home Screen. Once on: a toggle
 * per event and a test notification.
 */
function Settings() {
  const device = usePushDevice();
  const push = usePush();
  const turnOn = useTurnOnPush();
  const turnOff = useTurnOffPush();
  const test = useTestPush();
  const [problem, setProblem] = useState<string | null>(null);

  const endpoint = device.data?.endpoint ?? null;
  const mine = (endpoint && push.data?.subscriptions.find((s) => s.endpoint === endpoint)) || null;
  const state = pushState(device.data, mine, push.isError);
  const busy = turnOn.isPending || turnOff.isPending;

  const enable = () => {
    if (!push.data) return;
    setProblem(null);
    test.reset();
    // first thing in the tap: iOS only shows the prompt from a user gesture
    const permission = requestPermission();
    turnOn.mutate(
      { permission, publicKey: push.data.publicKey },
      {
        onError: (e) => setProblem(`Couldn't turn them on: ${e.message}`),
        onSettled: () => void device.refetch(),
      },
    );
  };
  const disable = () => {
    if (!mine) return;
    setProblem(null);
    test.reset();
    turnOff.mutate(mine.id, {
      onError: (e) => setProblem(`Couldn't turn them off: ${e.message}`),
      onSettled: () => void device.refetch(),
    });
  };

  const testHint = test.isPending
    ? "Sending…"
    : test.data?.delivery === "sent"
      ? "Sent. It should arrive in a few seconds."
      : test.data?.delivery === "gone"
        ? "This device's subscription expired. Turn notifications on again."
        : test.data?.delivery === "failed"
          ? `Not sent: ${test.data.error}`
          : test.isError
            ? `Not sent: ${test.error.message}`
            : undefined;

  return (
    <>
      <header className="px-5 pt-5 pb-4">
        <BackButton />
        <h1 className="display mt-4 text-[36px]">Settings</h1>
      </header>

      <main className="flex-1">
        {/* the one thing on this screen: whether this device gets notifications */}
        <Band tone="ink" className="px-5 pt-4 pb-5" data-testid="push-state" data-state={state}>
          <Label className="flex items-center gap-2 text-ink-muted">
            {state === "on" ? (
              <Bell className="size-4" strokeWidth={2.5} />
            ) : (
              <BellOff className="size-4" strokeWidth={2.5} />
            )}
            Notifications
          </Label>
          <p className="display mt-2 text-[40px]">{HEADLINE[state]}</p>
          <p className="mt-3 font-medium text-ink-muted text-sm">{EXPLAIN[state]}</p>
        </Band>

        {problem && (
          <p className="bg-orange px-5 py-3 font-medium text-orange-foreground" role="alert">
            {problem}
          </p>
        )}

        {state === "not-installed" && <InstallSteps />}

        {state === "blocked" && (
          <Band tone="tint" className="px-5 pt-4 pb-5">
            <Label className="text-muted-foreground">To allow them</Label>
            <p className="mt-2 font-medium">
              Open Settings → Notifications → yamt and turn on Allow Notifications, then come back here.
            </p>
          </Band>
        )}

        {(state === "off" || state === "loading") && (
          <>
            <Strip title="You'll hear when" />
            <ul className="divide-y divide-border">
              {PUSH_EVENTS.map((e) => (
                <li key={e} className="flex min-h-16 flex-col justify-center px-5">
                  <span className="font-bold">{EVENTS[e].title}</span>
                  <span className="font-medium text-muted-foreground text-sm">{EVENTS[e].detail}</span>
                </li>
              ))}
            </ul>
          </>
        )}

        {state === "on" && mine && (
          <>
            <Strip title="Notify me when" meta="this device" />
            <EventToggles subscription={mine} />
            <button
              type="button"
              onClick={disable}
              disabled={busy}
              className="flex min-h-14 w-full items-center px-5 font-bold text-muted-foreground uppercase tracking-[0.08em] outline-none focus-visible:bg-tint disabled:opacity-60"
              data-testid="push-off"
            >
              {turnOff.isPending ? "Turning off…" : "Turn off on this device"}
            </button>
          </>
        )}

        <AgentSettings />

        <ShareSetup />
      </main>

      {state === "off" || state === "not-installed" ? (
        <BottomSlab
          hint={
            state === "not-installed"
              ? "Add yamt to your Home Screen first."
              : turnOn.data === null && !turnOn.isPending
                ? "Notifications weren't allowed."
                : undefined
          }
        >
          <SlabButton onClick={enable} disabled={state !== "off" || busy || !push.data} data-testid="push-on">
            <Bell className="size-7" strokeWidth={3} />
            {turnOn.isPending ? "Turning on…" : "Turn on notifications"}
          </SlabButton>
        </BottomSlab>
      ) : state === "on" && mine ? (
        <BottomSlab hint={testHint}>
          <SlabButton
            tone="tint"
            onClick={() => test.mutate(mine.id)}
            disabled={test.isPending}
            data-testid="push-test"
          >
            Send test notification
          </SlabButton>
        </BottomSlab>
      ) : (
        <SafeBottom />
      )}
    </>
  );
}

function EventToggles({ subscription }: { subscription: PushSubscriptionView }) {
  const set = useSetPushEvents();
  return (
    <ul className="divide-y divide-border border-border border-b">
      {PUSH_EVENTS.map((e) => {
        const on = subscription.events[e];
        return (
          <li key={e}>
            <button
              type="button"
              role="switch"
              aria-checked={on}
              aria-label={EVENTS[e].title}
              onClick={() =>
                set.mutate({ id: subscription.id, events: { ...subscription.events, [e]: !on } })
              }
              className="flex min-h-16 w-full items-center gap-4 px-5 text-left outline-none focus-visible:bg-tint"
              data-testid={`push-event-${e}`}
            >
              <span className="min-w-0 flex-1">
                <span className="block font-bold">{EVENTS[e].title}</span>
                <span className="block font-medium text-muted-foreground text-sm">{EVENTS[e].detail}</span>
              </span>
              <Switch on={on} />
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** A square switch: foreground when on, tint when off (lime stays for what wants the user). */
function Switch({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex h-8 w-14 shrink-0 items-center p-1 transition-colors",
        on ? "bg-foreground" : "bg-tint",
      )}
    >
      <span
        className={cn(
          "size-6 transition-transform",
          on ? "translate-x-6 bg-background" : "translate-x-0 bg-muted-foreground",
        )}
      />
    </span>
  );
}

function InstallSteps() {
  const steps: [ReactNode, ReactNode][] = [
    [<Share key="i" className="size-5" strokeWidth={2.5} />, "Tap Share in Safari's toolbar."],
    [<SquarePlus key="i" className="size-5" strokeWidth={2.5} />, "Choose Add to Home Screen, then Add."],
    [
      <Bell key="i" className="size-5" strokeWidth={2.5} />,
      "Open yamt from the Home Screen and turn notifications on here.",
    ],
  ];
  return (
    <Band tone="tint" className="px-5 pt-4 pb-5" data-testid="install-steps">
      <Label className="text-muted-foreground">Add to Home Screen</Label>
      <ol className="mt-3 space-y-3">
        {steps.map(([icon, text], i) => (
          <li key={text as string} className="flex items-center gap-3">
            <span className="display flex size-10 shrink-0 items-center justify-center bg-background text-[20px]">
              {i + 1}
            </span>
            <span className="text-muted-foreground">{icon}</span>
            <span className="font-medium">{text}</span>
          </li>
        ))}
      </ol>
    </Band>
  );
}

/**
 * Share from other apps (#26): a home-screen app can't be in iOS's share sheet, so an iOS
 * Shortcut is ("Send to yamt"), posting what it gets to `/api/share` on this origin. The steps
 * name the Shortcuts app's labels as they read on iOS 17/18.
 */
function ShareSetup() {
  const url = `${location.origin}/api/share`;
  const [copied, setCopied] = useState<boolean | null>(null);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  const steps: ReactNode[] = [
    <>
      In the <b>Shortcuts</b> app, tap <b>+</b> for a new shortcut and name it <b>Send to yamt</b>.
    </>,
    <>
      Tap <Info className="inline size-4 align-[-2px]" strokeWidth={2.5} aria-label="the info button" />{" "}
      (Details) and turn on <b>Show in Share Sheet</b>. In the first block (“Receive … input”), pick Images,
      Media, Files, URLs and Text.
    </>,
    <>
      Add the action <b>Get Contents of URL</b> and paste the address above into it. Under <b>Show More</b>:
      Method <b>POST</b>, Request Body <b>Form</b>, then add a <b>File</b> field with the key{" "}
      <code>file</code> and the value <b>Shortcut Input</b>.
    </>,
    <>
      Add <b>Show Notification</b> and make its text <b>Contents of URL</b>: it says what was added.
    </>,
    <>
      Share a voice memo, a screenshot or a page and pick <b>Send to yamt</b>. Allow it to connect the first
      time; Tailscale has to be on.
    </>,
  ];
  return (
    <section data-testid="share-setup">
      <Strip title="Share from other apps" meta="iOS Shortcut" />
      <p className="px-5 pt-4 pb-4 font-medium">
        Voice memos, screenshots and links go straight into the meal you're logging (a draft changed in the
        last 3 hours) or start a new one. Open it here afterwards and press Analyse.
      </p>
      <div className="flex items-center gap-3 border-border border-t px-5 py-3">
        <div className="min-w-0 flex-1">
          <Label className="text-muted-foreground">Shortcut URL</Label>
          <p className="mt-0.5 break-all font-bold text-[15px]" data-testid="share-url">
            {url}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void copy()}
          aria-label={copied ? "Copied" : "Copy the URL"}
          className={iconButtonClass}
        >
          {copied ? (
            <Check className="size-6" strokeWidth={2.5} />
          ) : (
            <Copy className="size-6" strokeWidth={2.5} />
          )}
        </button>
      </div>
      {copied === false && (
        <p className="px-5 pb-3 font-medium text-muted-foreground text-sm" role="status">
          Couldn't copy it here: touch and hold the address to copy it.
        </p>
      )}
      <Band tone="tint" className="px-5 pt-4 pb-5">
        <Label className="text-muted-foreground">Build the Shortcut once</Label>
        <ol className="mt-3 space-y-3">
          {steps.map((text, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: a fixed list
            <li key={i} className="flex items-start gap-3">
              <span className="display flex size-10 shrink-0 items-center justify-center bg-background text-[20px]">
                {i + 1}
              </span>
              <span className="pt-2 font-medium text-[15px] leading-snug [&_b]:font-bold [&_code]:font-bold">
                {text}
              </span>
            </li>
          ))}
        </ol>
      </Band>
      <div className="flex items-start gap-3 px-5 pt-4 pb-5">
        <ClipboardPaste className="mt-0.5 size-5 shrink-0 text-muted-foreground" strokeWidth={2.5} />
        <p className="font-medium text-[15px] leading-snug">
          <b className="font-bold">Or paste:</b> copy in the other app (Share → Copy), then tap <b>Paste</b>{" "}
          on the meal's capture screen. Screenshots and links paste fine; for voice memos the Shortcut is the
          sure way.
        </p>
      </div>
    </section>
  );
}
