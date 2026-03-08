import Link from "next/link";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Activity, BarChart2, Calendar, LineChart, LogOut } from "lucide-react";

const navItems = [
  { href: "/dashboard",         label: "Summary",    icon: Activity },
  { href: "/dashboard/sessions",label: "Sessions",   icon: Calendar },
  { href: "/dashboard/trends",  label: "Trends",     icon: LineChart },
  { href: "/dashboard/events",  label: "Events",     icon: BarChart2 },
];

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");

  return (
    <div className="flex min-h-screen">
      {/* Sidebar */}
      <aside className="w-52 shrink-0 border-r border-border bg-card flex flex-col">
        <div className="px-4 py-5 border-b border-border">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">ResMed</p>
          <p className="text-sm font-semibold text-foreground mt-0.5">Sleep Dashboard</p>
        </div>
        <nav className="flex-1 p-3 space-y-1">
          {navItems.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className="flex items-center gap-2.5 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
            >
              <Icon className="h-4 w-4 shrink-0" />
              {label}
            </Link>
          ))}
        </nav>
        <div className="p-3 border-t border-border">
          <p className="text-xs text-muted-foreground mb-2 px-3 truncate">{session.user?.name}</p>
          <form action="/api/auth/signout" method="POST">
            <Button variant="ghost" size="sm" className="w-full justify-start gap-2 text-muted-foreground">
              <LogOut className="h-4 w-4" /> Sign out
            </Button>
          </form>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto p-6">{children}</main>
    </div>
  );
}
