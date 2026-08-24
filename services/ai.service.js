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
// MEMORY EXTRACTION
// ============================================================

const extractMemory = async ({
  message,
  phoneNumber = null,
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


    const systemPrompt = `
You are the memory extraction system for a personal AI assistant.

Determine whether the user's message contains information
worth remembering for future conversations.

Remember information that is:

- personal
- useful later
- reasonably stable
- explicitly stated or strongly implied

Types:

fact
preference
routine


============================================================
NEW MEMORY
============================================================

"My favorite color is blue."

Return:

{
  "shouldRemember": true,
  "isUpdate": false,
  "type": "preference",
  "key": "favorite_color",
  "value": "blue"
}


============================================================
MEMORY UPDATE / CORRECTION
============================================================

If the user corrects something previously remembered:

"Actually, my favorite color is green."

Return:

{
  "shouldRemember": true,
  "isUpdate": true,
  "type": "preference",
  "key": "favorite_color",
  "value": "green"
}


Other correction examples:

"No, I prefer tea."

"I meant 6 PM, not 7 PM."

"From now on, remind me at 8 AM."

"Change my walking time to 6 PM."

"I don't like long reminders."

"I prefer short messages."


============================================================
DO NOT REMEMBER
============================================================

Do NOT remember:

"What's the weather?"

"Tell me a joke."

"Okay."

"Haha 😂"

"Thanks."


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

If something is a correction:

{
  "shouldRemember": true,
  "isUpdate": true,
  "type": "fact | preference | routine",
  "key": "short_snake_case_key",
  "value": "new value"
}

Otherwise:

{
  "shouldRemember": false,
  "isUpdate": false,
  "type": null,
  "key": null,
  "value": null
}


IMPORTANT:

Do not invent information.

Do not store temporary emotions.

Do not store sensitive personal information.

Return JSON only.
`;


    const response =
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


    const content =
      response
        ?.choices?.[0]
        ?.message?.content;


    console.log(
      "🧠 Memory extractor raw response:",
      content
    );


    const parsed =
      parseAIJson(content);


    if (!parsed) {

      return {
        shouldRemember: false,
        isUpdate: false,
        type: null,
        key: null,
        value: null,
      };
    }


    /*
    Validate shouldRemember
    */

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


    /*
    Validate type
    */

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

      return {
        shouldRemember: false,
        isUpdate: false,
        type: null,
        key: null,
        value: null,
      };
    }


    /*
    Validate key
    */

    if (
      typeof parsed.key !==
        "string" ||
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


    /*
    Validate value
    */

    if (
      typeof parsed.value !==
        "string" ||
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
      "🧠 Memory extraction result:",
      result
    );


    return result;

  } catch (error) {

    console.error(
      "❌ Memory extraction error:",
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