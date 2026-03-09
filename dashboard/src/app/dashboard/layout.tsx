import Link from "next/link";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Activity, BarChart2, Calendar, LineChart, LogOut, Users } from "lucide-react";

const navItems = [
  { href: "/dashboard",         label: "Summary",    icon: Activity },
  { href: "/dashboard/sessions",label: "Sessions",   icon: Calendar },
  { href: "/dashboard/trends",  label: "Trends",     icon: LineChart },
  { href: "/dashboard/events",  label: "Events",     icon: BarChart2 },
];

const adminNavItems = [
  { href: "/dashboard/admin/users", label: "Users", icon: Users },
];

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");

  const isAdmin = session.user?.is_admin === true;

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
          {isAdmin && (
            <>
              <div className="pt-3 pb-1 px-3">
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">Admin</p>
              </div>
              {adminNavItems.map(({ href, label, icon: Icon }) => (
                <Link
                  key={href}
                  href={href}
                  className="flex items-center gap-2.5 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  {label}
                </Link>
              ))}
            </>
          )}
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

      {/* Main content + footer */}
      <div className="flex-1 flex flex-col overflow-auto">
        <main className="flex-1 p-6">{children}</main>
        <footer className="shrink-0 border-t border-border px-6 py-3 text-xs text-muted-foreground flex items-center gap-1.5">
          <span>©&nbsp;{new Date().getFullYear()}</span>
          <span>·</span>
          <a
            href="https://creativecommons.org/licenses/by-nc-sa/4.0/"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-foreground transition-colors"
          >
            CC BY-NC-SA 4.0
          </a>
          <span>·</span>
          <span>ResMed Sleep Dashboard</span>
        </footer>
      </div>
    </div>
  );
}
