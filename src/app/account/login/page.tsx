"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const res = await signIn("credentials", { email, password, redirect: false });
    setLoading(false);

    if (res?.error) {
      setError("Invalid email or password.");
      return;
    }
    router.push("/account");
    router.refresh();
  }

  return (
    <div className="container-lipids flex min-h-[70vh] items-center justify-center py-section">
      <div className="w-full max-w-sm">
        <p className="eyebrow mb-4">Account</p>
        <h1 className="mb-10 font-display text-display-md font-bold uppercase leading-none">
          Sign In
        </h1>

        <form onSubmit={onSubmit} className="flex flex-col gap-5">
          <div>
            <label className="mb-2 block text-micro uppercase tracking-widest2 font-mono">Email</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full border border-stone-300 bg-transparent px-4 py-3 text-sm focus:border-ink focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-2 block text-micro uppercase tracking-widest2 font-mono">Password</label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full border border-stone-300 bg-transparent px-4 py-3 text-sm focus:border-ink focus:outline-none"
            />
          </div>

          {error && <p className="text-sm text-red-700">{error}</p>}

          <button type="submit" disabled={loading} className="btn-primary mt-2 w-full">
            {loading ? "Signing In…" : "Sign In"}
          </button>
        </form>

        <p className="mt-8 text-sm text-stone-500">
          Don&apos;t have an account?{" "}
          <Link href="/account/signup" className="link-underline text-ink">
            Create one
          </Link>
        </p>
      </div>
    </div>
  );
}
