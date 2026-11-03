import { PageShell } from "@/shared/ui/shell/page-shell";
import { Card, CardContent } from "@/shared/ui/card";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/shared/ui/tabs";
import { useAuth } from "@/features/auth/presentation/auth-context";
import { UserInfoTab } from "@/features/auth/presentation/components/user-info-tab";
import { PasswordTab } from "@/features/auth/presentation/components/password-tab";

export function Profile() {
  const { user } = useAuth();
  if (!user) return null;
  const isSsoUser = user.authSource === "oidc";

  return (
    <PageShell
      showBack={false}
      mainClassName="flex items-start justify-center"
      contentClassName="w-full max-w-md"
    >
      <Card className="w-full max-w-md border-card-border">
        <CardContent className="p-8">
          <div className="mb-6">
            <h1 className="text-2xl font-semibold tracking-tight">
              My profile
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Manage your account details and password.
            </p>
          </div>
          <Tabs defaultValue="user-info" className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger
                value="user-info"
                data-testid="tab-profile-user-info"
              >
                User info
              </TabsTrigger>
              <TabsTrigger
                value="password"
                data-testid="tab-profile-password"
              >
                Password
              </TabsTrigger>
            </TabsList>
            <TabsContent value="user-info" className="mt-6">
              <UserInfoTab isSsoUser={isSsoUser} />
            </TabsContent>
            <TabsContent value="password" className="mt-6">
              <PasswordTab isSsoUser={isSsoUser} email={user.email ?? null} />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </PageShell>
  );
}
