import { PageShell } from "@/shared/ui/shell/page-shell";
import { Card, CardContent } from "@/shared/ui/card";

const LAST_UPDATED = "June 19, 2026";

export function Terms() {
  return (
    <PageShell
      contentClassName="max-w-4xl"
      backTestId="button-terms-back"
      backLabel="Back to home"
    >
      <h1
        className="text-3xl font-semibold mb-2"
        data-testid="text-terms-title"
      >
        Terms of Service
      </h1>
      <p className="text-muted-foreground mb-2">
        The terms that govern your use of memento.
      </p>
      <p
        className="text-xs text-muted-foreground mb-8"
        data-testid="text-terms-updated"
      >
        Last updated {LAST_UPDATED}
      </p>

      <Card className="border-card-border mb-6">
        <CardContent className="p-6 space-y-3">
          <h2 className="text-xl font-semibold">Acceptance of terms</h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            memento ("the app", "we", "us") is a workbench for recording browser
            interactions and generating automated tests. By accessing or using
            the app you agree to be bound by these Terms of Service. If you do
            not agree to these terms, do not use the app. If you are using the
            app on behalf of an organization, you represent that you have the
            authority to bind that organization to these terms.
          </p>
        </CardContent>
      </Card>

      <Card className="border-card-border mb-6">
        <CardContent className="p-6 space-y-3">
          <h2 className="text-xl font-semibold">Description of service</h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            memento lets you scaffold test projects, record browser
            interactions, generate automated test code in multiple languages,
            and run validations against your projects. The app is provided on an
            ongoing basis and may evolve over time as features are added,
            changed, or removed.
          </p>
        </CardContent>
      </Card>

      <Card className="border-card-border mb-6">
        <CardContent className="p-6 space-y-3">
          <h2 className="text-xl font-semibold">Acceptable use</h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            You agree to use the app only for lawful purposes and in accordance
            with these terms. You will not:
          </p>
          <ul className="list-disc pl-5 text-sm text-muted-foreground leading-relaxed space-y-2">
            <li>
              Use the app to record or test sites you are not authorized to
              access or test.
            </li>
            <li>
              Attempt to disrupt, overload, or gain unauthorized access to the
              app, its infrastructure, or other users' data.
            </li>
            <li>
              Reverse engineer, resell, or misuse the app except as expressly
              permitted.
            </li>
            <li>
              Use the app to store or transmit unlawful, infringing, or harmful
              content.
            </li>
          </ul>
        </CardContent>
      </Card>

      <Card className="border-card-border mb-6">
        <CardContent className="p-6 space-y-3">
          <h2 className="text-xl font-semibold">User content &amp; credentials</h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            You retain ownership of the test projects, recorded steps,
            assertions, and generated code you create in the app. You are
            responsible for the content you create and for any credentials —
            such as source-control tokens and AI provider keys — that you
            provide. Keep your credentials secure; you are responsible for
            activity that occurs under your account. We store credentials
            encrypted and use them only to perform the actions you request.
          </p>
        </CardContent>
      </Card>

      <Card className="border-card-border mb-6">
        <CardContent className="p-6 space-y-3">
          <h2 className="text-xl font-semibold">Third-party services</h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            When you connect a source-control provider or an AI provider, your
            use of those services is subject to their own terms and policies. We
            are not responsible for the availability, accuracy, or conduct of
            any third-party service, and we only share what is necessary to
            carry out the action you initiate.
          </p>
        </CardContent>
      </Card>

      <Card className="border-card-border mb-6">
        <CardContent className="p-6 space-y-3">
          <h2 className="text-xl font-semibold">
            Disclaimers &amp; limitation of liability
          </h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            The app is provided "as is" and "as available" without warranties of
            any kind, whether express or implied, including but not limited to
            warranties of merchantability, fitness for a particular purpose, and
            non-infringement. We do not warrant that the app will be
            uninterrupted, error-free, or secure. To the maximum extent
            permitted by law, we will not be liable for any indirect,
            incidental, special, consequential, or punitive damages, or for any
            loss of data, arising out of or related to your use of the app.
          </p>
        </CardContent>
      </Card>

      <Card className="border-card-border mb-6">
        <CardContent className="p-6 space-y-3">
          <h2 className="text-xl font-semibold">Changes to terms</h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            We may update these terms from time to time. Material changes will
            be reflected by the "Last updated" date above. Your continued use of
            the app after changes take effect constitutes your acceptance of the
            revised terms.
          </p>
        </CardContent>
      </Card>

      <Card className="border-card-border" data-testid="card-terms-contact">
        <CardContent className="p-6 space-y-3">
          <h2 className="text-xl font-semibold">Contact</h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Questions about these terms? Reach out at{" "}
            <a
              href="mailto:ElhajAhmadJ@gmail.com"
              className="text-primary hover:underline"
              data-testid="link-terms-contact-email"
            >
              ElhajAhmadJ@gmail.com
            </a>
            .
          </p>
          <p className="text-xs text-muted-foreground leading-relaxed">
            These terms may be updated from time to time. Material changes will
            be reflected by the "Last updated" date above.
          </p>
        </CardContent>
      </Card>
    </PageShell>
  );
}
