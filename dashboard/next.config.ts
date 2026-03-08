import fs from "fs";
import path from "path";
import type { NextConfig } from "next";

function readTimezone(): string {
  try {
    const raw = fs.readFileSync(path.resolve(__dirname, "../config.ini"), "utf8");
    const m = raw.match(/^\s*timezone\s*=\s*(.+)$/m);
    return m?.[1]?.trim() ?? "UTC";
  } catch {
    return "UTC";
  }
}

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["mysql2"],
  env: { NEXT_PUBLIC_TIMEZONE: readTimezone() },
};

export default nextConfig;
