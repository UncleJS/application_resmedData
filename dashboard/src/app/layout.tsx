import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "ResMed Sleep Dashboard",
  description: "CPAP therapy analytics",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen flex flex-col antialiased">
        <Providers>
          <div className="flex-1">{children}</div>
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
        </Providers>
      </body>
    </html>
  );
}
