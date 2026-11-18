"use client";

import { useAuthActions } from "@convex-dev/auth/react";
import { useOauth, useSignInWithGithub, type OauthFlowError } from "@convex-dev/auth/methods/github/react";
import { GithubLogo, SignOut } from "@phosphor-icons/react";
import { ConvexError } from "convex/values";
import { useConvexAuth } from "convex/react";
import { Component, useState, type ReactNode } from "react";
import { api } from "@lifeos/backend/api";
import type { AccessError } from "@lifeos/backend/types";
import { Button } from "@/components/ui/action-button";
import { LifeosMark } from "@/components/lifeos/mark";
import { haptic } from "@/lib/haptics";

const isAccessError = (error: unknown): error is ConvexError<AccessError> =>
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

const SignInScreen = () => {
  const { signIn } = useSignInWithGithub(api.auth);
  const { flowError } = useOauth();
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const problem = startError ?? (flowError ? flowMessage(flowError) : null);
  const start = async () => {
    setStarting(true);
    setStartError(null);
    const result = await signIn();
    if (result.status === "redirect") return;
    setStarting(false);
    setStartError("GitHub sign-in could not start. Try again.");
    haptic("error");
  };
  return (
    <Screen title="LifeOS" hint="A calm place to plan the day. Sign in to pick up where you left off.">
      <Button variant="primary" size="md" icon={GithubLogo} loading={starting} onClick={() => void start()}>
        Sign in with GitHub
      </Button>
      <p role="status" aria-live="polite" className="min-h-5 text-small text-negative">
        {problem}
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

class AccessBoundary extends Component<{ children: ReactNode }, { error: unknown }> {
  override state = { error: null };

  static getDerivedStateFromError(error: unknown) {
    return { error };
  }

  override render() {
    const { error } = this.state as { error: unknown };
    if (error === null) return this.props.children;
    if (!isAccessError(error)) throw error;
    return error.data.kind === "not_owner" ? <NotYourLifeos message={error.data.message} /> : <SignInScreen />;
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
  if (isLoading) {
    return (
      <div aria-busy="true" className="grid min-h-dvh place-items-center">
        <LifeosMark fill="loop" className="size-10 animate-delayed-in" />
      </div>
    );
  }
  if (!isAuthenticated) return <SignInScreen />;
  return <AccessBoundary>{children}</AccessBoundary>;
};
