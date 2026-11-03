import { useIsAnyAdmin, useIsGuest } from "@/features/auth/presentation/role";
import { AdminProjectsHome } from "../components/admin-projects-home";
import { GuestHome } from "../components/guest-home";
import { LimitedHome } from "../components/limited-home";

export function Home() {
  const isAnyAdmin = useIsAnyAdmin();
  // Checked first: a guest is not an admin, so without this they would
  // fall through to `LimitedHome`, whose fork / approval / lifecycle
  // queries are all closed to guests server-side.
  const isGuest = useIsGuest();
  if (isGuest) return <GuestHome />;
  if (!isAnyAdmin) return <LimitedHome />;
  return <AdminProjectsHome />;
}
