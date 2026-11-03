import { FormEvent, useEffect, useState } from "react";
import { useLocation } from "wouter";
import { ArrowLeft, ArrowRight, Check, Loader2, LogIn, Mail, Send } from "lucide-react";
import { Logo } from "@/shared/ui/shell/logo";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Textarea } from "@/shared/ui/textarea";
import { Card, CardContent } from "@/shared/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/shared/ui/collapsible";
import { useAuth } from "@/features/auth/presentation/auth-context";
import { ApiError } from "@workspace/api-client-react";
import { Footer } from "@/shared/ui/shell/footer";
import { ContinueAsGuestButton } from "@/features/auth/presentation/components/continue-as-guest-button";
import {
  buildAccessRequestMailto,
  type AdminContactsPayload,
} from "@/features/auth/domain/access-request-mailto";

/**
 * Classifies a typed identifier as either an email (→ SSO path) or a
 * local username. We deliberately keep this small and forgiving:
 * anything containing `@` followed by a `.` somewhere after it (with
 * no whitespace) is treated as an email. Empty / malformed inputs
 * fall back to "local" so the user is told to set a password rather
 * than punted to a 404 SSO redirect.
 */
export function classifyIdentifier(raw: string): "email" | "local" {
  const value = raw.trim();
  if (!value || /\s/.test(value)) return "local";
  const at = value.indexOf("@");
  if (at <= 0 || at === value.length - 1) return "local";
  const domain = value.slice(at + 1);
  if (!domain.includes(".")) return "local";
  return "email";
}

type Step = "identifier" | "password";

