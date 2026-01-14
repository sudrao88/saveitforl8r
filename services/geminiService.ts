
import { GoogleGenAI, Type, HarmCategory, HarmBlockThreshold } from "@google/genai";
import { EnrichmentData, Memory, Attachment } from '../types.ts';

const getAiClient = () => {
  // STRICT REQUIREMENT: Only use user-provided API key from storage.
  // Do NOT fallback to process.env.API_KEY
  const apiKey = localStorage.getItem('gemini_api_key');
  if (!apiKey) throw new Error("API Key not found in storage");
  return new GoogleGenAI({ apiKey });
};

// Define schema using the SDK's types strictly
const enrichmentSchema = {
  type: Type.OBJECT,
  properties: {
    summary: { type: Type.STRING, description: "A concise summary of the input." },
    visualDescription: { type: Type.STRING, description: "Description of the attached images or documents content, if provided." },
    locationIsRelevant: { type: Type.BOOLEAN, description: "Whether the input refers to a specific place or relevant location." },
    locationContext: {
      type: Type.OBJECT,
      properties: {
        name: { type: Type.STRING, description: "The specific name of the place (e.g. 'Starbucks', 'Eiffel Tower', 'Central Park')." },
        address: { type: Type.STRING },
        website: { type: Type.STRING },
        operatingHours: { type: Type.STRING },
        latitude: { type: Type.NUMBER },
        longitude: { type: Type.NUMBER },
        mapsUri: { type: Type.STRING, description: "Direct Google Maps URL for the specific place found." }
      },
      required: ["name"]
    },
    entityContext: {
      type: Type.OBJECT,
      description: "Details if the input is a Movie, Book, TV Show, Product, etc.",
      properties: {
        type: { type: Type.STRING, description: "e.g. 'Movie', 'Book', 'TV Show', 'Product', 'Place'" },
        title: { type: Type.STRING },
        subtitle: { type: Type.STRING, description: "Author for books, Director/Year for movies." },
        description: { type: Type.STRING, description: "A brief synopsis, plot summary, or product description." },
        rating: { type: Type.STRING, description: "Critic or user rating if available (e.g. '4.5/5', 'IMDb 8.2')." }
      }
    },
    suggestedTags: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: "3-5 suggested short tags."
    }
  },
  required: ["summary", "suggestedTags", "locationIsRelevant"]
};

