const OpenAI = require("openai");

// jsonrepair is used only as a fallback when the model returns
// slightly malformed JSON.
let jsonrepair = null;

try {
  const repairModule = require("jsonrepair");

  jsonrepair =
    repairModule.jsonrepair ||
    repairModule.default ||
    repairModule;
} catch (error) {
  console.warn(
    "⚠️ jsonrepair package not found. JSON repair fallback disabled."
  );
}

// ============================================================
// OPENROUTER CLIENT
// ============================================================

const client = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: "https://openrouter.ai/api/v1",
});

const MODEL =
  process.env.OPENROUTER_MODEL ||
  "openai/gpt-oss-20b:free";

// ============================================================
// DEFAULT ROUTER RESULT
// ============================================================

const defaultRouterResult = {
  intent: "conversation",
  confidence: 0.5,
  task: null,
  timeText: null,
  recurring: false,
};

// ============================================================
// NORMALIZE ROUTER RESULT
// ============================================================

const normalizeRouterResult = (result) => {
  if (
    !result ||
    typeof result !== "object" ||
    Array.isArray(result)
  ) {
    return null;
  }

  const allowedIntents = [
    "create_reminder",
    "acknowledge_reminder",
    "conversation",
    "cancel_reminder",
    "reschedule_reminder",
    "unknown",
  ];

  const intent = allowedIntents.includes(result.intent)
    ? result.intent
    : null;

  if (!intent) {
    return null;
  }

  let confidence = Number(result.confidence);

  if (Number.isNaN(confidence)) {
    confidence = 0.5;
  }

  confidence = Math.max(
    0,
    Math.min(1, confidence)
  );

  return {
    intent,

    confidence,

    task:
      typeof result.task === "string" &&
      result.task.trim()
        ? result.task.trim()
        : null,

    timeText:
      typeof result.timeText === "string" &&
      result.timeText.trim()
        ? result.timeText.trim()
        : null,

    recurring: Boolean(result.recurring),
  };
};

// ============================================================
// ACKNOWLEDGMENT DETECTION
// ============================================================
//
// These messages should immediately acknowledge the latest
// reminder without needing AI.
//
// Examples:
//
// done
// okay
// ok
// yes
// completed
// 👍
// 👌
//
// ============================================================

const isAcknowledgmentMessage = (message) => {
  if (!message) {
    return false;
  }

  const text = message
    .trim()
    .toLowerCase();

  const normalized = text
    .replace(/[.!?,]+$/g, "")
    .trim();

  const acknowledgmentPatterns = [
    "done",
    "ok",
    "okay",
    "yes",
    "yep",
    "yeah",
    "sure",
    "completed",
    "complete",
    "finished",
    "finish",
    "got it",
    "got that",
    "all done",
    "task done",
    "work done",

    "👍",
    "👍🏻",
    "👍🏼",
    "👍🏽",
    "👍🏾",
    "👍🏿",

    "👌",
    "👌🏻",
    "👌🏼",
    "👌🏽",
    "👌🏾",
    "👌🏿",
  ];

  return acknowledgmentPatterns.includes(
    normalized
  );
};

// ============================================================
// LOCAL REMINDER DETECTION
// ============================================================

const looksLikeReminder = (message) => {
  if (!message) {
    return false;
  }

  const text = message
    .toLowerCase()
    .trim();

  const reminderPatterns = [
    /\bremind me\b/,
    /\breminder\b/,
    /\bremind\b.*\b(at|on|tomorrow|today|tonight|in|after|every)\b/,
    /\bremember to\b/,
  ];

  return reminderPatterns.some(
    (pattern) => pattern.test(text)
  );
};

// ============================================================
// EXTRACT JSON FROM AI RESPONSE
// ============================================================

