const OpenAI = require("openai");


// ============================================================
// MEMORY SERVICE
// ============================================================

const {
  buildMemoryContext,
} = require("./memory.service");


// ============================================================
// JSON REPAIR
// ============================================================

let jsonrepair = null;

try {
  const repairModule =
    require("jsonrepair");

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
  apiKey:
    process.env.OPENROUTER_API_KEY,

  baseURL:
    "https://openrouter.ai/api/v1",
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

const normalizeRouterResult = (
  result
) => {

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

  const intent =
    allowedIntents.includes(
      result.intent
    )
      ? result.intent
      : null;

  if (!intent) {
    return null;
  }

  let confidence =
    Number(result.confidence);

  if (Number.isNaN(confidence)) {
    confidence = 0.5;
  }

  confidence =
    Math.max(
      0,
      Math.min(1, confidence)
    );

  return {
    intent,
    confidence,

    task:
      typeof result.task ===
        "string" &&
      result.task.trim()
        ? result.task.trim()
        : null,

    timeText:
      typeof result.timeText ===
        "string" &&
      result.timeText.trim()
        ? result.timeText.trim()
        : null,

    recurring:
      Boolean(result.recurring),
  };
};


// ============================================================
// ACKNOWLEDGMENT DETECTION
// ============================================================

const isAcknowledgmentMessage = (
  message
) => {

  if (!message) {
    return false;
  }

  const text =
    message
      .trim()
      .toLowerCase();

  const normalized =
    text
      .replace(
        /[.!?,]+$/g,
        ""
      )
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

const looksLikeReminder = (
  message
) => {

  if (!message) {
    return false;
  }

  const text =
    message
      .toLowerCase()
      .trim();

  const reminderPatterns = [
    /\bremind me\b/,
    /\breminder\b/,
    /\bremind\b.*\b(at|on|tomorrow|today|tonight|in|after|every)\b/,
    /\bremember to\b/,
  ];

  return reminderPatterns.some(
    (pattern) =>
      pattern.test(text)
  );
};


// ============================================================
// EXTRACT JSON CANDIDATE
// ============================================================

const extractJsonCandidate = (
  content
) => {

  if (
    !content ||
    typeof content !== "string"
  ) {
    return null;
  }

  let cleaned =
    content.trim();

  cleaned =
    cleaned
      .replace(
        /^```json\s*/i,
        ""
      )
      .replace(
        /^```\s*/i,
        ""
      )
      .replace(
        /\s*```$/i,
        ""
      )
      .trim();

  const firstBrace =
    cleaned.indexOf("{");

  const lastBrace =
    cleaned.lastIndexOf("}");

  if (
    firstBrace !== -1 &&
    lastBrace !== -1 &&
    lastBrace > firstBrace
  ) {
    cleaned =
      cleaned.slice(
        firstBrace,
        lastBrace + 1
      );
  }

  return cleaned;
};


// ============================================================
// PARSE AI JSON
// ============================================================

const parseAIJson = (
  content
) => {

  if (
    !content ||
    typeof content !== "string"
  ) {
    return null;
  }

  const raw =
    content.trim();

  if (
    raw
      .toLowerCase()
      .includes(
        "user safety"
      ) ||
    raw.toLowerCase() ===
      "safe" ||
    raw
      .toLowerCase()
      .includes(
        "safety: safe"
      )
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


  /*
  Normal JSON
  */

  try {
    return JSON.parse(
      candidate
    );

  } catch (error) {

    console.warn(
      "⚠️ Normal JSON.parse failed. Trying jsonrepair..."
    );
  }


  /*
  jsonrepair
  */

  if (jsonrepair) {

    try {

      const repaired =
        jsonrepair(
          candidate
        );

      const parsed =
        JSON.parse(
          repaired
        );

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

  if (
    !message ||
    !message.trim()
  ) {

    return {
      ...defaultRouterResult,

      intent:
        "unknown",

      confidence:
        1,
    };
  }


  if (
    isAcknowledgmentMessage(
      message
    )
  ) {

    return {
      intent:
        "acknowledge_reminder",

      confidence:
        1,

      task:
        null,

      timeText:
        null,

      recurring:
        false,
    };
  }


  if (
    looksLikeReminder(
      message
    )
  ) {

    return {
      intent:
        "create_reminder",

      confidence:
        0.85,

      task:
        null,

      timeText:
        null,

      recurring:
        false,
    };
  }


  return {
    intent:
      "conversation",

    confidence:
      0.7,

    task:
      null,

    timeText:
      null,

    recurring:
      false,
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
        intent:
          "unknown",

        confidence:
          1,

        task:
          null,

        timeText:
          null,

        recurring:
          false,
      };
    }


    /*
    Fast acknowledgment
    */

    if (
      isAcknowledgmentMessage(
        message
      )
    ) {

      const result = {
        intent:
          "acknowledge_reminder",

        confidence:
          1,

        task:
          null,

        timeText:
          null,

        recurring:
          false,
      };

      console.log(
        "🧠 Local AI Router Result:",
        result
      );

      return result;
    }


    /*
    Router prompt
    */

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
2. acknowledge_reminder
3. conversation
4. cancel_reminder
5. reschedule_reminder
6. unknown

JSON structure:

{
  "intent": "create_reminder | acknowledge_reminder | conversation | cancel_reminder | reschedule_reminder | unknown",
  "confidence": 0.0,
  "task": "string or null",
  "timeText": "string or null",
  "recurring": false
}

Examples:

"Remind me to call Mom tomorrow at 8 AM"

{
  "intent": "create_reminder",
  "confidence": 1,
  "task": "call Mom",
  "timeText": "tomorrow at 8 AM",
  "recurring": false
}

"Remind me to drink water every 2 hours"

{
  "intent": "create_reminder",
  "confidence": 1,
  "task": "drink water",
  "timeText": "every 2 hours",
  "recurring": true
}

"Hey how are you?"

{
  "intent": "conversation",
  "confidence": 1,
  "task": null,
  "timeText": null,
  "recurring": false
}

"done"

{
  "intent": "acknowledge_reminder",
  "confidence": 1,
  "task": null,
  "timeText": null,
  "recurring": false
}

"👍"

{
  "intent": "acknowledge_reminder",
  "confidence": 1,
  "task": null,
  "timeText": null,
  "recurring": false
}

"Cancel my reminder to call Mom"

{
  "intent": "cancel_reminder",
  "confidence": 1,
  "task": "call Mom",
  "timeText": null,
  "recurring": false
}

"Move my call Mom reminder to tomorrow at 5 PM"

{
  "intent": "reschedule_reminder",
  "confidence": 1,
  "task": "call Mom",
  "timeText": "tomorrow at 5 PM",
  "recurring": false
}

Do not include "remind me" in the task.

Return JSON only.
`;


    let response;


    try {

      response =
        await client.chat.completions.create({
          model:
            MODEL,

          temperature:
            0,

          messages: [
            {
              role:
                "system",

              content:
                systemPrompt,
            },

            {
              role:
                "user",

              content:
                message.trim(),
            },
          ],

          response_format: {
            type:
              "json_object",
          },
        });

    } catch (
      structuredError
    ) {

      console.warn(
        "⚠️ Structured JSON request failed. Retrying without response_format..."
      );

      response =
        await client.chat.completions.create({
          model:
            MODEL,

          temperature:
            0,

          messages: [
            {
              role:
                "system",

              content:
                systemPrompt,
            },

            {
              role:
                "user",

              content:
                message.trim(),
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


    const parsed =
      parseAIJson(
        content
      );


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
    }


    /*
    Fallback
    */

    console.warn(
      "⚠️ Using local router fallback."
    );

    const fallback =
      localFallbackRouter(
        message
      );


    /*
    Reminder extraction fallback
    */

    if (
      fallback.intent ===
      "create_reminder"
    ) {

      try {

        const extractionResponse =
          await client.chat.completions.create({
            model:
              MODEL,

            temperature:
              0,

            messages: [
              {
                role:
                  "system",

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

If you cannot determine both the task and time:

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
                role:
                  "user",

                content:
                  message.trim(),
              },
            ],

            response_format: {
              type:
                "json_object",
            },
          });


        const extractionContent =
          extractionResponse
            ?.choices?.[0]
            ?.message?.content;


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
// CONVERSATION AI + USER MEMORY
// ============================================================

const generateConversationReply =
  async ({
    message,
    phoneNumber = null,
    context = "",
  }) => {

    try {

      let memoryContext =
        "";

      /*
      Load MongoDB memory.
      */

      if (phoneNumber) {

        try {

          memoryContext =
            await buildMemoryContext(
              phoneNumber
            );

          console.log(
            "🧠 User memory loaded for:",
            phoneNumber
          );

        } catch (
          memoryError
        ) {

          console.error(
            "⚠️ Could not load user memory:",
            memoryError.message
          );

          memoryContext =
            "No stored memory available.";
        }
      }


      const combinedContext = `
USER MEMORY:

${memoryContext || "No stored memory available."}


RECENT CONTEXT:

${context || "No additional context available."}
`;


      const systemPrompt = `
You are a friendly personal WhatsApp assistant.

You are not just a reminder bot.

You are a personal assistant who knows the user over time.

Use the user's memory and recent context to make responses
more personalized and natural.

IMPORTANT:

- Do not mention the internal memory database.
- Do not reveal internal memory structures.
- Do not invent facts.
- Only use information provided in memory/context.
- If something is uncertain, don't pretend you know it.
- Do not force every conversation into a reminder.

Your responsibilities include:

- casual conversation
- answering questions
- helping plan the day
- understanding emotions
- productivity
- personalized suggestions

If the user says "it", "that", "them", "the project", etc.,
use recent context and memory to understand the reference.

Do not sound robotic.

Keep WhatsApp responses reasonably concise.


============================================================
USER MEMORY + CONTEXT
============================================================

${combinedContext}


============================================================
CURRENT MESSAGE
============================================================

${message}
`;


      const response =
        await client.chat.completions.create({
          model:
            MODEL,

          temperature:
            0.7,

          messages: [
            {
              role:
                "system",

              content:
                systemPrompt,
            },

            {
              role:
                "user",

              content:
                message,
            },
          ],
        });


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
// MEMORY EXTRACTION WITH CONTEXT
// ============================================================

const extractMemory = async ({
  message,
  phoneNumber = null,
  recentContext = [],
  existingMemory = "",
}) => {

  try {

    if (
      !message ||
      !message.trim()
    ) {
      return {
        shouldRemember: false,
        isUpdate: false,
        type: null,
        key: null,
        value: null,
      };
    }


    // ========================================================
    // FORMAT RECENT CONTEXT
    // ========================================================

    const formattedRecentContext =
      Array.isArray(recentContext) &&
      recentContext.length
        ? recentContext
            .map(
              (item) =>
                `${item.role}: ${item.content}`
            )
            .join("\n")
        : "No recent conversation available.";


    // ========================================================
    // MEMORY EXTRACTION PROMPT
    // ========================================================

    const systemPrompt = `
You are the long-term memory system for a personal AI WhatsApp assistant.

Your job is to identify information that should be remembered about
the user for future conversations.

You have access to:

1. EXISTING USER MEMORY
2. RECENT CONVERSATION
3. CURRENT USER MESSAGE

Use ALL THREE when deciding what the user means.

============================================================
EXISTING USER MEMORY
============================================================

${existingMemory || "No stored memory available."}


============================================================
RECENT CONVERSATION
============================================================

${formattedRecentContext}


============================================================
CURRENT USER MESSAGE
============================================================

${message.trim()}


============================================================
WHAT TO REMEMBER
============================================================

Remember information that is:

- personal
- useful in future conversations
- reasonably stable
- explicitly stated
- a correction to previously stored information
- a preference
- a routine
- a useful personal fact


============================================================
IMPORTANT: CONTEXTUAL CORRECTIONS
============================================================

The user may refer to something indirectly.

Example:

User:
"I usually go for a walk at 7 PM."

Assistant:
"Got it. That's a nice routine."

User:
"Actually, make that 6 PM."

The current message does NOT explicitly say "walking".

You must use the recent conversation and existing memory.

Return:

{
  "shouldRemember": true,
  "isUpdate": true,
  "type": "routine",
  "key": "walking",
  "value": "6 PM"
}


Another example:

Existing memory:
favorite_color = blue

User:
"Actually, my favorite color is green."

Return:

{
  "shouldRemember": true,
  "isUpdate": true,
  "type": "preference",
  "key": "favorite_color",
  "value": "green"
}


Another example:

Existing memory:
walking = 7 PM

User:
"Change that to 6 PM."

If recent conversation makes it clear that "that" refers to walking:

{
  "shouldRemember": true,
  "isUpdate": true,
  "type": "routine",
  "key": "walking",
  "value": "6 PM"
}


============================================================
NEW MEMORY
============================================================

Example:

"My favorite color is green."

Return:

{
  "shouldRemember": true,
  "isUpdate": false,
  "type": "preference",
  "key": "favorite_color",
  "value": "green"
}


Example:

"I usually go for a walk at 7 PM."

Return:

{
  "shouldRemember": true,
  "isUpdate": false,
  "type": "routine",
  "key": "walking",
  "value": "7 PM"
}


Example:

"My name is Nitin."

Return:

{
  "shouldRemember": true,
  "isUpdate": false,
  "type": "fact",
  "key": "name",
  "value": "Nitin"
}


============================================================
DO NOT REMEMBER
============================================================

Do NOT remember:

"What's the weather?"

"Tell me a joke."

"Okay."

"Haha 😂"

"Thanks."

Temporary emotions.

One-time statements that have no future usefulness.


============================================================
OUTPUT
============================================================

If something should be remembered:

{
  "shouldRemember": true,
  "isUpdate": false,
  "type": "fact | preference | routine",
  "key": "short_snake_case_key",
  "value": "short description"
}


If something updates existing memory:

{
  "shouldRemember": true,
  "isUpdate": true,
  "type": "fact | preference | routine",
  "key": "short_snake_case_key",
  "value": "new value"
}


If nothing should be remembered:

{
  "shouldRemember": false,
  "isUpdate": false,
  "type": null,
  "key": null,
  "value": null
}


============================================================
IMPORTANT RULES
============================================================

- Use recent conversation to resolve words such as:
  "it", "that", "this", "them", "there", "same", "change it",
  "make that", "instead", "actually", etc.

- Use existing memory to understand corrections.

- If the user is correcting existing memory, set isUpdate=true.

- Do NOT invent information.

- Do NOT guess when the reference is genuinely ambiguous.

- Do NOT store sensitive personal information.

- Do NOT store temporary emotions.

- Return JSON only.

NEVER return markdown.
NEVER return explanations.
NEVER return "User Safety: safe".
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
        "⚠️ Structured memory JSON request failed. Retrying..."
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


    // ========================================================
    // AI RESPONSE
    // ========================================================

    const content =
      response
        ?.choices?.[0]
        ?.message?.content;


    console.log(
      "🧠 Memory extractor raw response:",
      content
    );


    // ========================================================
    // PARSE JSON
    // ========================================================

    const parsed =
      parseAIJson(content);


    if (!parsed) {

      console.warn(
        "⚠️ Memory extractor returned invalid JSON."
      );

      return {
        shouldRemember: false,
        isUpdate: false,
        type: null,
        key: null,
        value: null,
      };
    }


    // ========================================================
    // VALIDATE shouldRemember
    // ========================================================

    if (
      parsed.shouldRemember !== true
    ) {

      return {
        shouldRemember: false,
        isUpdate: false,
        type: null,
        key: null,
        value: null,
      };
    }


    // ========================================================
    // VALIDATE TYPE
    // ========================================================

    const allowedTypes = [
      "fact",
      "preference",
      "routine",
    ];

    if (
      !allowedTypes.includes(
        parsed.type
      )
    ) {

      console.warn(
        "⚠️ Invalid memory type:",
        parsed.type
      );

      return {
        shouldRemember: false,
        isUpdate: false,
        type: null,
        key: null,
        value: null,
      };
    }


    // ========================================================
    // VALIDATE KEY
    // ========================================================

    if (
      typeof parsed.key !== "string" ||
      !parsed.key.trim()
    ) {

      return {
        shouldRemember: false,
        isUpdate: false,
        type: null,
        key: null,
        value: null,
      };
    }


    // ========================================================
    // VALIDATE VALUE
    // ========================================================

    if (
      typeof parsed.value !== "string" ||
      !parsed.value.trim()
    ) {

      return {
        shouldRemember: false,
        isUpdate: false,
        type: null,
        key: null,
        value: null,
      };
    }


    // ========================================================
    // FINAL RESULT
    // ========================================================

    const result = {

      shouldRemember: true,

      isUpdate:
        parsed.isUpdate === true,

      type:
        parsed.type,

      key:
        parsed.key.trim(),

      value:
        parsed.value.trim(),
    };


    console.log(
      "🧠 Context-aware memory result:",
      result
    );


    return result;

  } catch (error) {

    console.error(
      "❌ Context-aware memory extraction error:",
      error.response?.data ||
        error.message
    );

    return {
      shouldRemember: false,
      isUpdate: false,
      type: null,
      key: null,
      value: null,
    };
  }
};

// ============================================================
// BACKWARD-COMPATIBLE ALIASES
// ============================================================

const analyzeMessage =
  parseReminder;

const generateConversationResponse =
  generateConversationReply;


// ============================================================
// EXPORTS
// ============================================================

module.exports = {

  parseReminder,

  analyzeMessage,

  generateConversationReply,

  generateConversationResponse,

  extractMemory,
};