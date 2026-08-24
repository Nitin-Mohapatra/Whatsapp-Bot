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
  reminders: [],
};

// ============================================================
// NORMALIZE REMINDER
// ============================================================

const normalizeReminder = (reminder) => {
  if (
    !reminder ||
    typeof reminder !== "object" ||
    Array.isArray(reminder)
  ) {
    return null;
  }

  const task =
    typeof reminder.task === "string" &&
    reminder.task.trim()
      ? reminder.task.trim()
      : null;

  const timeText =
    typeof reminder.timeText === "string" &&
    reminder.timeText.trim()
      ? reminder.timeText.trim()
      : null;

  if (!task || !timeText) {
    return null;
  }

  return {
    task,
    timeText,
    recurring: Boolean(reminder.recurring),
  };
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

  // ==========================================================
  // MULTIPLE REMINDERS
  // ==========================================================

  let reminders = [];

  if (Array.isArray(result.reminders)) {
    reminders = result.reminders
      .map(normalizeReminder)
      .filter(Boolean);
  }

  // ==========================================================
  // BACKWARD COMPATIBILITY
  //
  // If AI returns old:
  //
  // task
  // timeText
  //
  // convert it into reminders[]
  // ==========================================================

  if (
    reminders.length === 0 &&
    typeof result.task === "string" &&
    result.task.trim() &&
    typeof result.timeText === "string" &&
    result.timeText.trim()
  ) {
    reminders = [
      {
        task: result.task.trim(),
        timeText: result.timeText.trim(),
        recurring: Boolean(result.recurring),
      },
    ];
  }

  const firstReminder =
    reminders.length > 0
      ? reminders[0]
      : null;

  return {
    intent,

    confidence,

    // Backward compatible fields
    task:
      firstReminder?.task || null,

    timeText:
      firstReminder?.timeText || null,

    recurring:
      firstReminder?.recurring || false,

    // New multiple-reminder field
    reminders,
  };
};

// ============================================================
// ACKNOWLEDGMENT DETECTION
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

  /*
   IMPORTANT:

   We intentionally DO NOT include:

   ok
   okay
   yes
   yep
   yeah
   sure
   thanks

   because those are normal conversational messages.

   Example:

   User: "Reminder: drink water"

   User: "okay"

   "okay" should NOT complete the reminder.
  */

  const acknowledgmentPatterns = [
    "done",
    "completed",
    "complete",
    "finished",
    "finish",
    "all done",
    "task done",
    "work done",
    "i'm done",
    "im done",
    "i am done",
    "i completed it",
    "completed it",
    "task completed",
    "work completed",

    // Thumbs-up
    "👍",
    "👍🏻",
    "👍🏼",
    "👍🏽",
    "👍🏾",
    "👍🏿",

    // OK hand
    "👌",
    "👌🏻",
    "👌🏼",
    "👌🏽",
    "👌🏾",
    "👌🏿",

    // Check marks
    "✅",
    "☑️",
    "☑",
    "✔️",
    "✔",
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
// JSON CANDIDATE EXTRACTION
// ============================================================

const extractJsonCandidate = (content) => {
  if (
    !content ||
    typeof content !== "string"
  ) {
    return null;
  }

  let cleaned = content.trim();

  // Remove markdown fences
  cleaned = cleaned
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
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
    cleaned = cleaned.slice(
      firstBrace,
      lastBrace + 1
    );
  }

  return cleaned;
};

// ============================================================
// SAFE AI JSON PARSER
// ============================================================

const parseAIJson = (content) => {
  if (
    !content ||
    typeof content !== "string"
  ) {
    return null;
  }

  const raw = content.trim();

  // Prevent OpenRouter safety text from being treated as JSON
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

  // ==========================================================
  // NORMAL JSON
  // ==========================================================

  try {
    return JSON.parse(candidate);
  } catch (error) {
    console.warn(
      "⚠️ Normal JSON.parse failed. Trying jsonrepair..."
    );
  }

  // ==========================================================
  // JSON REPAIR
  // ==========================================================

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

const localFallbackRouter = (message) => {
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

  // ==========================================================
  // ACKNOWLEDGMENT
  // ==========================================================

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

      reminders: [],
    };
  }

  // ==========================================================
  // REMINDER
  // ==========================================================

  if (
    looksLikeReminder(message)
  ) {
    return {
      intent:
        "create_reminder",

      confidence: 0.85,

      task: null,

      timeText: null,

      recurring: false,

      reminders: [],
    };
  }

  // ==========================================================
  // NORMAL CONVERSATION
  // ==========================================================

  return {
    intent:
      "conversation",

    confidence: 0.7,

    task: null,

    timeText: null,

    recurring: false,

    reminders: [],
  };
};

// ============================================================
// AI ROUTER
// ============================================================

