import { ENV } from "./env";

const RESEND_API = "https://api.resend.com/emails";

interface NotifyOpts {
  subject: string;
  html: string;
}

/**
 * Sends a job-completion email via Resend's REST API. Deliberately
 * fire-and-log-only: a notification failure should never fail the job
 * whose completion it's reporting, so this always resolves (never
 * throws) and just logs if the send itself fails.
 *
 * This is plain server-to-server API usage — a different thing from the
 * Resend MCP server, which is for interactive/agent use, not for an
 * app's own backend to send its own transactional email.
 */
async function sendNotification({ subject, html }: NotifyOpts): Promise<void> {
  if (!ENV.RESEND_API_KEY) {
    console.warn("[notifications] RESEND_API_KEY not set — skipping email:", subject);
    return;
  }

  try {
    const res = await fetch(RESEND_API, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ENV.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: ENV.NOTIFICATION_FROM_EMAIL,
        to: ENV.NOTIFICATION_TO_EMAIL,
        subject,
        html,
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      console.error(`[notifications] Resend API error ${res.status}:`, body);
    }
  } catch (error) {
    console.error("[notifications] Failed to send email:", error);
  }
}

export async function notifyTrainingRunComplete(opts: {
  characterName: string;
  characterSlug: string;
  runId: number;
  status: "succeeded" | "failed";
  errorMessage?: string | null;
  estimatedCostUsd?: number | null;
}): Promise<void> {
  const isSuccess = opts.status === "succeeded";
  const subject = isSuccess
    ? `✅ Training run #${opts.runId} succeeded — ${opts.characterName}`
    : `❌ Training run #${opts.runId} failed — ${opts.characterName}`;

  const html = isSuccess
    ? `<p>LoRA training completed for <strong>${opts.characterName}</strong> (${opts.characterSlug}).</p>
       <p>Run ID: ${opts.runId}</p>
       ${opts.estimatedCostUsd ? `<p>Estimated cost: $${opts.estimatedCostUsd.toFixed(2)}</p>` : ""}
       <p>The checkpoint is ready — head to the Create stage to generate from it.</p>`
    : `<p>Training run #${opts.runId} for <strong>${opts.characterName}</strong> (${opts.characterSlug}) failed.</p>
       <p>Error: ${opts.errorMessage ?? "unknown — check training-runs table and instance logs"}</p>`;

  await sendNotification({ subject, html });
}

export async function notifyGenerationComplete(opts: {
  characterName: string;
  characterSlug: string;
  generationId: number;
  status: "succeeded" | "failed";
  errorMessage?: string | null;
}): Promise<void> {
  const isSuccess = opts.status === "succeeded";
  const subject = isSuccess
    ? `✅ Generation #${opts.generationId} ready — ${opts.characterName}`
    : `❌ Generation #${opts.generationId} failed — ${opts.characterName}`;

  const html = isSuccess
    ? `<p>Generation complete for <strong>${opts.characterName}</strong> (${opts.characterSlug}).</p>
       <p>Generation ID: ${opts.generationId}</p>`
    : `<p>Generation #${opts.generationId} for <strong>${opts.characterName}</strong> (${opts.characterSlug}) failed.</p>
       <p>Error: ${opts.errorMessage ?? "unknown"}</p>`;

  await sendNotification({ subject, html });
}