export function Login() {
  const [, navigate] = useLocation();
  const { login, ssoEnabled } = useAuth();
  const searchParams = new URLSearchParams(window.location.search);
  const ssoError = searchParams.get("sso_error");
  const ssoOrgKey = searchParams.get("org");
  // Deep-link / invite landings can pre-fill the identifier via `?email=`.
  // The server-side validator is still the source of truth for the
  // login_hint forwarded to the identity provider, so any junk here just gets dropped.
  const initialEmail = searchParams.get("email")?.trim() ?? "";
  const [step, setStep] = useState<Step>("identifier");
  const [identifier, setIdentifier] = useState(initialEmail);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [adminContacts, setAdminContacts] =
    useState<AdminContactsPayload | null>(null);
  // In-app "Request access" form state. Kept local to the deny banner —
  // a successful submit replaces the form with a confirmation card so
  // the user can't double-submit without refreshing.
  const [requestOpen, setRequestOpen] = useState(false);
  const [requestEmail, setRequestEmail] = useState("");
  const [requestMessage, setRequestMessage] = useState("");
  const [requestSubmitting, setRequestSubmitting] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [requestSent, setRequestSent] = useState(false);

  // When the SSO callback redirected us back with a bound-org marker,
  // ask the server for the org's admin contacts so the deny banner can
  // show "ask <email> for access" instead of a dead-end "contact your
  // administrator". Silent on failure — the banner falls back to the
  // generic copy.
  useEffect(() => {
    if (!ssoError || !ssoOrgKey) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `${import.meta.env.BASE_URL}api/auth/sso/admin-contacts?org=${encodeURIComponent(ssoOrgKey)}`,
          { credentials: "same-origin" },
        );
        if (!res.ok) return;
        const data = (await res.json()) as AdminContactsPayload;
        if (!cancelled) setAdminContacts(data);
      } catch {
        // Ignore — generic fallback copy still renders.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ssoError, ssoOrgKey]);

  const onSubmitIdentifier = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const value = identifier.trim();
    if (!value) {
      setError("Enter your username or email.");
      return;
    }
    setError(null);
    if (classifyIdentifier(value) === "email") {
      if (!ssoEnabled) {
        setError(
          "SSO sign-in isn't configured for this server. Use your local username instead.",
        );
        return;
      }
      // Hand the browser off to the OIDC start endpoint; passing the
      // typed email as `login_hint` lets the identity provider pre-fill its own form.
      window.location.href = `${import.meta.env.BASE_URL}api/auth/sso/login?login_hint=${encodeURIComponent(value)}`;
      return;
    }
    setStep("password");
  };

  const onSubmitPassword = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!password) {
      setError("Enter your password.");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await login(identifier.trim(), password);
      navigate("/splash", { replace: true });
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        if (err.status === 401) {
          setError("Invalid username or password.");
        } else {
          setError(err.message || "Failed to log in.");
        }
      } else {
        setError(err instanceof Error ? err.message : "Failed to log in.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  const onSubmitAccessRequest = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const email = requestEmail.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setRequestError("Enter a valid email so an admin can reply.");
      return;
    }
    setRequestError(null);
    setRequestSubmitting(true);
    try {
      const res = await fetch(
        `${import.meta.env.BASE_URL}api/auth/sso/request-access`,
        {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email,
            gate: ssoError,
            orgKey: ssoOrgKey ?? null,
            message: requestMessage.trim() || null,
          }),
        },
      );
      if (!res.ok) {
        setRequestError(
          "Couldn't send your request. Try again, or email an admin directly.",
        );
        return;
      }
      setRequestSent(true);
    } catch {
      setRequestError(
        "Couldn't send your request. Try again, or email an admin directly.",
      );
    } finally {
      setRequestSubmitting(false);
    }
  };

  const onBack = () => {
    setStep("identifier");
    setPassword("");
    setError(null);
  };

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <header className="material-chrome border-b border-border shadow-nav dark:shadow-none px-8 py-5 flex items-center gap-3">
        <Logo className="text-xl" />
      </header>

      <main className="relative flex-1 flex items-center justify-center p-8 ambient-bg-soft">
        <Card className="w-full max-w-sm border-card-border shadow-card">
          <CardContent className="p-8">
            <div className="mb-6">
              <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
              <p className="text-sm text-muted-foreground mt-1">
                {step === "identifier"
                  ? "Enter your username or email to continue."
                  : "Enter your password to finish signing in."}
              </p>
            </div>

            {step === "identifier" ? (
              <form
                className="space-y-4"
                onSubmit={onSubmitIdentifier}
                noValidate
              >
                <div className="space-y-2">
                  <Label htmlFor="identifier">Username or email</Label>
                  <Input
                    id="identifier"
                    type="text"
                    inputMode="email"
                    autoComplete="username"
                    autoFocus
                    value={identifier}
                    onChange={(e) => setIdentifier(e.target.value)}
                    data-testid="input-username"
                  />
                </div>
                {error && (
                  <div
                    className="text-sm text-destructive"
                    data-testid="text-login-error"
                  >
                    {error}
                  </div>
                )}
                <Button
                  type="submit"
                  className="w-full"
                  data-testid="button-next"
                >
                  Next
                  <ArrowRight className="h-4 w-4 ml-2" />
                </Button>
                <ContinueAsGuestButton />
                {ssoError && (
                  <div
                    className="text-sm text-destructive space-y-2"
                    data-testid="text-sso-error"
                  >
                    <p>
                      {ssoError === "no_memento_user"
                        ? "You are not authorized to use memento."
                        : ssoError === "no_memento_access"
                          ? `Sign-in succeeded, but ${adminContacts?.org?.displayName ? `your organization (${adminContacts.org.displayName})` : "your organization"} isn't authorized for memento yet.`
                          : ssoError === "no_org"
                            ? "Your account is not assigned to any organization."
                            : "SSO sign-in failed. Please try again."}
                    </p>
                    {ssoError !== "no_org" &&
                    adminContacts &&
                    adminContacts.admins.length > 0 ? (
                      <div
                        className="space-y-1.5"
                        data-testid="block-sso-admin-contacts"
                      >
                        <p>
                          {adminContacts.admins.length === 1
                            ? "Request access from:"
                            : "Request access from one of:"}
                        </p>
                        <ul className="list-disc pl-5 space-y-0.5">
                          {adminContacts.admins.map((a) => (
                            <li key={a.email}>
                              <a
                                href={`mailto:${a.email}`}
                                className="underline underline-offset-2 hover:no-underline"
                                data-testid={`link-sso-admin-${a.email}`}
                              >
                                {a.displayName} : {a.email}
                              </a>
                            </li>
                          ))}
                        </ul>
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                          <a
                            href={buildAccessRequestMailto(
                              adminContacts.admins,
                              ssoError,
                              adminContacts.org?.displayName ?? null,
                            )}
                            className="inline-flex items-center gap-1.5 text-xs font-medium underline underline-offset-2 hover:no-underline"
                            data-testid="link-sso-request-access"
                          >
                            <Mail className="h-3 w-3" />
                            Email an admin
                          </a>
                          {!requestSent && !requestOpen && (
                            <button
                              type="button"
                              onClick={() => {
                                setRequestOpen(true);
                                setRequestError(null);
                              }}
                              className="inline-flex items-center gap-1.5 text-xs font-medium underline underline-offset-2 hover:no-underline"
                              data-testid="button-sso-request-access-open"
                            >
                              <Send className="h-3 w-3" />
                              Request access in-app
                            </button>
                          )}
                        </div>
                      </div>
                    ) : ssoError !== "no_org" ? (
                      <p data-testid="text-sso-generic-fallback">
                        Contact your administrator to request access.
                      </p>
                    ) : (
                      <p data-testid="text-sso-generic-fallback">
                        Contact your administrator.
                      </p>
                    )}
                    {ssoError !== "no_org" && (requestOpen || requestSent) && (
                      <div
                        className="rounded-md border border-border bg-card/60 p-3 mt-2 text-foreground"
                        data-testid="block-sso-request-access-form"
                      >
                        {requestSent ? (
                          <div
                            className="flex items-start gap-2 text-sm"
                            data-testid="text-sso-request-access-success"
                          >
                            <Check className="h-4 w-4 text-green-600 mt-0.5 shrink-0" />
                            <span>
                              Thanks — your request has been sent to your
                              administrator. You'll hear back by email.
                            </span>
                          </div>
                        ) : (
                          <form
                            className="space-y-2"
                            onSubmit={onSubmitAccessRequest}
                            noValidate
                          >
                            <p className="text-xs text-muted-foreground">
                              Send a request without leaving the app — admins
                              see it in their queue immediately.
                            </p>
                            <div className="space-y-1">
                              <Label
                                htmlFor="request-access-email"
                                className="text-xs"
                              >
                                Your email
                              </Label>
                              <Input
                                id="request-access-email"
                                type="email"
                                autoComplete="email"
                                value={requestEmail}
                                onChange={(e) =>
                                  setRequestEmail(e.target.value)
                                }
                                data-testid="input-sso-request-access-email"
                              />
                            </div>
                            <div className="space-y-1">
                              <Label
                                htmlFor="request-access-message"
                                className="text-xs"
                              >
                                Message <span className="text-muted-foreground">(optional)</span>
                              </Label>
                              <Textarea
                                id="request-access-message"
                                rows={3}
                                value={requestMessage}
                                onChange={(e) =>
                                  setRequestMessage(e.target.value)
                                }
                                maxLength={2000}
                                data-testid="input-sso-request-access-message"
                              />
                            </div>
                            {requestError && (
                              <div
                                className="text-xs text-destructive"
                                data-testid="text-sso-request-access-error"
                              >
                                {requestError}
                              </div>
                            )}
                            <div className="flex items-center gap-2">
                              <Button
                                type="submit"
                                size="sm"
                                disabled={requestSubmitting}
                                data-testid="button-sso-request-access-submit"
                              >
                                {requestSubmitting ? (
                                  <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                                ) : (
                                  <Send className="h-3.5 w-3.5 mr-1.5" />
                                )}
                                Send request
                              </Button>
                              <button
                                type="button"
                                onClick={() => {
                                  setRequestOpen(false);
                                  setRequestError(null);
                                }}
                                className="text-xs text-muted-foreground hover:text-foreground"
                                data-testid="button-sso-request-access-cancel"
                              >
                                Cancel
                              </button>
                            </div>
                          </form>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </form>
            ) : (
              <form
                className="space-y-4"
                onSubmit={onSubmitPassword}
                noValidate
              >
                <div className="space-y-2">
                  <Label htmlFor="identifier-readonly">Username</Label>
                  <Input
                    id="identifier-readonly"
                    type="text"
                    value={identifier}
                    readOnly
                    autoComplete="username"
                    data-testid="input-username"
                  />
                  <button
                    type="button"
                    onClick={onBack}
                    className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
                    data-testid="button-back-to-username"
                  >
                    <ArrowLeft className="h-3 w-3" />
                    Use a different username
                  </button>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password">Password</Label>
                  <Input
                    id="password"
                    type="password"
                    autoComplete="current-password"
                    autoFocus
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    data-testid="input-password"
                  />
                </div>
                {error && (
                  <div
                    className="text-sm text-destructive"
                    data-testid="text-login-error"
                  >
                    {error}
                  </div>
                )}
                <Button
                  type="submit"
                  className="w-full"
                  disabled={submitting}
                  data-testid="button-sign-in"
                >
                  {submitting ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <LogIn className="h-4 w-4 mr-2" />
                  )}
                  Sign in
                </Button>
              </form>
            )}

            <Collapsible
              open={helpOpen}
              onOpenChange={setHelpOpen}
              className="mt-6"
            >
              <CollapsibleTrigger asChild>
                <button
                  type="button"
                  className="text-xs text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
                  data-testid="button-login-help"
                >
                  Need help signing in?
                </button>
              </CollapsibleTrigger>
              <CollapsibleContent className="text-xs text-muted-foreground mt-2 space-y-2">
                <p>
                  Enter your username (or email) and click Next. Email
                  addresses are sent to your organization's single sign-on
                  provider; usernames continue to a password step. If you
                  can't sign in, contact your administrator to confirm your
                  account is active.
                </p>
              </CollapsibleContent>
            </Collapsible>
          </CardContent>
        </Card>
      </main>
      <Footer />
    </div>
  );
}