const parseReminder = async (message) => {
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
        reminders: [],
      };
    }

    // ========================================================
    // FAST ACKNOWLEDGMENT
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

        reminders: [],
      };

      console.log(
        "🧠 Local AI Router Result:",
        result
      );

      return result;
    }

    // ========================================================
    // ROUTER PROMPT
    // ========================================================

    const systemPrompt = `
You are the central AI router for a personal WhatsApp assistant.

Your job is ONLY to classify the user's message.

You are NOT a safety classifier.

NEVER return:
"User Safety: safe"

NEVER return plain text.

NEVER return markdown.

NEVER return an explanation.

You MUST return exactly ONE JSON object.

============================================================
ALLOWED INTENTS
============================================================

1. create_reminder

The user wants to create one OR MORE new reminders.

Examples:

"Remind me to call Mom tomorrow at 8 AM"

"Remind me to drink water after 10 minutes"

"Remind me to study every day at 8 PM"

IMPORTANT:

A SINGLE USER MESSAGE CAN CONTAIN MULTIPLE REMINDERS.

Example:

"Tomorrow remind me to complete CN video at 10 AM,
then complete Growtern work at 12 PM,
and complete Bhayasutra work at 2 PM."

Return THREE reminders.

============================================================
2. acknowledge_reminder
============================================================

The user clearly indicates that a reminder/task has been completed.

Examples:

"done"

"completed"

"I completed it"

"task done"

"👍"

"👌"

"✅"

"☑️"

"✔️"

IMPORTANT:

Do NOT classify these as acknowledgment:

"ok"

"okay"

"yes"

"yep"

"yeah"

"sure"

"thanks"

Those are normal conversation unless they explicitly say
the task was completed.

============================================================
3. conversation
============================================================

Normal conversation.

Examples:

"How are you?"

"I am feeling excited."

"Tell me a joke."

"I got a project worth 1 crore."

"I usually drink water at 1:20 AM."

IMPORTANT:

A statement about a personal habit or routine is still
conversation at the ROUTER level.

The memory system separately detects and saves the routine.

============================================================
4. cancel_reminder
============================================================

The user explicitly wants to cancel an existing reminder.

Example:

"Cancel my reminder to call Mom"

============================================================
5. reschedule_reminder
============================================================

The user explicitly wants to change an EXISTING REMINDER.

Examples:

"Move my call Mom reminder to tomorrow at 5 PM"

"Reschedule my reminder to 6 PM"

"Change my reminder to tomorrow"

IMPORTANT:

Do NOT classify a simple correction of a personal routine
as reschedule_reminder.

Example:

"I usually drink water at 1:20 AM"

Then:

"Sorry, it is 1:35 AM"

This is NOT reschedule_reminder.

It is normal conversation / memory correction.

============================================================
6. unknown
============================================================

Use only when the message cannot reasonably be classified.

============================================================
MULTIPLE REMINDER OUTPUT
============================================================

For ONE reminder:

{
  "intent": "create_reminder",
  "confidence": 1,
  "reminders": [
    {
      "task": "drink water",
      "timeText": "tomorrow at 12 PM",
      "recurring": false
    }
  ]
}

For MULTIPLE reminders:

{
  "intent": "create_reminder",
  "confidence": 1,
  "reminders": [
    {
      "task": "complete CN video",
      "timeText": "tomorrow at 10 AM",
      "recurring": false
    },
    {
      "task": "complete Growtern work",
      "timeText": "tomorrow at 12 PM",
      "recurring": false
    },
    {
      "task": "complete Bhayasutra work",
      "timeText": "tomorrow at 2 PM",
      "recurring": false
    }
  ]
}

============================================================
OTHER INTENTS
============================================================

For conversation:

{
  "intent": "conversation",
  "confidence": 0.9,
  "reminders": []
}

For acknowledgment:

{
  "intent": "acknowledge_reminder",
  "confidence": 1,
  "reminders": []
}

============================================================
IMPORTANT RULES
============================================================

- Do not invent information.
- Do not turn normal conversation into a reminder.
- Do not turn routine corrections into reminder rescheduling.
- Do not treat "okay" as task completion.
- Do not treat "yes" as task completion.
- Do not treat "thanks" as task completion.
- Multiple reminders MUST be returned inside reminders[].
- Each reminder must have its own task and timeText.
- Keep the original meaning of the user's task.
- Do not merge separate reminders.
- Do not drop reminders.
- Return JSON only.
`;

    let response;

    // ========================================================
    // OPENROUTER REQUEST
    // ========================================================

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
    // PARSE
    // ========================================================

    const parsed =
      parseAIJson(content);

    if (parsed) {
      const normalized =
        normalizeRouterResult(parsed);

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
          await client.chat.completions.create({
            model: MODEL,

            temperature: 0,

            messages: [
              {
                role: "system",

                content: `
Extract ALL reminders from the user's message.

A single message may contain multiple reminders.

Return ONLY JSON.

Example:

{
  "intent": "create_reminder",
  "confidence": 1,
  "reminders": [
    {
      "task": "complete CN video",
      "timeText": "tomorrow at 10 AM",
      "recurring": false
    },
    {
      "task": "complete Growtern work",
      "timeText": "tomorrow at 12 PM",
      "recurring": false
    }
  ]
}

If no valid reminder can be extracted:

{
  "intent": "unknown",
  "confidence": 0,
  "reminders": []
}

Do not merge multiple reminders.

Return JSON only.
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
          });

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
          normalizedExtraction &&
          normalizedExtraction.reminders.length > 0
        ) {
          console.log(
            "🧠 AI Reminder Extraction Result:",
            normalizedExtraction
          );

          return normalizedExtraction;
        }
      } catch (fallbackAIError) {
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
// CONVERSATION AI + MEMORY
// ============================================================

const generateConversationReply = async ({
  message,
  phoneNumber = null,
  context = "",
}) => {
  try {
    let memoryContext = "";

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
      } catch (memoryError) {
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

You are NOT just a reminder bot.

You are a personal assistant who knows the user over time.

Use the user's memory and recent conversation context
to understand what the user means.

============================================================
PERSONALIZATION
============================================================

Use known information naturally.

If the user tells you:

"My name is Nitin."

Remember and use Nitin.

If the user says:

"My favorite color is green."

Remember it.

If the user says:

"I usually walk at 7 PM."

Remember it.

If the user later says:

"Actually it is 6 PM."

Understand that this may be a correction to the previous
routine.

Do NOT respond:

"I understand you want to reschedule a reminder."

unless the user explicitly mentioned a reminder.

Instead respond naturally:

"Got it 😊 I've updated your usual walking time to 6 PM."

============================================================
CONTEXT REFERENCES
============================================================

Understand phrases like:

- it
- that
- this
- them
- he
- she
- my usual time
- my normal routine
- actually
- sorry
- I meant
- change that
- make that
- no, it is

Use recent context and memory to resolve them.

============================================================
IMPORTANT RULES
============================================================

- Do not mention the internal memory database.
- Do not reveal internal memory structures.
- Do not invent facts.
- Only use information present in memory/context.
- If something is uncertain, ask naturally.
- Do not force conversations into reminders.
- Do not repeatedly say "I am Reminder PA".
- Do not sound robotic.
- Be warm and natural.
- Keep WhatsApp responses reasonably concise.

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

    let memoryContext =
      "No stored memory available.";

    if (phoneNumber) {
      try {
        memoryContext =
          await buildMemoryContext(
            phoneNumber
          );

        console.log(
          "🧠 Memory context loaded for extraction."
        );
      } catch (memoryError) {
        console.error(
          "⚠️ Memory context loading failed:",
          memoryError.message
        );
      }
    }

    const systemPrompt = `
You are the memory extraction system for a personal AI assistant.

Your job is to determine whether the user's message contains
information that should be remembered.

You have access to the user's existing memory.

============================================================
MEMORY TYPES
============================================================

Allowed types:

fact
preference
routine

============================================================
FACT
============================================================

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
PREFERENCE
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

============================================================
ROUTINE
============================================================

Example:

"I usually drink water at 1:20 AM."

Return:

{
  "shouldRemember": true,
  "isUpdate": false,
  "type": "routine",
  "key": "drink_water",
  "value": "1:20 AM"
}

Example:

"I usually walk at 7 PM."

Return:

{
  "shouldRemember": true,
  "isUpdate": false,
  "type": "routine",
  "key": "walking",
  "value": "7 PM"
}

============================================================
CONTEXTUAL CORRECTIONS
============================================================

The user may correct something without repeating the subject.

Example:

Previous:
"I usually drink water at 1:20 AM."

Current:
"Sorry it is 1:35 AM."

This means:

Update drink_water.

Return:

{
  "shouldRemember": true,
  "isUpdate": true,
  "type": "routine",
  "key": "drink_water",
  "value": "1:35 AM"
}

============================================================
CORRECTION PHRASES
============================================================

Pay special attention to:

- actually
- sorry
- I meant
- I mean
- no, it is
- no, it's
- change that
- make that
- not
- instead
- from now on

============================================================
DO NOT REMEMBER
============================================================

Do not save:

"Okay."

"Thanks."

"Haha 😂"

"Tell me a joke."

"How are you?"

"What is the weather?"

Temporary emotions should normally not be stored.

============================================================
EXISTING MEMORY
============================================================

${memoryContext}

============================================================
CURRENT USER MESSAGE
============================================================

${message.trim()}

============================================================
OUTPUT
============================================================

If useful memory exists:

{
  "shouldRemember": true,
  "isUpdate": false,
  "type": "fact | preference | routine",
  "key": "short_snake_case_key",
  "value": "short value"
}

For an update:

{
  "shouldRemember": true,
  "isUpdate": true,
  "type": "fact | preference | routine",
  "key": "existing memory key",
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

Return JSON only.
`;

    let response;

    try {
      response =
        await client.chat.completions.create({
          model: MODEL,

          temperature: 0,

          messages: [
            {
              role: "system",
              content:
                systemPrompt,
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
        });
    } catch (structuredError) {
      console.warn(
        "⚠️ Memory structured JSON request failed. Retrying..."
      );

      response =
        await client.chat.completions.create({
          model: MODEL,

          temperature: 0,

          messages: [
            {
              role: "system",
              content:
                systemPrompt,
            },

            {
              role: "user",
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
      "🧠 Memory extractor raw response:",
      content
    );

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

  // Exported for testing/debugging if required
  isAcknowledgmentMessage,

  looksLikeReminder,
};