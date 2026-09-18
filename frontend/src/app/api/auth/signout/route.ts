import { NextRequest, NextResponse } from "next/server";
import { getSupabaseRouteClient } from "@/lib/supabase/routeClient";

export async function POST(request: NextRequest) {
  const supabase = getSupabaseRouteClient();
  await supabase.auth.signOut();
  return NextResponse.redirect(new URL("/login", request.url));
}
