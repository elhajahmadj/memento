import { PageShell } from "@/shared/ui/shell/page-shell";
import { Card, CardContent } from "@/shared/ui/card";

const LAST_UPDATED = "June 19, 2026";

export function Privacy() {
  return (
    <PageShell
      contentClassName="max-w-4xl"
      backTestId="button-privacy-back"
      backLabel="Back to home"
    >
      <h1
        className="text-3xl font-semibold mb-2"
        data-testid="text-privacy-title"
      >
        Privacy Policy
      </h1>
      <p className="text-muted-foreground mb-2">
        How memento collects, uses, and protects your information.
      </p>
      <p
        className="text-xs text-muted-foreground mb-8"
        data-testid="text-privacy-updated"
      >
        Last updated {LAST_UPDATED}
      </p>

      <Card className="border-card-border mb-6">
        <CardContent className="p-6 space-y-3">
          <h2 className="text-xl font-semibold">Overview</h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            memento ("the app", "we", "us") is a workbench for recording browser
            interactions and generating automated tests. This policy explains
            what information we collect when you use the app, how we use it, and
            the choices you have. By using memento you agree to the practices
            described here.
          </p>
        </CardContent>
      </Card>

      <Card className="border-card-border mb-6">
        <CardContent className="p-6 space-y-3">
          <h2 className="text-xl font-semibold">Information we collect</h2>
          <ul className="list-disc pl-5 text-sm text-muted-foreground leading-relaxed space-y-2">
            <li>
              <span className="font-medium text-foreground">Account information.</span>{" "}
              When you sign in (locally or via single sign-on) we store your
              username, email, role, and organization membership to manage
              access.
            </li>
            <li>
              <span className="font-medium text-foreground">Project content.</span>{" "}
              Test projects, recorded steps, assertions, and generated test code
              you create are stored so the app can function.
            </li>
            <li>
              <span className="font-medium text-foreground">Credentials you provide.</span>{" "}
              Source-control tokens and AI provider keys are encrypted at rest
              and used only to perform the actions you request.
            </li>
            <li>
              <span className="font-medium text-foreground">Usage and diagnostic data.</span>{" "}
              We keep operational logs (such as request timing and errors) to
              keep the service reliable and secure.
            </li>
          </ul>
        </CardContent>
      </Card>

      <Card className="border-card-border mb-6">
        <CardContent className="p-6 space-y-3">
          <h2 className="text-xl font-semibold">How we use information</h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            We use the information we collect to operate and maintain the app,
            authenticate you, save and run your test projects, provide
            role-based access control, and improve reliability and security. We
            do not sell your personal information.
          </p>
        </CardContent>
      </Card>

      <Card className="border-card-border mb-6">
        <CardContent className="p-6 space-y-3">
          <h2 className="text-xl font-semibold">Third-party services</h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            When you connect a source-control provider or an AI provider, the
            data needed to fulfill your request (for example, code to commit or
            a prompt to generate a test) is sent to that provider and is subject
            to its own privacy policy. We only share what is necessary to carry
            out the action you initiate.
          </p>
        </CardContent>
      </Card>

      <Card className="border-card-border mb-6">
        <CardContent className="p-6 space-y-3">
          <h2 className="text-xl font-semibold">Data retention &amp; security</h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            We retain your data for as long as your account is active or as
            needed to provide the service. Sensitive credentials are encrypted,
            and access is restricted by role. No method of transmission or
            storage is completely secure, but we take reasonable measures to
            protect your information.
          </p>
        </CardContent>
      </Card>

      <Card className="border-card-border mb-6">
        <CardContent className="p-6 space-y-3">
          <h2 className="text-xl font-semibold">Your choices</h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            You may request access to, correction of, or deletion of your
            personal information, and you can disconnect any third-party
            integration at any time from the app's settings. To make a request,
            contact us using the details below.
          </p>
        </CardContent>
      </Card>

      <Card className="border-card-border" data-testid="card-privacy-contact">
        <CardContent className="p-6 space-y-3">
          <h2 className="text-xl font-semibold">Contact</h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Questions about this policy or your data? Reach out at{" "}
            <a
              href="mailto:ElhajAhmadJ@gmail.com"
              className="text-primary hover:underline"
              data-testid="link-privacy-contact-email"
            >
              ElhajAhmadJ@gmail.com
            </a>
            .
          </p>
          <p className="text-xs text-muted-foreground leading-relaxed">
            This policy may be updated from time to time. Material changes will
            be reflected by the "Last updated" date above.
          </p>
        </CardContent>
      </Card>
    </PageShell>
  );
}
