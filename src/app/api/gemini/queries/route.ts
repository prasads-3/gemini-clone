import { auth } from "@/auth";
import { getGeminiClient, GEMINI_MODEL } from "@/lib/gemini";

export const runtime = "nodejs";

type QueryRequest = {
  prompt?: string;
};

export async function POST(request: Request) {
  try {
    const session = await auth();

    if (!session?.user) {
      return Response.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    const body = (await request.json()) as QueryRequest;
    const prompt = body.prompt?.trim();

    if (!prompt) {
      return Response.json(
        { error: "Prompt is required" },
        { status: 400 }
      );
    }

    const ai = getGeminiClient();

    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: "array",
          items: {
            type: "string",
          },
        },
      },
    });

    const text = response.text?.trim();

    if (!text) {
      throw new Error("Gemini returned an empty response");
    }

    let queries: unknown;

    try {
      queries = JSON.parse(text);
    } catch {
      throw new Error("Gemini returned invalid JSON");
    }

    if (
      !Array.isArray(queries) ||
      !queries.every((query) => typeof query === "string")
    ) {
      throw new Error("Gemini returned an invalid query list");
    }

    return Response.json(
      {
        queries,
      },
      {
        status: 200,
        headers: {
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        },
      }
    );
  } catch (error) {
    console.error("Gemini queries API error:", error);

    return Response.json(
      { error: "Failed to generate search queries" },
      { status: 500 }
    );
  }
}
