import type {
  HcPlayerStatus,
  HoopCentralBioPayload,
  HoopCentralBioResponse,
} from "./types.js";

export class IngestClientError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly body?: unknown,
  ) {
    super(message);
    this.name = "IngestClientError";
  }
}

function formatIngestError(body: unknown, text: string, statusText: string): string {
  if (body && typeof body === "object" && "error" in body) {
    const err = (body as { error: unknown }).error;
    if (typeof err === "string") return err;
    if (err && typeof err === "object") {
      const obj = err as { message?: unknown; code?: unknown };
      if (typeof obj.message === "string") {
        return typeof obj.code === "string" ? `${obj.code}: ${obj.message}` : obj.message;
      }
      return JSON.stringify(err);
    }
  }
  return text || statusText;
}

export class IngestClient {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string | null,
  ) {}

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: "application/json",
      ...extra,
    };
    if (this.apiKey) headers["x-ingest-api-key"] = this.apiKey;
    return headers;
  }

  async getCompletionStatus(source = "balldontlie"): Promise<{
    source: string;
    players: HcPlayerStatus[];
  }> {
    const url = `${this.baseUrl}/api/ingest/completion-status?source=${encodeURIComponent(source)}`;
    const response = await fetch(url, { headers: this.headers() });
    const text = await response.text();

    let body: unknown = null;
    if (text) {
      try {
        body = JSON.parse(text) as unknown;
      } catch {
        throw new IngestClientError(
          `Invalid JSON from Hoop Central (${response.status})`,
          response.status,
          text,
        );
      }
    }

    if (!response.ok) {
      throw new IngestClientError(
        `Completion status failed (${response.status}): ${formatIngestError(body, text, response.statusText)}`,
        response.status,
        body,
      );
    }

    return body as { source: string; players: HcPlayerStatus[] };
  }

  async sendPlayerBio(payload: HoopCentralBioPayload): Promise<HoopCentralBioResponse> {
    const url = `${this.baseUrl}/api/ingest/player-bio`;
    const maxAttempts = 5;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      let response: Response;
      try {
        response = await fetch(url, {
          method: "POST",
          headers: this.headers({ "Content-Type": "application/json" }),
          body: JSON.stringify(payload),
        });
      } catch (error) {
        if (attempt < maxAttempts) {
          await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
          continue;
        }
        const message = error instanceof Error ? error.message : String(error);
        throw new IngestClientError(`Network error posting bio payload: ${message}`);
      }

      const text = await response.text();
      let body: unknown = null;
      if (text) {
        try {
          body = JSON.parse(text) as unknown;
        } catch {
          throw new IngestClientError(
            `Invalid JSON from Hoop Central (${response.status})`,
            response.status,
            text,
          );
        }
      }

      if (!response.ok) {
        if ([429, 500, 502, 503, 504].includes(response.status) && attempt < maxAttempts) {
          await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
          continue;
        }
        throw new IngestClientError(
          `Bio ingest failed (${response.status}): ${formatIngestError(body, text, response.statusText)}`,
          response.status,
          body,
        );
      }

      return body as HoopCentralBioResponse;
    }

    throw new IngestClientError("Bio ingest failed after retries");
  }
}
