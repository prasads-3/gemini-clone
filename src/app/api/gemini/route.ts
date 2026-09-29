import { auth } from "@/auth";
import { getGeminiClient, GEMINI_MODEL } from "@/lib/gemini";

export const runtime = "nodejs";

const ALLOWED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

type GeminiRequest = {
  prompt?: string;
  image?: {
    data?: string;
    mimeType?: string;
  };
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

    const body = (await request.json()) as GeminiRequest;

    const prompt = body.prompt?.trim();

    if (!prompt) {
      return Response.json(
        { error: "Prompt is required" },
        { status: 400 }
      );
    }

    const contents: Array<
      | { text: string }
      | {
          inlineData: {
            data: string;
            mimeType: string;
          };
        }
    > = [{ text: prompt }];

    if (body.image) {
      const { data, mimeType } = body.image;

      if (!data || !mimeType) {
        return Response.json(
          { error: "Invalid image payload" },
          { status: 400 }
        );
      }

      if (!ALLOWED_IMAGE_TYPES.has(mimeType)) {
        return Response.json(
          { error: "Unsupported image type" },
          { status: 400 }
        );
      }

      const estimatedBytes = Math.floor((data.length * 3) / 4);

      if (estimatedBytes > MAX_IMAGE_BYTES) {
        return Response.json(
          { error: "Image exceeds the 8 MB limit" },
          { status: 413 }
        );
      }

      contents.push({
        inlineData: {
          data,
          mimeType,
        },
      });
    }

    const ai = getGeminiClient();

    const result = await ai.models.generateContentStream({
      model: GEMINI_MODEL,
      contents,
    });

    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of result) {
            const text = chunk.text ?? "";

            if (text) {
              controller.enqueue(encoder.encode(text));
            }
          }

          controller.close();
        } catch (error) {
          console.error("Gemini streaming error:", error);
          controller.error(error);
        }
      },
    });

    return new Response(stream, {
      status: 200,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.error("Gemini API error:", error);

    return Response.json(
      { error: "Failed to generate Gemini response" },
      { status: 500 }
    );
  }
}
