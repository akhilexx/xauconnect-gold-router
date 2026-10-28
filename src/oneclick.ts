// Minimal client for the NEAR Intents 1Click Swap API.
// Docs: https://docs.near-intents.org/integration/distribution-channels/1click-api/about-1click-api
// This client never signs or sends funds. Quotes are requested with dry=true unless
// the caller explicitly opts in, and even then only a deposit address is returned.

import type { QuoteRequest, QuoteResponse, Token } from "./types.ts";

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface OneClickOptions {
  baseUrl?: string;
  jwt?: string; // optional; without it 1Click adds an extra 0.25% fee
  fetch?: FetchLike;
  timeoutMs?: number;
}

export class OneClickError extends Error {
  status: number;
  body: unknown;
  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

export class OneClickClient {
  readonly baseUrl: string;
  private jwt?: string;
  private f: FetchLike;
  private timeoutMs: number;

  constructor(opts: OneClickOptions = {}) {
    this.baseUrl = (opts.baseUrl ?? "https://1click.chaindefuser.com").replace(/\/$/, "");
    this.jwt = opts.jwt || undefined;
    this.f = opts.fetch ?? ((u, i) => fetch(u, i));
    this.timeoutMs = opts.timeoutMs ?? 15000;
  }

  private async req<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.jwt) headers.Authorization = `Bearer ${this.jwt}`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      const res = await this.f(`${this.baseUrl}${path}`, { ...init, headers, signal: ctrl.signal });
      const text = await res.text();
      let body: unknown = text;
      try { body = JSON.parse(text); } catch { /* keep text */ }
      if (!res.ok) {
        const msg = (body as { message?: string })?.message ?? `HTTP ${res.status}`;
        throw new OneClickError(msg, res.status, body);
      }
      return body as T;
    } finally {
      clearTimeout(timer);
    }
  }

  tokens(): Promise<Token[]> {
    return this.req<Token[]>("/v0/tokens");
  }

  quote(body: QuoteRequest): Promise<QuoteResponse> {
    return this.req<QuoteResponse>("/v0/quote", { method: "POST", body: JSON.stringify(body) });
  }

  status(depositAddress: string, depositMemo?: string): Promise<unknown> {
    const q = new URLSearchParams({ depositAddress });
    if (depositMemo) q.set("depositMemo", depositMemo);
    return this.req(`/v0/status?${q}`);
  }
}
