import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: NextRequest) {
  try {
    const { email } = await req.json();
    if (!email || !email.includes("@")) {
      return NextResponse.json({ error: "Invalid email" }, { status: 400 });
    }

    const { error } = await supabase
      .from("waitlist")
      .insert({ email: email.toLowerCase().trim() });

    if (error) {
      // Unique constraint = already signed up — treat as success
      if (error.code === "23505") {
        return NextResponse.json({ status: "already_registered" });
      }
      throw error;
    }

    return NextResponse.json({ status: "ok" });
  } catch (e) {
    console.error("Waitlist error:", e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