const extractJsonCandidate = (content) => {
  if (!content || typeof content !== "string") {
    return null;
  }

  let cleaned = content.trim();

  // Remove markdown code fences.

  cleaned = cleaned
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  // Find JSON object inside surrounding text.

  const firstBrace =
    cleaned.indexOf("{");

  const lastBrace =
    cleaned.lastIndexOf("}");

  if (
    firstBrace !== -1 &&
    lastBrace !== -1 &&
    lastBrace > firstBrace
  ) {
    cleaned = cleaned.slice(
      firstBrace,
      lastBrace + 1
    );
  }

  return cleaned;
};

// ============================================================
// PARSE AI JSON SAFELY
// ============================================================

const parseAIJson = (content) => {
  if (
    !content ||
    typeof content !== "string"
  ) {
    return null;
  }

  const raw = content.trim();

  // Prevent safety-classifier text from being treated as JSON.

  if (
    raw
      .toLowerCase()
      .includes("user safety") ||
    raw.toLowerCase() === "safe" ||
    raw
      .toLowerCase()
      .includes("safety: safe")
  ) {
    console.warn(
      "⚠️ AI returned safety text instead of router JSON."
    );

    return null;
  }

  const candidate =
    extractJsonCandidate(raw);

  if (!candidate) {
    return null;
  }

  // ----------------------------------------
  // NORMAL JSON PARSE
  // ----------------------------------------

  try {
    return JSON.parse(candidate);
  } catch (error) {
    console.warn(
      "⚠️ Normal JSON.parse failed. Trying jsonrepair..."
    );
  }

  // ----------------------------------------
  // JSONREPAIR FALLBACK
  // ----------------------------------------

  if (jsonrepair) {
    try {
      const repaired =
        jsonrepair(candidate);

      const parsed =
        JSON.parse(repaired);

      console.log(
        "🔧 AI repaired JSON successfully."
      );

      return parsed;
    } catch (error) {
      console.error(
        "❌ jsonrepair failed:",
        error.message
      );
    }
  }

  return null;
};

// ============================================================
// LOCAL FALLBACK ROUTER
// ============================================================

const localFallbackRouter = (
  message
) => {
  // Empty message

  if (
    !message ||
    !message.trim()
  ) {
    return {
      ...defaultRouterResult,

      intent: "unknown",

      confidence: 1,
    };
  }

  // Acknowledgment

  if (
    isAcknowledgmentMessage(message)
  ) {
    return {
      intent:
        "acknowledge_reminder",

      confidence: 1,

      task: null,

      timeText: null,

      recurring: false,
    };
  }

  // Obvious reminder

  if (
    looksLikeReminder(message)
  ) {
    return {
      intent: "create_reminder",

      confidence: 0.85,

      task: null,

      timeText: null,

      recurring: false,
    };
  }

  // Otherwise conversation

  return {
    intent: "conversation",

    confidence: 0.7,

    task: null,

    timeText: null,

    recurring: false,
  };
};

// ============================================================
// AI ROUTER
// ============================================================

