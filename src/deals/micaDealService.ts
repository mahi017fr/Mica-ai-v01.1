import { AiRecommendation, DealRole, DealTerms } from "./types";
import { nowIso } from "./dealFirestore";

// Mica AI deal advisory layer. All calls proxy to the existing `/api/bot/chat`
// Groq endpoint used by the rest of the app. The AI is STRICTLY ADVISORY: it
// only produces text + a structured recommendation. It never signs, never
// moves funds, and never touches the escrow contract.

async function callMica(systemInstruction: string, userContent: string): Promise<string> {
  const res = await fetch("/api/bot/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages: [{ role: "user", content: userContent }],
      systemInstruction,
    }),
  });
  if (!res.ok) {
    throw new Error(`Mica AI unavailable (${res.status})`);
  }
  const data = await res.json();
  const content: string = data.choices?.[0]?.message?.content ?? "";
  if (!content) throw new Error("Mica AI returned an empty reply.");
  return content;
}

/**
 * Extract a JSON object from an LLM reply. Tolerates markdown fences and the
 * `{ "reply": "<json string>" }` wrapper used by the deployed bot endpoint.
 */
export function extractJson<T = any>(text: string): T | null {
  const cleaned = text.replace(/```json/gi, "```").replace(/```/g, "").trim();
  const candidates: string[] = [cleaned];
  try {
    const first = cleaned.indexOf("{");
    const last = cleaned.lastIndexOf("}");
    if (first >= 0 && last > first) candidates.push(cleaned.slice(first, last + 1));
  } catch {
    /* ignore */
  }
  for (const c of candidates) {
    try {
      const parsed = JSON.parse(c);
      if (parsed && typeof parsed === "object") {
        if (typeof parsed.reply === "string" && /{/.test(parsed.reply)) {
          try {
            const nested = JSON.parse(parsed.reply);
            if (nested && typeof nested === "object") return nested as T;
          } catch {
            /* fall through */
          }
        }
        return parsed as T;
      }
    } catch {
      /* try next candidate */
    }
  }
  return null;
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const strArr = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, 8) : [];

export interface AnalyzeInput {
  terms: DealTerms;
  buyerName: string;
  sellerName: string;
  amountLabel: string;
}

export async function analyzeDeal(input: AnalyzeInput): Promise<AiRecommendation> {
  const userContent = [
    `Deal type: ${input.terms.dealType}`,
    `Description: ${input.terms.description}`,
    `Amount: ${input.amountLabel} USDC`,
    `Collateral: ${input.terms.collateralPercent}% of deal amount (mutual, posted by both buyer and seller)`,
    `Buyer: ${input.buyerName}`,
    `Seller: ${input.sellerName}`,
  ].join("\n");

  const systemInstruction = [
    "You are Mica, the MICA deal-escrow advisor inside a peer-to-peer marketplace.",
    "Your job is to recommend the safest, simplest escrow protection structure for a two-party deal that will be enforced by a timelock smart contract holding USDC.",
    "Respond with ONLY a single JSON object, no markdown, no commentary, with EXACTLY this shape:",
    '{"recommendation": "one-sentence recommended structure", "mechanism": "short name of the mechanism", "protection": ["concrete protections (max 4)"], "milestones": ["delivery milestones (max 4)"], "risks": ["honest risks (max 4)"], "collateralNote": "one sentence about the mutual collateral"}',
    "Keep every string short and concrete. Never mention wallet private keys or suggest bypassing escrow.",
  ].join(" ");

  try {
    const raw = await callMica(systemInstruction, userContent);
    const parsed = extractJson<Partial<AiRecommendation>>(raw);
    if (!parsed) throw new Error("non-json reply");
    const rec: AiRecommendation = {
      version: 1,
      generatedAt: nowIso(),
      source: "mica",
      recommendation: str(parsed.recommendation) || fallbackAnalysis(input).recommendation,
      mechanism: str(parsed.mechanism) || fallbackAnalysis(input).mechanism,
      protection: strArr(parsed.protection).length
        ? strArr(parsed.protection)
        : fallbackAnalysis(input).protection,
      milestones: strArr(parsed.milestones).length
        ? strArr(parsed.milestones)
        : fallbackAnalysis(input).milestones,
      risks: strArr(parsed.risks).length ? strArr(parsed.risks) : fallbackAnalysis(input).risks,
      collateralNote: str(parsed.collateralNote) || fallbackAnalysis(input).collateralNote,
    };
    return rec;
  } catch (err) {
    console.warn("[MicaDeal] analysis failed, using local fallback:", err);
    return fallbackAnalysis(input);
  }
}

function fallbackAnalysis(input: AnalyzeInput): AiRecommendation {
  const pct = input.terms.collateralPercent;
  return {
    version: 1,
    generatedAt: nowIso(),
    source: "local_fallback",
    recommendation:
      "Timelock escrow: both parties deposit into the deal escrow, delivery is confirmed by the buyer within 24h, funds release on approval or auto-release after the window.",
    mechanism: "Timelock escrow with 24h buyer review",
    protection: [
      `Buyer deposits ${input.amountLabel} USDC — never sent directly to the seller.`,
      `Seller posts ${pct}% mutual collateral, returned on successful delivery.`,
      "24h buyer review window after delivery.",
      "Dispute pauses the clock; no one can move funds unilaterally.",
    ],
    milestones: ["Agreement + dual consent", "Escrow funded", "Delivery", "24h buyer review", "Settlement"],
    risks: [
      "Buyer never reviews within 24h → auto-release to seller.",
      "Seller fails to deliver → buyer must dispute before the window ends.",
      "Unresolved disputes require manual off-chain resolution.",
    ],
    collateralNote: `Both buyer and seller post ${pct}% of the deal value as mutual good-faith collateral.`,
  };
}

export interface DraftInput {
  terms: DealTerms;
  ai?: AiRecommendation;
  buyerName: string;
  sellerName: string;
  amountLabel: string;
}

export interface DraftAgreement {
  title: string;
  clauses: string[];
}

export async function draftAgreement(input: DraftInput): Promise<DraftAgreement> {
  const systemInstruction = [
    "You are Mica drafting the final deal agreement for a two-party marketplace deal secured by USDC escrow.",
    "Write a fair, human-readable agreement in plain English.",
    "Respond with ONLY a single JSON object, no markdown, exactly this shape:",
    '{"title": "short deal title", "clauses": ["clause 1", "clause 2", ...]}',
    "Include: what is being delivered, the exact price, mutual collateral terms, the 24h review window, auto-release if the buyer does nothing, and dispute handling.",
    "Max 8 clauses, each 1-2 sentences. Never mention private keys or suggest bypassing escrow.",
  ].join(" ");

  const userContent = [
    `Title draft: ${input.terms.dealType}`,
    `Description: ${input.terms.description}`,
    `Price: ${input.amountLabel} USDC`,
    `Collateral: ${input.terms.collateralPercent}% of deal amount`,
    `Buyer: ${input.buyerName}`,
    `Seller: ${input.sellerName}`,
  ].join("\n");

  const fallback: DraftAgreement = {
    title: input.terms.dealType || "Marketplace Deal",
    clauses: [
      `Buyer ${input.buyerName} agrees to pay ${input.amountLabel} USDC into the deal escrow.`,
      `Seller ${input.sellerName} agrees to deliver: ${input.terms.description}.`,
      `Seller posts ${input.terms.collateralPercent}% of the deal amount as mutual collateral into the escrow.`,
      "After delivery, the buyer has a 24-hour review window to approve or dispute.",
      "If the buyer approves, the seller receives the price plus their collateral back.",
      "If the buyer takes no action within 24h, the deal auto-releases to the seller.",
      "A dispute pauses the clock and blocks any release until resolved.",
      "Both parties acknowledge these terms are enforced by the on-chain escrow contract.",
    ],
  };

  try {
    const raw = await callMica(systemInstruction, userContent);
    const parsed = extractJson<{ title?: string; clauses?: unknown }>(raw);
    if (!parsed) return fallback;
    const clauses = strArr(parsed.clauses);
    if (!clauses.length) return fallback;
    return {
      title: str(parsed.title) || fallback.title,
      clauses,
    };
  } catch (err) {
    console.warn("[MicaDeal] draft failed, using local fallback:", err);
    return fallback;
  }
}

export interface AskContext {
  terms?: DealTerms;
  role: DealRole;
  state: string;
  amountLabel?: string;
}

export async function askMicaAboutDeal(question: string, ctx: AskContext): Promise<string> {
  const systemInstruction = [
    "You are Mica, a friendly, concise AI deal advisor inside a USDC-escrowed marketplace room.",
    "Answer the user's question about their deal in 2-4 short sentences. Be warm and practical.",
    "You are advisory only: you never move funds and never bypass the escrow.",
  ].join(" ");
  const userContent = [
    `Question: ${question}`,
    `My role: ${ctx.role}`,
    `Deal state: ${ctx.state}`,
    ctx.terms ? `Deal: ${ctx.terms.dealType} — ${ctx.terms.description}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  try {
    return await callMica(systemInstruction, userContent);
  } catch (err) {
    console.warn("[MicaDeal] Q&A failed:", err);
    return "I'm having trouble reaching my brain right now — but here's the safe answer: never release funds outside the escrow, and dispute before the 24h window ends if delivery isn't complete.";
  }
}

export async function askDisputeAdvice(question: string, ctx: AskContext): Promise<string> {
  const systemInstruction = [
    "You are Mica assisting inside an ACTIVE deal dispute. You are advisory ONLY — you cannot resolve the dispute or move funds.",
    "Advise on options: the buyer may release, either party may request manual off-chain resolution, and the 24h auto-release clock is PAUSED during a dispute.",
    "Answer in 2-4 short, calm sentences. Never give legal guarantees.",
  ].join(" ");
  const userContent = `Dispute question: ${question}\nMy role: ${ctx.role}\nDeal state: ${ctx.state}`;

  try {
    return await callMica(systemInstruction, userContent);
  } catch (err) {
    console.warn("[MicaDeal] dispute advice failed:", err);
    return "During a dispute the auto-release clock is paused and funds are frozen. Recommend documenting the issue and agreeing on a resolution; neither party can unilaterally move the escrow.";
  }
}

export const DEAL_TYPE_SUGGESTIONS = [
  "Freelance Service",
  "Digital Goods",
  "NFT / Digital Asset",
  "Deposit / Prepayment",
  "Custom Project",
];