export const enrichInput = async (
  text: string,
  attachments: Attachment[],
  location?: { latitude: number; longitude: number },
  tags: string[] = []
): Promise<EnrichmentData> => {
  const parts: any[] = [];
  
  // Add attachments (images, PDFs, text files)
  for (const att of attachments) {
    // Extract base64 part from Data URI (data:mime;base64,.....)
    const base64Data = att.data.split(',')[1];
    if (base64Data) {
        parts.push({ 
            inlineData: { 
                data: base64Data, 
                mimeType: att.mimeType 
            } 
        });
    }
  }

  let prompt = `Analyze this Second Brain entry.
  
  TASK: Enrich the content using the INPUT TEXT, USER TAGS, and attached DOCUMENTS/IMAGES.
  
  SEARCH STRATEGY:
  1. Combine the INPUT TEXT and USER TAGS to form your search queries. The tags provide essential context (e.g., "Movie", "Book", "Restaurant") that disambiguates the text.
  2. If the INPUT TEXT is short or ambiguous, rely on the TAGS to determine the entity type.`;

  if (tags.length > 0) {
    prompt += `\nUSER TAGS: ${tags.join(', ')}`;
  }

  if (location) {
    prompt += `
    USER CURRENT GPS: Lat ${location.latitude}, Lng ${location.longitude}.
    
    LOCATION & SEARCH RULES:
    1. INPUT IS KEY: The INPUT TEXT is the primary search term.
    2. USE GPS CONTEXT: When searching, explicitly include the GPS coordinates in your search query to prioritize results near the user. 
       - Query format: "${text} near ${location.latitude}, ${location.longitude}"
    3. PLACE IDENTIFICATION: 
       - If the search result confirms the INPUT TEXT is a specific place/business at this location, set 'locationIsRelevant' to TRUE.
       - You MUST populate 'locationContext.mapsUri' with the specific Google Maps link found in the search result.
       - Populate 'locationContext.name' and 'locationContext.address'.
    4. NO GENERIC REVERSE GEOCODING:
       - Do NOT return the address of the coordinates if the INPUT TEXT does not match the place.
       - If the user types "Idea", do not return "Starbucks" just because they are there.
       - If 'locationIsRelevant' is false, leave 'locationContext' empty.
    `;
  } 
  
  prompt += `
    RULES FOR LINKS:
    1. DO NOT generate generic external links (e.g. no IMDB, no Amazon, no Official Website links).
    2. LOCATION/BUSINESS: 'locationContext.mapsUri' MUST be the Google Maps link found in the search result.

    ENTITY SPECIFIC INSTRUCTIONS:
    1. MOVIE/TV: Identify Title, Director/Year, and Description.
    2. BOOK: Identify Title, Author, and Description.
    3. LOCATION/BUSINESS: Populate locationContext fully, especially mapsUri.
  `;

  if (text) prompt += `\nINPUT TEXT: "${text}"`;
  
  parts.push({ text: prompt });

  const config: any = {
      tools: [{ googleSearch: {} }],
      safetySettings: [
        { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
        { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
        { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
        { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
      ],
      responseMimeType: 'application/json',
      responseSchema: enrichmentSchema,
  };

  try {
    const ai = getAiClient();
    const response = await ai.models.generateContent({
      model: 'gemini-2.0-flash', 
      contents: { parts },
      config: config
    });
    
    const jsonString = response.text || "{}";
    const parsedData = JSON.parse(jsonString) as EnrichmentData;
    
    // Inject Audit Trail
    parsedData.audit = {
        prompt: prompt,
        rawResponse: jsonString
    };
    
    return parsedData;
  } catch (error: any) {
    console.error("Enrichment Error:", error);
    throw error;
  }
};

export const queryBrain = async (query: string, memories: Memory[]): Promise<{ answer: string; sourceIds: string[] }> => {
  const ai = getAiClient();
  const contextBlock = memories.filter(m => !m.isPending && !m.processingError).map(m => `
    [ID: ${m.id}] [DATE: ${new Date(m.timestamp).toLocaleDateString()}]
    [CONTENT]: ${m.content} [SUMMARY]: ${m.enrichment?.summary}
    [PLACE]: ${m.enrichment?.locationContext?.name || "N/A"}
    [ENTITY]: ${m.enrichment?.entityContext?.title || "N/A"} (${m.enrichment?.entityContext?.type || ""})
    [ATTACHMENTS]: ${(m.attachments || []).map(a => a.name).join(', ')}
  `).join("\n---\n");

  const systemInstruction = `
    You are SaveItForL8r. Answer based ONLY on context. 
    Format: Conversational. 
    End with: [[SOURCE_IDS: id1, id2]].
  `;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.0-flash',
      contents: `CONTEXT:\n${contextBlock}\nQUERY: "${query}"`,
      config: { 
          systemInstruction, 
          temperature: 0.2,
          safetySettings: [
            { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
            { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
            { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
            { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
          ]
      }
    });
    const text = response.text || "";
    const match = text.match(/\[\[SOURCE_IDS: (.+?)\]\]/);
    let sourceIds: string[] = [];
    if (match) sourceIds = match[1].split(',').map(s => s.trim());
    return { answer: text.replace(/\[\[SOURCE_IDS: .+?\]\]/, '').trim(), sourceIds };
  } catch (error) {
    return { answer: "Unable to retrieve memory.", sourceIds: [] };
  }
};
