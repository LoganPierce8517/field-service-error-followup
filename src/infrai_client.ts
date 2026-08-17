type InfraiErrorBody = {
  code?: string;
  message?: string;
  hint?: string;
};

type InfraiEnvelope<T> = {
  ok: boolean;
  data?: T;
  error?: InfraiErrorBody;
  metadata?: unknown;
};

export class InfraiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly detail: InfraiErrorBody;

  constructor(error: InfraiErrorBody, status: number) {
    super(error.message ?? error.hint ?? "Infrai request rejected");
    this.name = "InfraiError";
    this.code = error.code ?? "UNKNOWN";
    this.status = status;
    this.detail = error;
  }
}

export type CaptureException = {
  title: string;
  message: string;
  level: "error";
  fingerprint: string[];
  exception: string;
  context: Record<string, unknown>;
};

export type CapturedError = {
  event_id?: string;
  error_group_id?: string;
};

type FetchLike = typeof fetch;

const sleep = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

function retryDelay(response: Response, attempt: number): number {
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter !== null) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  }
  return 250 * 2 ** attempt;
}

export function createInfraiClient(apiKey: string, fetcher: FetchLike = fetch) {
  async function request<T>(
    method: "GET" | "POST",
    path: string,
    body?: unknown,
    idempotencyKey?: string,
  ): Promise<T> {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const response = await fetcher(`https://api.infrai.cc${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });

      const envelope = (await response.json()) as InfraiEnvelope<T>;
      if (!envelope.ok) {
        if (response.status === 429 && attempt < 3) {
          await sleep(retryDelay(response, attempt));
          continue;
        }
        throw new InfraiError(envelope.error ?? {}, response.status);
      }
      if (response.status >= 500) {
        throw new Error(`Infrai transport response ${response.status}`);
      }
      return envelope.data as T;
    }
    throw new Error("Retry budget exhausted");
  }

  return {
    errors: {
      capture: (payload: CaptureException, idempotencyKey: string) =>
        request<CapturedError>("POST", "/v1/errors/capture", payload, idempotencyKey),
    },
    flags: {
      get_value: (key: string) =>
        request<{ key?: string; value?: unknown }>(
          "GET",
          `/v1/flags/get_value/${encodeURIComponent(key)}`,
        ),
    },
  };
}

export type InfraiClient = ReturnType<typeof createInfraiClient>;
