import fs from "node:fs";
import type { ScheduleJob } from "@aihub/shared";
import { SCHEDULES_PATH } from "../config/index.js";

export type ScheduleStore = {
  version: number;
  jobs: ScheduleJob[];
};

export function loadScheduleStore(): ScheduleStore {
  if (!fs.existsSync(SCHEDULES_PATH)) {
    return { version: 1, jobs: [] };
  }

  try {
    const raw = fs.readFileSync(SCHEDULES_PATH, "utf8");
    return JSON.parse(raw) as ScheduleStore;
  } catch {
    return { version: 1, jobs: [] };
  }
}

export function saveScheduleStore(store: ScheduleStore): void {
  const dir = SCHEDULES_PATH.substring(0, SCHEDULES_PATH.lastIndexOf("/"));
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(SCHEDULES_PATH, JSON.stringify(store, null, 2));
}
