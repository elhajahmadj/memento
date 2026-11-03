import { FormEvent, useState } from "react";
import { Loader2, Save } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { useAuth } from "@/features/auth/presentation/auth-context";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const IDP_PROFILE_URL = "https://your-idp.example.com/profile";

export function UserInfoTab({ isSsoUser }: { isSsoUser: boolean }) {
  const { user, updateProfile } = useAuth();
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
  const allFilled = !!fn && !!ln && !!tt && !!em && emailValid;

  const changed =
    fn !== (user?.firstName ?? "").trim() ||
    ln !== (user?.lastName ?? "").trim() ||
    tt !== (user?.title ?? "").trim() ||
    (!isSsoUser && em !== (user?.email ?? "").trim());

  const isValid = allFilled && changed;

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
      toast.success("Profile updated");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save profile.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form className="space-y-4" onSubmit={onSubmit} noValidate>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label htmlFor="firstName">First name</Label>
          <Input
            id="firstName"
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            autoComplete="given-name"
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
          onChange={(e) => {
            if (!isSsoUser) setEmail(e.target.value);
          }}
          readOnly={isSsoUser}
          aria-readonly={isSsoUser || undefined}
          className={isSsoUser ? "bg-muted text-muted-foreground" : undefined}
          autoComplete="email"
          data-testid="input-email"
        />
        {isSsoUser && (
          <a
            href={IDP_PROFILE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-brand hover:underline"
            data-testid="link-update-on-nexus"
          >
            Update at your identity provider
          </a>
        )}
        {!isSsoUser && em.length > 0 && !emailValid && (
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
  );
}
