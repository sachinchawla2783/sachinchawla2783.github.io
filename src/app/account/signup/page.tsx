"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";

export default function SignupPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const res = await fetch("/api/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email, password }),
    });
    const data = await res.json();

    if (!res.ok) {
      setError(data.error ?? "Something went wrong.");
      setLoading(false);
      return;
    }

    const signInRes = await signIn("credentials", { email, password, redirect: false });
    setLoading(false);

    if (signInRes?.error) {
      router.push("/account/login");
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
          Create Account
        </h1>

        <form onSubmit={onSubmit} className="flex flex-col gap-5">
          <div>
            <label className="mb-2 block text-micro uppercase tracking-widest2 font-mono">Name</label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full border border-stone-300 bg-transparent px-4 py-3 text-sm focus:border-ink focus:outline-none"
            />
          </div>
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
            <label className="mb-2 block text-micro uppercase tracking-widest2 font-mono">
              Password (min. 8 characters)
            </label>
            <input
              type="password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full border border-stone-300 bg-transparent px-4 py-3 text-sm focus:border-ink focus:outline-none"
            />
          </div>

          {error && <p className="text-sm text-red-700">{error}</p>}

          <button type="submit" disabled={loading} className="btn-primary mt-2 w-full">
            {loading ? "Creating Account…" : "Create Account"}
          </button>
        </form>

        <p className="mt-8 text-sm text-stone-500">
          Already have an account?{" "}
          <Link href="/account/login" className="link-underline text-ink">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
