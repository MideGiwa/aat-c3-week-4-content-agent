// Discord notifications for pipeline lifecycle events. This used to be
// n8n's job (n8n-publish-workflow.json's "Notify Discord (...)" nodes) —
// n8n is retired (2026-09-18, see DESIGN.md's decisions log), and the
// notifications that still matter (generation ready for review, pipeline
// failures) move here, into the same Next.js server code that already runs
// the pipeline.
//
// Fire-and-forget by design: a notification failing (missing webhook URL,
// Discord being down) should never fail or block the pipeline itself.

import { DISCORD_WEBHOOK_URL } from "./config";

export async function notifyDiscord(message: string): Promise<void> {
  if (!DISCORD_WEBHOOK_URL) return;

  try {
    const res = await fetch(DISCORD_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: message }),
    });
    if (!res.ok) {
      console.error(`Discord notification failed: ${res.status} ${await res.text()}`);
    }
  } catch (err) {
    console.error("Discord notification failed:", err);
  }
}