const parseReminder = async (
  message
) => {
  try {
    if (
      !message ||
      !message.trim()
    ) {
      return {
        intent: "unknown",

        confidence: 1,

        task: null,

        timeText: null,

        recurring: false,
      };
    }

    // ========================================================
    // FAST LOCAL ACKNOWLEDGMENT
    // ========================================================

    if (
      isAcknowledgmentMessage(message)
    ) {
      const result = {
        intent:
          "acknowledge_reminder",

        confidence: 1,

        task: null,

        timeText: null,

        recurring: false,
      };

      console.log(
        "🧠 Local AI Router Result:",
        result
      );

      return result;
    }

    // ========================================================
    // AI ROUTER PROMPT
    // ========================================================

    const systemPrompt = `
You are the central AI router for a personal WhatsApp assistant.

Your job is ONLY to classify the user's message and extract structured
information when necessary.

You are NOT a safety classifier.

NEVER return:
"User Safety: safe"

NEVER return plain text.

NEVER return markdown.

NEVER return an explanation.

You MUST return exactly one JSON object.

Allowed intents:

1. create_reminder
   The user wants to create a reminder.

2. acknowledge_reminder
   The user is acknowledging/completing a reminder.

3. conversation
   The user is simply talking to the assistant.

4. cancel_reminder
   The user wants to cancel an existing reminder.

5. reschedule_reminder
   The user wants to change the time of an existing reminder.

6. unknown
   The message cannot confidently be classified.

JSON structure:

{
  "intent": "create_reminder | acknowledge_reminder | conversation | cancel_reminder | reschedule_reminder | unknown",
  "confidence": 0.0,
  "task": "string or null",
  "timeText": "string or null",
  "recurring": false
}

IMPORTANT RULES:

For create_reminder:

"Remind me to call Mom tomorrow at 8 AM"

must become:

{
  "intent": "create_reminder",
  "confidence": 1,
  "task": "call Mom",
  "timeText": "tomorrow at 8 AM",
  "recurring": false
}

For recurring:

"Remind me to drink water every 2 hours"

must become:

{
  "intent": "create_reminder",
  "confidence": 1,
  "task": "drink water",
  "timeText": "every 2 hours",
  "recurring": true
}

For conversation:

"Hey how are you?"

must become:

{
  "intent": "conversation",
  "confidence": 1,
  "task": null,
  "timeText": null,
  "recurring": false
}

For acknowledgment:

"done"

must become:

{
  "intent": "acknowledge_reminder",
  "confidence": 1,
  "task": null,
  "timeText": null,
  "recurring": false
}

For emoji:

"👍"

must become:

{
  "intent": "acknowledge_reminder",
  "confidence": 1,
  "task": null,
  "timeText": null,
  "recurring": false
}

For cancellation:

"Cancel my reminder to call Mom"

must become:

{
  "intent": "cancel_reminder",
  "confidence": 1,
  "task": "call Mom",
  "timeText": null,
  "recurring": false
}

For rescheduling:

"Move my call Mom reminder to tomorrow at 5 PM"

must become:

{
  "intent": "reschedule_reminder",
  "confidence": 1,
  "task": "call Mom",
  "timeText": "tomorrow at 5 PM",
  "recurring": false
}

The task should contain ONLY the actual task.

Do not include the words "remind me" in task.

Return JSON only.
`;

    // ========================================================
    // CALL OPENROUTER
    // ========================================================

    let response;

    try {
      response =
        await client.chat.completions.create({
          model: MODEL,

          temperature: 0,

          messages: [
            {
              role: "system",
              content: systemPrompt,
            },
            {
              role: "user",
              content: message.trim(),
            },
          ],

          response_format: {
            type: "json_object",
          },
        });
    } catch (structuredError) {
      console.warn(
        "⚠️ Structured JSON request failed. Retrying without response_format..."
      );

      response =
        await client.chat.completions.create({
          model: MODEL,

          temperature: 0,

          messages: [
            {
              role: "system",
              content: systemPrompt,
            },
            {
              role: "user",
              content: message.trim(),
            },
          ],
        });
    }

    const content =
      response
        ?.choices?.[0]
        ?.message?.content;

    console.log(
      "🤖 AI raw response:",
      content
    );

    // ========================================================
    // PARSE RESPONSE
    // ========================================================

    const parsed =
      parseAIJson(content);

    if (parsed) {
      const normalized =
        normalizeRouterResult(
          parsed
        );

      if (normalized) {
        console.log(
          "🧠 AI Router Result:",
          normalized
        );

        return normalized;
      }

      console.warn(
        "⚠️ AI router returned an invalid object."
      );
    }

    // ========================================================
    // LOCAL FALLBACK
    // ========================================================

    console.warn(
      "⚠️ Using local router fallback."
    );

    const fallback =
      localFallbackRouter(message);

    // ========================================================
    // REMINDER EXTRACTION FALLBACK
    // ========================================================

    if (
      fallback.intent ===
      "create_reminder"
    ) {
      try {
        const extractionResponse =
          await client.chat.completions.create(
            {
              model: MODEL,

              temperature: 0,

              messages: [
                {
                  role: "system",

                  content: `
Extract a reminder from the user's message.

Return ONLY JSON:

{
  "intent": "create_reminder",
  "confidence": 0.0,
  "task": "task",
  "timeText": "time expression",
  "recurring": false
}

If you cannot determine both the task and time,
return:

{
  "intent": "unknown",
  "confidence": 0,
  "task": null,
  "timeText": null,
  "recurring": false
}
`,
                },

                {
                  role: "user",

                  content:
                    message.trim(),
                },
              ],

              response_format: {
                type: "json_object",
              },
            }
          );

        const extractionContent =
          extractionResponse
            ?.choices?.[0]
            ?.message?.content;

        console.log(
          "🤖 AI reminder extraction response:",
          extractionContent
        );

        const extraction =
          parseAIJson(
            extractionContent
          );

        const normalizedExtraction =
          normalizeRouterResult(
            extraction
          );

        if (
          normalizedExtraction
        ) {
          console.log(
            "🧠 AI Reminder Extraction Result:",
            normalizedExtraction
          );

          return normalizedExtraction;
        }
      } catch (
        fallbackAIError
      ) {
        console.error(
          "❌ Reminder extraction failed:",
          fallbackAIError.message
        );
      }
    }

    console.log(
      "🧠 Local Router Result:",
      fallback
    );

    return fallback;
  } catch (error) {
    console.error(
      "❌ OpenRouter error:",
      error.response?.data ||
        error.message
    );

    return localFallbackRouter(
      message
    );
  }
};

