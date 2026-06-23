import { requireUser } from "@/lib/session";
import { Sidebar } from "@/components/sidebar";
import { Topbar } from "@/components/topbar";
import { CommandPalette } from "@/components/command-palette";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Topbar email={user.email} />
        <main className="flex-1 overflow-auto p-6">
          <div className="mx-auto max-w-6xl">{children}</div>
        </main>
      </div>
      <CommandPalette />
    </div>
  );
}
