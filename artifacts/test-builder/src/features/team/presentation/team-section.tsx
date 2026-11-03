import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/shared/ui/button";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/shared/ui/tabs";
import { UsersSection } from "@/features/admin/presentation/sections/users-section";
import { InviteTeammateWizard } from "./invite-teammate-wizard";
import { PendingInvitationsTab } from "./pending-invitations-tab";

/**
 * Plain-language Team admin surface. Replaces the old "Users"
 * collapsible. Two tabs: Members (the existing user table) and
 * Pending invitations. Both share a single "Invite teammate" button
 * in the section header which opens the 4-step wizard.
 */
export function TeamSection({ viewerIsAdmin }: { viewerIsAdmin: boolean }) {
  const [inviteOpen, setInviteOpen] = useState(false);

  return (
    <section data-testid="section-team">
      {viewerIsAdmin && (
        <div className="flex items-center justify-end mb-4">
          <Button
            size="sm"
            onClick={() => setInviteOpen(true)}
            data-testid="button-invite-teammate"
          >
            <Plus className="h-4 w-4 mr-1" />
            Invite teammate
          </Button>
        </div>
      )}

      <Tabs defaultValue="members" className="w-full">
        <TabsList>
          <TabsTrigger value="members" data-testid="tab-team-members">
            Members
          </TabsTrigger>
          <TabsTrigger
            value="pending"
            data-testid="tab-team-pending-invitations"
          >
            Pending invitations
          </TabsTrigger>
        </TabsList>
        <TabsContent value="members" className="mt-4">
          <UsersSection viewerIsAdmin={viewerIsAdmin} />
        </TabsContent>
        <TabsContent value="pending" className="mt-4">
          <PendingInvitationsTab />
        </TabsContent>
      </Tabs>

      {viewerIsAdmin && (
        <InviteTeammateWizard
          open={inviteOpen}
          onOpenChange={setInviteOpen}
        />
      )}
    </section>
  );
}