// ============================================================
// CONVERSATION AI
// ============================================================

const generateConversationReply =
  async ({
    message,
    context = "",
  }) => {
    try {
      const systemPrompt = `
You are a friendly personal WhatsApp assistant.

You are not just a reminder bot.

Talk naturally like a helpful personal assistant.

Your responsibilities include:

- casual conversation
- helping the user think
- answering simple questions
- helping plan the day
- understanding emotions
- remembering context when context is provided
- helping with productivity
- suggesting useful actions when appropriate

Do not sound robotic.

Do not repeatedly say:
"I am Reminder PA."

Do not force every conversation into a reminder.

If the user says something emotional, respond naturally.

If the user says something exciting, acknowledge it.

If the user asks a normal question, answer it normally.

Keep WhatsApp responses reasonably concise.

User message:

${message}

Previous context:

${context || "No previous context available."}
`;

      const response =
        await client.chat.completions.create(
          {
            model: MODEL,

            temperature: 0.7,

            messages: [
              {
                role: "system",
                content:
                  systemPrompt,
              },

              {
                role: "user",
                content: message,
              },
            ],
          }
        );

      const reply =
        response
          ?.choices?.[0]
          ?.message?.content;

      if (
        !reply ||
        !reply.trim()
      ) {
        return "I'm here. Tell me what's on your mind. 😊";
      }

      return reply.trim();
    } catch (error) {
      console.error(
        "❌ Conversation AI error:",
        error.response?.data ||
          error.message
      );

      return "I'm here with you. Tell me what you need help with. 😊";
    }
  };

// ============================================================
// BACKWARD-COMPATIBLE ALIASES
// ============================================================
//
// Your existing controllers use:
//
// analyzeMessage()
// generateConversationResponse()
//
// Your reminder pipeline uses:
//
// parseReminder()
// generateConversationReply()
//
// Keep all four names available so we don't have to change
// multiple files.
//
// ============================================================

const analyzeMessage =
  parseReminder;

const generateConversationResponse =
  generateConversationReply;

// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  // Main router
  parseReminder,

  // Controller compatibility
  analyzeMessage,

  // Main conversation function
  generateConversationReply,

  // Controller compatibility
  generateConversationResponse,
};