import { GoogleAuth } from "google-auth-library";
import { ENV } from "../env";

const COMPUTE_API = "https://compute.googleapis.com/compute/v1";

let _auth: GoogleAuth | null = null;
function auth(): GoogleAuth {
  if (!_auth) {
    _auth = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"] });
  }
  return _auth;
}

export async function authedFetch(url: string, init?: RequestInit): Promise<Response> {
  const client = await auth().getClient();
  const token = await client.getAccessToken();
  const res = await fetch(url, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      Authorization: `Bearer ${token.token}`,
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Compute API error ${res.status}: ${body}`);
  }
  return res;
}

export interface SpotInstanceSpec {
  name: string;
  zone: string;
  machineType: string;
  acceleratorType?: string; // omit for CPU-only jobs (e.g. lightweight captioning that doesn't need a GPU)
  acceleratorCount?: number;
  sourceImage: string;
  diskSizeGb?: string;
  startupScript: string;
  tags?: string[];
}

/** Creates a spot (or standard, if USE_SPOT_INSTANCES=false) GCE instance from a startup script. Generic across job types. */
export async function createSpotInstance(spec: SpotInstanceSpec): Promise<void> {
  const body: Record<string, unknown> = {
    name: spec.name,
    machineType: `zones/${spec.zone}/machineTypes/${spec.machineType}`,
    // GPU-attached instances can't live-migrate, so onHostMaintenance must be
    // TERMINATE regardless of spot vs on-demand — GCE's default (MIGRATE) is
    // rejected outright for any VM with guestAccelerators.
    scheduling: ENV.USE_SPOT_INSTANCES
      ? { provisioningModel: "SPOT", instanceTerminationAction: "DELETE", onHostMaintenance: "TERMINATE" }
      : { onHostMaintenance: "TERMINATE" },
    disks: [
      {
        boot: true,
        autoDelete: true,
        initializeParams: {
          sourceImage: spec.sourceImage,
          diskSizeGb: spec.diskSizeGb ?? "50",
        },
      },
    ],
    networkInterfaces: [{ network: "global/networks/default" }],
    metadata: { items: [{ key: "startup-script", value: spec.startupScript }] },
    tags: { items: spec.tags ?? [] },
    // Without this, the VM has no service account attached at all (the
    // Compute API, unlike `gcloud`, does not default to the project's
    // Compute Engine service account) — the metadata server then 404s on
    // service-accounts/default/token, so gsutil/docker auth inside the
    // startup script fails before the job container ever runs.
    serviceAccounts: [
      {
        email: `avatar-foundry-app@${ENV.GCP_PROJECT_ID}.iam.gserviceaccount.com`,
        scopes: ["https://www.googleapis.com/auth/cloud-platform"],
      },
    ],
  };

  if (spec.acceleratorType) {
    body.guestAccelerators = [
      {
        acceleratorType: `zones/${spec.zone}/acceleratorTypes/${spec.acceleratorType}`,
        acceleratorCount: spec.acceleratorCount ?? 1,
      },
    ];
  }

  await authedFetch(
    `${COMPUTE_API}/projects/${ENV.GCP_PROJECT_ID}/zones/${spec.zone}/instances`,
    { method: "POST", body: JSON.stringify(body) }
  );
}

export async function isInstanceRunning(instanceName: string, zone: string): Promise<boolean> {
  try {
    const res = await authedFetch(
      `${COMPUTE_API}/projects/${ENV.GCP_PROJECT_ID}/zones/${zone}/instances/${instanceName}`
    );
    const data = await res.json();
    return ["RUNNING", "PROVISIONING", "STAGING"].includes(data.status);
  } catch {
    return false; // 404 -> instance is gone -> job finished (one way or another)
  }
}

export async function deleteInstance(instanceName: string, zone: string): Promise<void> {
  await authedFetch(
    `${COMPUTE_API}/projects/${ENV.GCP_PROJECT_ID}/zones/${zone}/instances/${instanceName}`,
    { method: "DELETE" }
  );
}
