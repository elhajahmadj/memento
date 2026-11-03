import { FormEvent, useState } from "react";
import { useLocation } from "wouter";
import { Loader2, Save } from "lucide-react";
import { PageShell } from "@/shared/ui/shell/page-shell";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Card, CardContent } from "@/shared/ui/card";
import { useAuth } from "@/features/auth/presentation/auth-context";
import { toast } from "sonner";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function ProfileComplete() {
  const [, navigate] = useLocation();
  const { user, updateProfile } = useAuth();
  const isEditing = user?.profileComplete === true;

  const [firstName, setFirstName] = useState(user?.firstName ?? "");
  const [lastName, setLastName] = useState(user?.lastName ?? "");
  const [title, setTitle] = useState(user?.title ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fn = firstName.trim();
  const ln = lastName.trim();
  const tt = title.trim();
  const em = email.trim();
  const emailValid = EMAIL_RE.test(em);
  const isValid = !!fn && !!ln && !!tt && !!em && emailValid;

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!isValid) return;
    setSubmitting(true);
    setError(null);
    try {
      await updateProfile({
        firstName: fn,
        lastName: ln,
        title: tt,
        email: em,
      });
      toast.success(isEditing ? "Profile updated" : "Profile saved");
      if (!isEditing) navigate("/", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save profile.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <PageShell
      showBack={false}
      showUserMenu={isEditing}
      mainClassName="flex items-center justify-center"
      contentClassName="w-full max-w-md"
    >
      <Card className="w-full max-w-md border-card-border">
          <CardContent className="p-8">
            <div className="mb-6">
              <h1 className="text-2xl font-semibold tracking-tight">
                {isEditing ? "My profile" : "Complete your profile"}
              </h1>
              <p className="text-sm text-muted-foreground mt-1">
                {isEditing
                  ? "Update your name, title, and email."
                  : "Tell us a bit about yourself before continuing."}
              </p>
            </div>
            <form className="space-y-4" onSubmit={onSubmit} noValidate>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="firstName">First name</Label>
                  <Input
                    id="firstName"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    autoComplete="given-name"
                    autoFocus
                    data-testid="input-first-name"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="lastName">Last name</Label>
                  <Input
                    id="lastName"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    autoComplete="family-name"
                    data-testid="input-last-name"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="title">Title</Label>
                <Input
                  id="title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. QA Engineer"
                  autoComplete="organization-title"
                  data-testid="input-title"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  data-testid="input-email"
                />
                {em.length > 0 && !emailValid && (
                  <p
                    className="text-xs text-destructive"
                    data-testid="text-email-invalid"
                  >
                    Enter a valid email address.
                  </p>
                )}
              </div>
              {error && (
                <div
                  className="text-sm text-destructive"
                  data-testid="text-profile-error"
                >
                  {error}
                </div>
              )}
              <Button
                type="submit"
                className="w-full"
                disabled={!isValid || submitting}
                data-testid="button-save-profile"
              >
                {submitting ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Save className="h-4 w-4 mr-2" />
                )}
                Save
              </Button>
            </form>
          </CardContent>
        </Card>
    </PageShell>
  );
}
