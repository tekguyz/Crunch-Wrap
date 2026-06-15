import { GoogleGenAI, Type } from "@google/genai";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = 'edge';

export async function POST(req: Request) {
  const supabase = await createClient();
  let insightId: string | undefined;
  try {
    const body = await req.json();
    const data = body;
    insightId = data.insightId;
    const { audioUrl, textPayload, mimeType, isDeepAnalysisEnabled } = data;

    // Detect Sandbox Bypass / Demo Mode cookie or field
    const cookieHeader = req.headers.get("cookie") || "";
    const isDemoMode = cookieHeader.includes("crunch_dev_bypass=true") || 
                       cookieHeader.includes("crispy_dev_bypass=true") ||
                       data.isDemoMode;

    if (isDemoMode) {
      console.log('API /api/analyze called under Demo Mode. Running offline mock synthesis.');
      // Simulate synthesis delay for UX realism
      await new Promise(resolve => setTimeout(resolve, 1200));

      const title = data.title || (textPayload ? "Document Summary Notice" : "Audio Synthesis Report");
      const mockIntelligence = {
        title: title,
        summary: "This is a beautifully synthesized summary generated under Demo Mode. In this sandboxed environment, we generate custom, highly relevant diagnostic mock reports to help you review all interface sections, responsive charts, and user experience components with absolute security and no active API billing costs.",
        highlights: [
          "Demo Mode active: verified high-fidelity interface performance with zero-API operations.",
          "Local storage framework (IndexedDB) is housing this analysis document on your device.",
          "Ask Document Assistant chat is online to respond with offline interactive heuristics."
        ],
        action_items: [
          "Open the 'Ask Assistant' side drawer to practice interactive query-response controls.",
          "Verify player interactions if you imported or recorded voice notes in this session."
        ],
        topics: ["Demo Mode", "Performance Analytics", "UI/UX Fidelity", "Cost Control"],
        sentiment: "POSITIVE",
        reading_time: "1 min",
        metadata: { model: "Local Offline Emulator", duration: "1.2s" }
      };

      return NextResponse.json({
        success: true,
        intelligence: mockIntelligence,
        dbInsight: {
          id: insightId || "demo-insight-id-placeholder",
          title: title,
          processing_status: 'completed',
          audio_url: audioUrl || null,
          summary: mockIntelligence.summary,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }
      });
    }

    // Validate required fields
    if (!insightId || (!audioUrl && !textPayload)) {
      return NextResponse.json({ success: false, error: "Missing required fields in payload." }, { status: 400 });
    }
    
    let base64Audio: string | undefined;
    let textContent: string | undefined;

    if (textPayload) {
      textContent = textPayload;
      console.log('Using textPayload, skipping Supabase download');
    } else {
      // 1. Fetch the File Data
      const { data: fileBlob, error: downloadError } = await supabase.storage
        .from('meetings')
        .download(audioUrl);

      if (downloadError) {
        throw new Error(`Failed to download audio file: ${downloadError.message}`);
      }

      // 2. Convert to Base64
      const arrayBuffer = await (fileBlob as any).arrayBuffer();
      base64Audio = Buffer.from(arrayBuffer).toString('base64');
      console.log('File downloaded, size:', base64Audio.length, 'Mime:', mimeType);
    }

    // 3. Determine mimeType
    let yourMimeType = mimeType;
    if (!yourMimeType) {
      if (audioUrl?.endsWith('.mp3')) yourMimeType = 'audio/mp3';
      else if (audioUrl?.endsWith('.md')) yourMimeType = 'text/markdown';
      else yourMimeType = 'audio/webm';
    }
    console.log('Using MimeType:', yourMimeType);

    // Initialize SDK inside handler
    const apiKey = process.env.API_KEY;
    if (!apiKey) { throw new Error("API_KEY is missing from environment variables"); }
    const ai = new GoogleGenAI({ apiKey });
    
    // Determine if audio is > 15 minutes (approx 15MB for compressed audio)
    const isLongAudio = base64Audio && base64Audio.length > 15 * 1024 * 1024 * 1.33; // 15MB * base64 overhead
    const useProModel = isDeepAnalysisEnabled || isLongAudio;
    const appliedModel = useProModel ? "gemini-3.1-pro-preview" : "gemini-3.1-flash-lite-preview";
    console.log('Calling AI model:', appliedModel, 'isDeepAnalysisEnabled:', isDeepAnalysisEnabled, 'isLongAudio:', !!isLongAudio);

    const startTime = Date.now();
    const prompt = textContent 
      ? `Analyze this text and provide a structured summary, highlights, action items, topics, and sentiment: ${textContent}`
      : "Analyze this content and provide a structured summary, highlights, action items, topics, and sentiment.";
    
    const parts: any[] = [{ text: prompt }];
    if (base64Audio) {
      parts.push({ inlineData: { data: base64Audio, mimeType: yourMimeType } });
    }

    const response = await ai.models.generateContent({
      model: appliedModel,
      contents: { parts },
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING, description: "A short, descriptive, contextual title, max 6 words" },
            summary: { type: Type.STRING },
            highlights: { type: Type.ARRAY, items: { type: Type.STRING } },
            action_items: { type: Type.ARRAY, items: { type: Type.STRING } },
            topics: { type: Type.ARRAY, items: { type: Type.STRING } },
            sentiment: { type: Type.STRING },
            reading_time: { type: Type.STRING },
          },
          required: ["title", "summary", "highlights", "action_items", "topics", "sentiment", "reading_time"],
        },
        systemInstruction: "Analyze content. Provide dense, high-signal analysis."
      }
    });
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    
    console.log('AI Response received:', response.text);
    const aiParsedData = JSON.parse(response.text!);
    const finalIntelligence = { ...aiParsedData, metadata: { model: appliedModel, duration: duration + 's' } };

    // Non-blocking Database Update
    supabase
      .from('insights')
      .update({
        processing_status: 'completed',
        title: finalIntelligence.title,
        summary: finalIntelligence.summary,
        highlights: finalIntelligence.highlights,
        action_items: finalIntelligence.action_items,
        topics: finalIntelligence.topics,
        sentiment: finalIntelligence.sentiment,
        intelligence: finalIntelligence,
        updated_at: new Date().toISOString(),
      })
      .eq('id', insightId)
      .then(({ error }) => {
        if (error) console.error('Database update error:', error);
      });

    return NextResponse.json({ success: true, intelligence: finalIntelligence });
  } catch (error: any) {
    console.error("CRITICAL API FAILURE:", error.message, error.stack);
    
    // Attempt to log the error to the database
    if (insightId) {
      supabase
        .from('insights')
        .update({ 
          processing_status: 'failed', 
          summary: 'CRASH REPORT: ' + (error.message || String(error)) 
        })
        .eq('id', insightId)
        .then(({ error }) => {
          if (error) console.error('Database update error:', error);
        });
    }

    return NextResponse.json({ error: error.message || "Unknown Server Error" }, { status: 500 });
  }
}
