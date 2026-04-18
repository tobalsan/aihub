import fs from "node:fs";
import path from "node:path";
import type { ScheduleJob } from "@aihub/shared";

export type ScheduleStore = {
  version: number;
  jobs: ScheduleJob[];
};

function getSchedulesPath(dataDir: string): string {
  return path.join(dataDir, "schedules.json");
}

export function loadScheduleStore(dataDir: string): ScheduleStore {
  const schedulesPath = getSchedulesPath(dataDir);
  if (!fs.existsSync(schedulesPath)) {
    return { version: 1, jobs: [] };
  }

  try {
    const raw = fs.readFileSync(schedulesPath, "utf8");
    return JSON.parse(raw) as ScheduleStore;
  } catch {
    return { version: 1, jobs: [] };
  }
}

export function saveScheduleStore(store: ScheduleStore, dataDir: string): void {
  const schedulesPath = getSchedulesPath(dataDir);
  const dir = path.dirname(schedulesPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(schedulesPath, JSON.stringify(store, null, 2));
}
