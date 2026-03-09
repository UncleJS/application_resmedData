"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useCallback } from "react";

const OPTIONS = [7, 14, 30, 60, 90, 120, 150, 180, 270, 360, 540, 720, 900, 1080] as const;

export default function DaysSelect({ value }: { value: number }) {
  const router       = useRouter();
  const pathname     = usePathname();
  const searchParams = useSearchParams();

  const onChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set("days", e.target.value);
      router.push(`${pathname}?${params.toString()}`);
    },
    [router, pathname, searchParams]
  );

  return (
    <select
      value={value}
      onChange={onChange}
      className="rounded border border-border bg-card text-foreground text-sm px-2 py-1 focus:outline-none focus:ring-1 focus:ring-ring cursor-pointer"
    >
      {OPTIONS.map((d) => (
        <option key={d} value={d}>
          Last {d} days
        </option>
      ))}
    </select>
  );
}
