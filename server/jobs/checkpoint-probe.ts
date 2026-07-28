import { buildPath, readJson } from "../storage";

export interface ProbeStatusEntry {
  step: number;
  sampleImageGcsPaths: string[];
  anchorDescription: string;
}

export interface ProbeStatusFile {
  runId: number;
  probes: ProbeStatusEntry[];
}

/**
 * Reads the probes/status.json a training container writes mid-run (see
 * write_probe_status in server/jobs/training-image/entrypoint.py) — the
 * same "poll a small JSON file instead of listing the bucket" pattern
 * training completion already uses in
 * app/api/training-runs/[id]/status/route.ts, just a different file.
 * Returns null if the run has no probe entries yet, or probing wasn't
 * enabled for it (see trainingRuns.hyperparams.probeIntervalSteps).
 */
export async function readProbeStatus(
  characterSlug: string,
  trainingRunId: number
): Promise<ProbeStatusFile | null> {
  return readJson<ProbeStatusFile>(
    buildPath(characterSlug, "checkpoints", `${trainingRunId}/probes/status.json`)
  );
}

/** Pure: which probe entries in the status file aren't reflected in `existingSteps` yet. */
export function newProbeEntries(
  statusFile: ProbeStatusFile | null,
  existingSteps: ReadonlySet<number>
): ProbeStatusEntry[] {
  if (!statusFile) return [];
  return statusFile.probes.filter((entry) => !existingSteps.has(entry.step));
}
