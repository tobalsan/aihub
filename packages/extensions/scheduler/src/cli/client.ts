import type {
  CreateScheduleRequest,
  ScheduleJob,
  UpdateScheduleRequest,
} from "@aihub/shared";
import { resolveConfig } from "./config.js";

type HttpMethod = "GET" | "POST" | "PATCH" | "DELETE";

type RequestOptions = {
  method?: HttpMethod;
  body?: unknown;
};

export class SchedulerApiClient {
  private readonly baseUrl: string;
  private readonly token?: string;

  constructor(config = resolveConfig()) {
    this.baseUrl = config.apiUrl;
    this.token = config.token;
  }

  async request<T = unknown>(
    path: string,
    options: RequestOptions = {}
  ): Promise<T> {
    const url = new URL(`/api${path}`, this.baseUrl).toString();
    const headers: Record<string, string> = {};

    if (options.body !== undefined) {
      headers["Content-Type"] = "application/json";
    }
    if (this.token) {
      headers.Authorization = `Bearer ${this.token}`;
    }

    const res = await fetch(url, {
      method: options.method ?? "GET",
      headers,
      body:
        options.body === undefined ? undefined : JSON.stringify(options.body),
    });

    const text = await res.text();
    const data = text ? safeJson(text) : {};
    if (!res.ok) {
      const error =
        typeof data === "object" &&
        data !== null &&
        "error" in data &&
        typeof (data as { error: unknown }).error === "string"
          ? (data as { error: string }).error
          : `Request failed (${res.status})`;
      throw new Error(error);
    }
    return data as T;
  }

  listSchedules(): Promise<ScheduleJob[]> {
    return this.request<ScheduleJob[]>("/schedules");
  }

  createSchedule(body: CreateScheduleRequest): Promise<ScheduleJob> {
    return this.request<ScheduleJob>("/schedules", {
      method: "POST",
      body,
    });
  }

  updateSchedule(id: string, body: UpdateScheduleRequest): Promise<ScheduleJob> {
    return this.request<ScheduleJob>(`/schedules/${id}`, {
      method: "PATCH",
      body,
    });
  }

  deleteSchedule(id: string): Promise<{ ok: boolean }> {
    return this.request<{ ok: boolean }>(`/schedules/${id}`, {
      method: "DELETE",
    });
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}
