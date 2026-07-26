import type { VercelRequest, VercelResponse } from "@vercel/node";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { messages, systemInstruction } = req.body;

    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: "Missing or invalid messages array" });
    }

    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      console.error("GROQ_API_KEY environment variable is not set");
      return res.status(500).json({ error: "Server configuration error: missing API key" });
    }

    const defaultSystem = "You are a very friendly, helpful, and concise AI Assistant named MAHI, developed by and under the MAHIX company. You converse in a normal, highly friendly, and warm manner. Your answers MUST be short, sweet, and to the point. Always write responses in the same language as the user's message (Bengali, English, or any other language) and maintain a modern, friendly vibe.";
    const baseSystem = systemInstruction || defaultSystem;

    // Ask the model to also classify the emotional tone of its own reply, so the Live2D
    // character on the frontend can play a matching animation + voice line + speech
    // bubble instead of always using one generic "talking" gesture. Kept as a strict JSON
    // contract (enforced below with response_format) rather than a separate request, so
    // there's no added latency. The emotion list mirrors LLM_EMOTION_KEYS in
    // src/config/micaReactions.ts — add a new key to both places to extend it.
    const emotionInstruction =
      "\n\nAfter composing your reply, decide which single emotion best matches its tone: " +
      '"happy" (cheerful, pleased, celebratory), "thinking" (working through something, uncertain), ' +
      '"surprise" (something unexpected/notable), "sad" (apologetic, disappointing news, empathizing with something sad), ' +
      '"confused" (an error occurred, or the request truly doesn\'t make sense), or "neutral" (a plain, matter-of-fact answer). ' +
      "Respond with ONLY a single JSON object, no other text, in exactly this shape: " +
      '{"reply": "your full reply text here", "emotion": "one of the keys above"}. ' +
      "The \"reply\" field must contain your complete, natural-language answer (same language as the user) — never split, truncate, or summarize it to keep the JSON short.";
    const systemContent = baseSystem + emotionInstruction;

    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: [
          {
            role: "system",
            content: systemContent
          },
          ...messages
        ],
        temperature: 0.7,
        max_tokens: 1024,
        response_format: { type: "json_object" }
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("Groq API returned error status:", response.status, errText);
      return res.status(response.status).json({ error: `Groq API Error: ${errText}` });
    }

    const data = await response.json();
    return res.status(200).json(data);
  } catch (err: any) {
    console.error("Groq Chat endpoint failed:", err);
    return res.status(500).json({ error: err.message || "Internal Server Error" });
  }
}
