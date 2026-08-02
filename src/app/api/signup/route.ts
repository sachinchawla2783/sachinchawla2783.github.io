import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";

const bodySchema = z.object({
  name: z.string().min(1).max(120),
  email: z.string().email(),
  password: z.string().min(8).max(200),
});

export async function POST(req: NextRequest) {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json(
      { error: "Accounts require DATABASE_URL to be configured. See README.md." },
      { status: 503 }
    );
  }

  let parsed;
  try {
    parsed = bodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Please provide a valid name, email, and password (min 8 characters)." }, { status: 400 });
  }

  const existing = await db.user.findUnique({ where: { email: parsed.email } });
  if (existing) {
    return NextResponse.json({ error: "An account with this email already exists." }, { status: 409 });
  }

  const passwordHash = await bcrypt.hash(parsed.password, 12);
  await db.user.create({
    data: { name: parsed.name, email: parsed.email, passwordHash },
  });

  return NextResponse.json({ ok: true });
}
