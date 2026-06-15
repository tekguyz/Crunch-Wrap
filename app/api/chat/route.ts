import { GoogleGenAI } from "@google/genai";
import { NextResponse } from "next/server";

export const runtime = 'edge';

export async function POST(req: Request) {
  try {
    const { messages, documentContext } = await req.json();

    if (!documentContext) {
      return NextResponse.json({ error: 'documentContext is required' }, { status: 400 });
    }

    // Detect Sandbox Bypass / Demo Mode cookie or field
    const cookieHeader = req.headers.get("cookie") || "";
    const isDemoMode = cookieHeader.includes("crunch_dev_bypass=true") || 
                       cookieHeader.includes("crispy_dev_bypass=true");

    if (isDemoMode) {
      console.log('API /api/chat called under Demo Mode. Running offline chat mock response.');
      await new Promise(resolve => setTimeout(resolve, 800));

      const lastUserMessage = messages && messages.length > 0 ? messages[messages.length - 1].text : "Hello";
      
      const responses = [
        `Thanks for asking! In Demo Mode, I am running offline to show how the document Q&A assistant functions. Your question was: "${lastUserMessage}". Live synthesis results look exactly like this!`,
        `That is an insightful question about this document! Since Demo Mode operates with zero API cost, I am simulating my answer. In the full production environment with an API Key, I analyze the entire context to formulate precise citations based directly on your query.`,
        `Perfect test query! The Chat Drawer fully supports persistent message history, auto-scrolling, and responsive layouts. Is there anything else about the UI you would like to explore?`
      ];
      const randomIndex = Math.floor(Math.random() * responses.length);
      const textResponse = responses[randomIndex];

      return NextResponse.json({ text: textResponse });
    }

    const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || process.env.API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'AI API Key is missing from environment variables.' }, { status: 401 });
    }

    const ai = new GoogleGenAI({ apiKey });

    const systemInstruction = "You are a highly intelligent document assistant. Use the following context to answer the user's questions accurately. If the answer is not in the context, say so. CONTEXT: \n\n" + documentContext;

    const chat = ai.chats.create({
      model: "gemini-3-flash-preview",
      config: {
        systemInstruction: systemInstruction,
      },
    });

    // The last message is the new user message
    const userMessage = messages[messages.length - 1].text;

    const response = await chat.sendMessage({ message: userMessage });

    return NextResponse.json({ text: response.text });
  } catch (error) {
    console.error("Chat API Error:", error);
    return NextResponse.json(
      { error: "Failed to process chat request.", details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
