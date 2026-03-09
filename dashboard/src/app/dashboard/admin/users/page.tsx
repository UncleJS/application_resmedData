import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import { listUsers } from "@/lib/queries/users";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  createUser,
  changePassword,
  archiveUserAction,
  restoreUserAction,
} from "./actions";

// ── Timestamp display helper ─────────────────────────────────────────────────
// Skill: nextjs-shadcn-dark — display local time as YYYY-MM-DD HH:mm:ss

function fmtUtc(iso: string | null): string {
  if (!iso) return "—";
  // Display UTC value directly in YYYY-MM-DD HH:mm:ss
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} UTC`
  );
}

// ── Page (server component) ──────────────────────────────────────────────────

export default async function UsersAdminPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.is_admin) redirect("/dashboard");

  const users = await listUsers();
  const active   = users.filter((u) => !u.archived_at_utc);
  const archived = users.filter((u) =>  u.archived_at_utc);

  return (
    <div className="space-y-8 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold text-foreground">User Management</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Create accounts, change passwords, and archive users.
        </p>
      </div>

      {/* ── Create user ───────────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Create User</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={createUser} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="username">Username</Label>
              <Input id="username" name="username" required maxLength={64} placeholder="jsmith" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <Input id="password" name="password" type="password" required minLength={8} placeholder="Min 8 chars" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="display_name">Display name (optional)</Label>
              <Input id="display_name" name="display_name" maxLength={128} placeholder="John Smith" />
            </div>
            <div className="flex items-end gap-3">
              <div className="flex items-center gap-2 pb-0.5">
                <input
                  type="checkbox"
                  id="is_admin"
                  name="is_admin"
                  value="1"
                  className="h-4 w-4 rounded border-border accent-primary"
                />
                <Label htmlFor="is_admin" className="cursor-pointer">Admin</Label>
              </div>
              <Button type="submit" className="ml-auto">Create</Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* ── Active users ──────────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Active Users
            <Badge variant="secondary" className="ml-2">{active.length}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {active.length === 0 ? (
            <p className="px-6 py-4 text-sm text-muted-foreground">No active users.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="px-6 py-3 text-left font-medium">Username</th>
                  <th className="px-6 py-3 text-left font-medium">Display name</th>
                  <th className="px-6 py-3 text-left font-medium">Role</th>
                  <th className="px-6 py-3 text-left font-medium">Created (UTC)</th>
                  <th className="px-6 py-3 text-left font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {active.map((u) => (
                  <tr key={u.id} className="border-b border-border last:border-0">
                    <td className="px-6 py-3 font-mono">{u.username}</td>
                    <td className="px-6 py-3 text-muted-foreground">{u.display_name ?? "—"}</td>
                    <td className="px-6 py-3">
                      {u.is_admin
                        ? <Badge variant="default">Admin</Badge>
                        : <Badge variant="outline">User</Badge>}
                    </td>
                    <td className="px-6 py-3 text-muted-foreground whitespace-nowrap">{fmtUtc(u.created_at_utc)}</td>
                    <td className="px-6 py-3">
                      <div className="flex items-center gap-2 flex-wrap">
                        {/* Change password */}
                        <form action={changePassword} className="flex items-center gap-1.5">
                          <input type="hidden" name="id" value={u.id} />
                          <Input
                            name="password"
                            type="password"
                            placeholder="New password"
                            minLength={8}
                            required
                            className="h-7 w-36 text-xs"
                          />
                          <Button type="submit" variant="outline" size="sm" className="h-7 text-xs px-2">
                            Set
                          </Button>
                        </form>
                        {/* Archive */}
                        <form action={archiveUserAction}>
                          <input type="hidden" name="id" value={u.id} />
                          <Button
                            type="submit"
                            variant="destructive"
                            size="sm"
                            className="h-7 text-xs px-2"
                          >
                            Archive
                          </Button>
                        </form>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {/* ── Archived users ────────────────────────────────────────────────── */}
      {archived.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base text-muted-foreground">
              Archived Users
              <Badge variant="outline" className="ml-2">{archived.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="px-6 py-3 text-left font-medium">Username</th>
                  <th className="px-6 py-3 text-left font-medium">Role</th>
                  <th className="px-6 py-3 text-left font-medium">Archived (UTC)</th>
                  <th className="px-6 py-3 text-left font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {archived.map((u) => (
                  <tr key={u.id} className="border-b border-border last:border-0 opacity-60">
                    <td className="px-6 py-3 font-mono">{u.username}</td>
                    <td className="px-6 py-3">
                      {u.is_admin
                        ? <Badge variant="default">Admin</Badge>
                        : <Badge variant="outline">User</Badge>}
                    </td>
                    <td className="px-6 py-3 text-muted-foreground whitespace-nowrap">{fmtUtc(u.archived_at_utc)}</td>
                    <td className="px-6 py-3">
                      <form action={restoreUserAction}>
                        <input type="hidden" name="id" value={u.id} />
                        <Button type="submit" variant="outline" size="sm" className="h-7 text-xs px-2">
                          Restore
                        </Button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
