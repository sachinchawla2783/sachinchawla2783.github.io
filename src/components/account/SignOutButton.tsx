"use client";

import { signOut } from "next-auth/react";

export function SignOutButton() {
  return (
    <button
      onClick={() => signOut({ callbackUrl: "/" })}
      className="text-micro uppercase tracking-widest2 font-mono link-underline"
    >
      Sign Out
    </button>
  );
}
