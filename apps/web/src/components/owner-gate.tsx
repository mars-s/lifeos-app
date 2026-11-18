"use client";

import { useAuthActions } from "@convex-dev/auth/react";
import { useOauth, useSignInWithGithub, type OauthFlowError } from "@convex-dev/auth/methods/github/react";
import { GithubLogo, SignOut } from "@phosphor-icons/react";
import { isTauri } from "@tauri-apps/api/core";
import { onOpenUrl } from "@tauri-apps/plugin-deep-link";
import { ConvexError } from "convex/values";
import { useConvexAuth } from "convex/react";
import { Component, useCallback, useEffect, useState, type ReactNode } from "react";
import { api } from "@lifeos/backend/api";
import type { AccessError } from "@lifeos/backend/types";
import { Button } from "@/components/ui/action-button";
import { LifeosMark } from "@/components/lifeos/mark";
import { haptic } from "@/lib/haptics";
import { cn } from "@/lib/utils";

export const isAccessError = (error: unknown): error is ConvexError<AccessError> =>
  error instanceof ConvexError &&
  typeof error.data === "object" &&
  error.data !== null &&
  (error.data.kind === "signed_out" || error.data.kind === "not_owner");

const flowMessage = (flowError: OauthFlowError) => {
  switch (flowError.error) {
    case "ACCESS_DENIED":
      return "Sign-in was cancelled.";
    case "EXPIRED":
      return "That sign-in took too long. Try again.";
    case "INVALID_FLOW":
      return "That sign-in started somewhere else. Try again here.";
    case "OTHER_ERROR":
      return isAccessError(flowError.cause) ? flowError.cause.data.message : "GitHub sign-in did not finish. Try again.";
  }
};

const macReturnUrl = import.meta.env.WAKU_PUBLIC_CONVEX_URL?.replace(/\.convex\.cloud\/?$/, ".convex.site/auth/mac");

const inPackagedMac = () => isTauri() && window.location.protocol === "tauri:";

const returnedError = (param: string | null) => {
  switch (param) {
    case "access_denied":
      return { error: "ACCESS_DENIED" } satisfies OauthFlowError;
    case "expired":
      return { error: "EXPIRED" } satisfies OauthFlowError;
    default:
      return { error: "OTHER_ERROR", cause: param } satisfies OauthFlowError;
  }
};

const Screen = ({ title, hint, children }: { title: string; hint: ReactNode; children: ReactNode }) => (
  <section className="mx-auto flex min-h-dvh w-full max-w-sm flex-col items-center justify-center gap-6 px-6 text-center">
    <LifeosMark fill="enter" className="size-10" />
    <div className="space-y-1.5">
      <h1 className="text-title font-semibold">{title}</h1>
      <p className="text-small text-pretty text-muted-foreground">{hint}</p>
    </div>
    {children}
  </section>
);

const useMacReturn = () => {
  const { signIn } = useSignInWithGithub(api.auth);
  const [problem, setProblem] = useState<string | null>(null);
  const [waiting, setWaiting] = useState(false);
  useEffect(() => {
    if (!inPackagedMac()) return;
    const finish = async (link: string) => {
      const returned = new URL(link).searchParams;
      const code = returned.get("convexAuthCode");
      setWaiting(false);
      setProblem(null);
      const finished = code ? await signIn({ code }) : null;
      if (finished?.status === "complete") return;
      setProblem(flowMessage(finished?.userError ?? returnedError(returned.get("convexAuthError"))));
      haptic("error");
    };
    const listening = onOpenUrl((links) => {
      for (const link of links) if (link.startsWith("lifeos://auth")) void finish(link);
    });
    return () => void listening.then((stop) => stop());
  }, [signIn]);
  const leftForBrowser = useCallback(() => {
    setProblem(null);
    setWaiting(true);
  }, []);
  return { problem, waiting, leftForBrowser };
};

type MacReturn = ReturnType<typeof useMacReturn>;

const SignInScreen = ({ macReturn }: { macReturn: MacReturn }) => {
  const { signIn } = useSignInWithGithub(api.auth);
  const { flowError } = useOauth();
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const problem = startError ?? macReturn.problem ?? (flowError ? flowMessage(flowError) : null);
  const start = async () => {
    setStarting(true);
    setStartError(null);
    const mac = inPackagedMac();
    const result = await signIn(mac ? { redirectTo: macReturnUrl } : undefined);
    if (result.status === "redirect") {
      if (!mac) return;
      setStarting(false);
      macReturn.leftForBrowser();
      return;
    }
    setStarting(false);
    setStartError("GitHub sign-in could not start. Try again.");
    haptic("error");
  };
  return (
    <Screen title="LifeOS" hint="A calm place to plan the day. Sign in to pick up where you left off.">
      <Button variant="primary" size="md" icon={GithubLogo} loading={starting} onClick={() => void start()}>
        Sign in with GitHub
      </Button>
      <p role="status" aria-live="polite" className={cn("min-h-5 text-small", problem ? "text-negative" : "text-muted-foreground")}>
        {problem ?? (macReturn.waiting ? "Finish in your browser. LifeOS comes back when you are done." : null)}
      </p>
    </Screen>
  );
};

const NotYourLifeos = ({ message }: { message: string }) => {
  const { signOut } = useAuthActions();
  return (
    <Screen title="Not your LifeOS" hint={message}>
      <Button variant="secondary" size="md" icon={SignOut} onClick={() => void signOut()}>
        Sign out
      </Button>
    </Screen>
  );
};

class AccessBoundary extends Component<{ macReturn: MacReturn; children: ReactNode }, { error: unknown }> {
  override state = { error: null };

  static getDerivedStateFromError(error: unknown) {
    return { error };
  }

  override render() {
    const { error } = this.state as { error: unknown };
    if (error === null) return this.props.children;
    if (!isAccessError(error)) throw error;
    return error.data.kind === "not_owner" ? <NotYourLifeos message={error.data.message} /> : <SignInScreen macReturn={this.props.macReturn} />;
  }
}

export const SignOutButton = () => {
  const { signOut } = useAuthActions();
  return (
    <Button variant="quiet" icon={SignOut} onClick={() => void signOut()}>
      Sign out
    </Button>
  );
};

export const OwnerGate = ({ children }: { children: ReactNode }) => {
  const { isLoading, isAuthenticated } = useConvexAuth();
  const macReturn = useMacReturn();
  if (isLoading) {
    return (
      <div aria-busy="true" className="grid min-h-dvh place-items-center">
        <LifeosMark fill="loop" className="size-10 animate-delayed-in" />
      </div>
    );
  }
  if (!isAuthenticated) return <SignInScreen macReturn={macReturn} />;
  return <AccessBoundary macReturn={macReturn}>{children}</AccessBoundary>;
};
