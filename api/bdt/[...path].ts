// Consolidated BDT gateway — ONE Vercel Serverless Function for every
// /api/bdt/* route (Send Money + Deal Room funding). Public URLs are unchanged:
//
//   POST /api/bdt/recipient-check                 -> handleBdtRecipientCheck
//   POST /api/bdt/transfers                       -> handleBdtCreateTransfer
//   GET  /api/bdt/transfers/:id                   -> handleBdtGetTransfer
//   POST /api/bdt/deal-funding                    -> handleDealFundingCreate
//   GET  /api/bdt/deal-funding/:id                -> handleDealFundingStatus
//   POST /api/bdt/deal-funding/:id/settlement     -> handleDealFundingSettlement
//   POST /api/bdt/deal-funding/:id/refund         -> handleDealFundingRefund
//
// Routing follows Vercel's file-based convention: a `[...path]` file in the
// /api directory becomes a catch-all function served at its folder path. Each
// segment of the requested URL is delivered via `req.query.path`.

import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  handleBdtRecipientCheck,
  handleBdtCreateTransfer,
  handleBdtGetTransfer,
} from "../_lib/bdtPayoutService.js";
import {
  handleDealFundingCreate,
  handleDealFundingStatus,
  handleDealFundingSettlement,
  handleDealFundingRefund,
} from "../_lib/bdtDealPaymentService.js";

interface RouteSpec {
  label: string;
  methods: string[];
  run: (
    req: VercelRequest,
    id: string | undefined
  ) => Promise<{ httpStatus: number; body: Record<string, unknown> }>;
}

const ROUTES: Record<string, RouteSpec> = {
  "recipient-check": {
    label: "[POST /api/bdt/recipient-check]",
    methods: ["POST"],
    run: (req) => handleBdtRecipientCheck(req.headers.authorization, (req.body ?? {}) as Record<string, unknown>),
  },
  "transfers:create": {
    label: "[POST /api/bdt/transfers]",
    methods: ["POST"],
    run: (req) => handleBdtCreateTransfer(req.headers.authorization, (req.body ?? {}) as Record<string, unknown>),
  },
  "transfers:get": {
    label: "[GET /api/bdt/transfers/:id]",
    methods: ["GET"],
    run: (req, id) => handleBdtGetTransfer(req.headers.authorization, id),
  },
  "deal-funding:create": {
    label: "[POST /api/bdt/deal-funding]",
    methods: ["POST"],
    run: (req) => handleDealFundingCreate(req.headers.authorization, (req.body ?? {}) as Record<string, unknown>),
  },
  "deal-funding:get": {
    label: "[GET /api/bdt/deal-funding/:id]",
    methods: ["GET"],
    run: (req, id) => handleDealFundingStatus(req.headers.authorization, id),
  },
  "deal-funding:settlement": {
    label: "[POST /api/bdt/deal-funding/:id/settlement]",
    methods: ["POST"],
    run: (req, id) => handleDealFundingSettlement(req.headers.authorization, id),
  },
  "deal-funding:refund": {
    label: "[POST /api/bdt/deal-funding/:id/refund]",
    methods: ["POST"],
    run: (req, id) => handleDealFundingRefund(req.headers.authorization, id),
  },
};

function resolveRoute(segments: string[]): { key: string; id: string | undefined } {
  if (segments.length === 1) {
    if (segments[0] === "recipient-check") return { key: "recipient-check", id: undefined };
    if (segments[0] === "transfers") return { key: "transfers:create", id: undefined };
    if (segments[0] === "deal-funding") return { key: "deal-funding:create", id: undefined };
  }
  if (segments.length === 2) {
    if (segments[0] === "transfers") return { key: "transfers:get", id: segments[1] };
    if (segments[0] === "deal-funding") return { key: "deal-funding:get", id: segments[1] };
  }
  if (segments.length === 3 && segments[0] === "deal-funding") {
    if (segments[2] === "settlement") return { key: "deal-funding:settlement", id: segments[1] };
    if (segments[2] === "refund") return { key: "deal-funding:refund", id: segments[1] };
  }
  return { key: "", id: undefined };
}

function readPathSegments(req: VercelRequest): string[] {
  const raw = req.query.path;
  const segments = Array.isArray(raw)
    ? raw
    : typeof raw === "string" && raw.length > 0
      ? [raw]
      : [];
  if (segments.length > 0) return segments;
  const urlPath = (req.url ?? "").split("?")[0];
  const prefix = "/api/bdt/";
  return urlPath.startsWith(prefix)
    ? urlPath.slice(prefix.length).split("/").filter(Boolean)
    : [];
}

function jsonResponse(
  res: VercelResponse,
  status: number,
  body: Record<string, unknown>
): void {
  try {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store, max-age=0");
    res.status(status);
    res.end(JSON.stringify(body));
  } catch {
    try {
      if (!res.writableEnded) {
        res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
        res.end('{"ok":false,"error":"response write failed","code":"SERVER_ERROR"}');
      }
    } catch {
      // Nothing more we can do.
    }
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const segments = readPathSegments(req);
    const resolved = resolveRoute(segments);
    const route: RouteSpec | undefined = resolved.key ? ROUTES[resolved.key] : undefined;

    if (!route) {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
      jsonResponse(res, 404, { ok: false, error: "Not found", code: "NOT_FOUND" });
      return;
    }

    const allowedMethods = [...route.methods, "OPTIONS"];
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", allowedMethods.join(","));
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

    if (req.method === "OPTIONS") {
      res.setHeader("Content-Type", "text/plain");
      res.status(200).end();
      return;
    }
    if (!route.methods.includes(req.method ?? "")) {
      jsonResponse(res, 405, { ok: false, error: "Method not allowed", code: "METHOD_NOT_ALLOWED" });
      return;
    }

    const result = await route.run(req, resolved.id);
    jsonResponse(res, result.httpStatus, result.body);
  } catch (err: unknown) {
    console.error(
      "[api/bdt] OUTER ERROR:",
      err instanceof Error ? err.message.slice(0, 200) : String(err)
    );
    jsonResponse(res, 500, { ok: false, error: "Internal bdt error.", code: "SERVER_ERROR" });
  }
}