const OpenAI = require("openai");

const chrono = require("chrono-node");

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
    "connect_google_calendar",
    "CALENDAR_QUERY",
    "cancel_reminder",
    "reschedule_reminder",
    "unknown",
  ];

  const rawIntent =
    result.intent === "calendar_query"
      ? "CALENDAR_QUERY"
      : result.intent;

  const intent = allowedIntents.includes(rawIntent)
    ? rawIntent
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

    recurring:
      Boolean(result.recurring),

    date:
      typeof result.date === "string" &&
      result.date.trim()
        ? result.date.trim()
        : null,

    range:
      result.range === "day"
        ? "day"
        : null,
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

    "haan",
    "ha",
    "haan ho gaya",
    "ho gaya",
    "ho gya",
    "kar diya",
    "kar liya",
    "done hai",
    "complete hai",

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

    "✅",
    "✔️",
    "✔",
  ];

  return acknowledgmentPatterns.includes(
    normalized
  );
};

// ============================================================
// SEMANTIC ACKNOWLEDGMENT DETECTION
// ============================================================
//
// These are messages such as:
//
// "I drank the water"
// "I have drunk the water"
// "I finished the CN video"
// "I completed my assignment"
// "I already did it"
// "I made the time table"
//
// These MUST NOT automatically acknowledge a reminder unless
// there is a pending reminder that the message can refer to.
//
// ============================================================

const looksLikeCompletionStatement = (message) => {
  if (!message) {
    return false;
  }

  const text = message
    .trim()
    .toLowerCase();

  const patterns = [
    /\bi\s+(did|finished|completed|made|done|handled|fixed)\b/,
    /\bi\s+have\s+(done|finished|completed|made|fixed)\b/,
    /\bi\s+(already|just)\s+(did|finished|completed|made)\b/,
    /\bi\s+have\s+(already|just)\b/,
    /\b(i|we)\s+(drank|ate|called|sent|wrote|watched|studied|completed|finished)\b/,
    /\b(it|task|work)\s+is\s+(done|completed|finished)\b/,
    /\b(done|completed|finished)\s+(with|the)\b/,
    /\b(task|work)\s+done\b/,
    /\b.+\s+ho\s+gaya\b/,
    /\b.+\s+kar\s+diya\b/,
    /\b.+\s+kar\s+liya\b/,
  ];

  return patterns.some(
    (pattern) => pattern.test(text)
  );
};

// ============================================================
// REMINDER DETECTION
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
    /\bset a reminder\b/,
    /\bset reminder\b/,
  ];

  return reminderPatterns.some(
    (pattern) => pattern.test(text)
  );
};

// ============================================================
// EXTRACT JSON CANDIDATE
// ============================================================

const extractJsonCandidate = (content) => {
  if (
    !content ||
    typeof content !== "string"
  ) {
    return null;
  }

  let cleaned = content.trim();

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

const parseAIJson = (content) => {
  if (
    !content ||
    typeof content !== "string"
  ) {
    return null;
  }

  const raw =
    content.trim();

  const lower =
    raw.toLowerCase();

  if (
    lower.includes("user safety") ||
    lower === "safe" ||
    lower.includes("safety: safe")
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

  // ----------------------------------------------------------
  // NORMAL JSON
  // ----------------------------------------------------------

  try {
    return JSON.parse(candidate);
  } catch (error) {
    console.warn(
      "⚠️ JSON.parse failed. Trying jsonrepair..."
    );
  }

  // ----------------------------------------------------------
  // JSON REPAIR
  // ----------------------------------------------------------

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

  if (
    isAcknowledgmentMessage(message)
  ) {
    return {
      intent: "acknowledge_reminder",
      confidence: 1,
      task: null,
      timeText: null,
      recurring: false,
    };
  }

  if (
    looksLikeCompletionStatement(message)
  ) {
    return {
      intent: "acknowledge_reminder",
      confidence: 0.85,
      task: null,
      timeText: null,
      recurring: false,
    };
  }

  const normalizedMessage = message
    .trim()
    .toLowerCase()
    .replace(/[!?.,]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const calendarConnectPatterns = [
    /\bconnect\s+(my\s+)?(google\s+)?calendar(\s+account)?\b/,
    /\blink\s+(my\s+)?(google\s+)?calendar(\s+account)?\b/,
    /\bsync\s+(my\s+)?google\s+calendar\b/,
    /\bi want to connect (my\s+)?(google\s+)?calendar\b/,
  ];

  const calendarQueryPattern =
    /\b(calendar|schedule|events?|meetings?)\b|\bwhat do i have\b/;

  if (
    calendarConnectPatterns.some((pattern) =>
      pattern.test(normalizedMessage)
    )
  ) {
    return {
      intent: "connect_google_calendar",
      confidence: 1,
      task: null,
      timeText: null,
      recurring: false,
    };
  }

  if (
    calendarQueryPattern.test(normalizedMessage)
  ) {
    const referenceDate = new Date();
    let date = "today";

    if (/\btomorrow\b/.test(normalizedMessage)) {
      date = "tomorrow";
    } else if (
      !/\btoday\b/.test(normalizedMessage)
    ) {
      const parsedDate = chrono.parseDate(
        message,
        referenceDate,
        {
          forwardDate: true,
        }
      );

      if (parsedDate) {
        date = parsedDate.toISOString().slice(0, 10);
      }
    }

    return {
      intent: "CALENDAR_QUERY",
      confidence: 1,
      task: null,
      timeText: null,
      recurring: false,
      date,
      range: "day",
    };
  }

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

  return {
    intent: "conversation",
    confidence: 0.7,
    task: null,
    timeText: null,
    recurring: false,
  };
};

// ============================================================
// FORMAT PENDING REMINDERS FOR AI
// ============================================================

const formatPendingReminders = (
  pendingReminders = []
) => {
  if (
    !Array.isArray(pendingReminders) ||
    pendingReminders.length === 0
  ) {
    return "No pending reminders.";
  }

  return pendingReminders
    .map((reminder, index) => {
      const task =
        reminder.task ||
        "Unknown task";

      const scheduledFor =
        reminder.scheduledFor
          ? new Date(
              reminder.scheduledFor
            ).toISOString()
          : "Unknown time";

      return `${index + 1}. Task: "${task}" | Scheduled: ${scheduledFor}`;
    })
    .join("\n");
};

// ============================================================
// AI ROUTER
// ============================================================

const parseReminder = async (
  message,
  context = {}
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

    const pendingReminders =
      Array.isArray(
        context.pendingReminders
      )
        ? context.pendingReminders
        : [];

    // ========================================================
    // VERY IMPORTANT:
    //
    // Exact acknowledgments are only acknowledgments if there
    // is actually a pending reminder.
    //
    // This prevents:
    //
    // "How are you?"
    // "Okay"
    //
    // from accidentally completing something.
    // ========================================================

    if (
      isAcknowledgmentMessage(message) &&
      pendingReminders.length > 0
    ) {
      const latest =
        pendingReminders[0];

      return {
        intent:
          "acknowledge_reminder",

        confidence:
          1,

        task:
          latest?.task || null,

        timeText:
          null,

        recurring:
          false,
      };
    }

    // ========================================================
    // SEMANTIC COMPLETION
    //
    // Only use this when pending reminders exist.
    // ========================================================

    if (
      looksLikeCompletionStatement(message) &&
      pendingReminders.length > 0
    ) {
      // Do NOT immediately choose a reminder.
      // Let AI semantically match the message.
      console.log(
        "🧠 Possible semantic completion detected."
      );
    }

    // ========================================================
    // ROUTER PROMPT
    // ========================================================

    const pendingReminderContext =
      formatPendingReminders(
        pendingReminders
      );

    const systemPrompt = `
You are the central AI router for a personal WhatsApp assistant.

Your job is ONLY to classify the user's message and extract
structured information.

You are NOT a safety classifier.

NEVER return:
"User Safety: safe"

NEVER return plain text.

NEVER return markdown.

NEVER return explanations.

Return ONLY ONE valid JSON object.

============================================================
ALLOWED INTENTS
============================================================

create_reminder
acknowledge_reminder
conversation
connect_google_calendar
CALENDAR_QUERY
cancel_reminder
reschedule_reminder
unknown

============================================================
OUTPUT FORMAT
============================================================

{
  "intent": "conversation",
  "confidence": 0.95,
  "task": null,
  "timeText": null,
  "recurring": false
}

============================================================
CREATE REMINDER
============================================================

Examples:

"remind me to drink water at 11"
"remind me to call Rahul tomorrow at 6 PM"
"remind me to study React every day at 8 PM"

Return:

{
  "intent": "create_reminder",
  "confidence": 0.99,
  "task": "drink water",
  "timeText": "at 11",
  "recurring": false
}

============================================================
CONNECT GOOGLE CALENDAR
============================================================

Recognize requests to connect, link, or sync the user's Google
Calendar account. Examples:

"connect my google calendar"
"connect google calendar"
"connect my calendar"
"link my google calendar"
"link my calendar"
"sync my google calendar"
"I want to connect my calendar"
"connect calendar"
"connect my Google Calendar account"

Return ONLY:

{
  "intent": "connect_google_calendar",
  "confidence": 1,
  "task": null,
  "timeText": null,
  "recurring": false
}

============================================================
CALENDAR QUERY
============================================================

Classify requests asking what is on the user's calendar,
schedule, meetings, or events as CALENDAR_QUERY. Extract the
requested day as today, tomorrow, or an ISO date (YYYY-MM-DD).
Use range "day".

Examples:

"what is on my calendar today"
"show my calendar tomorrow"
"what do I have on Friday"
"show my calendar for 28 August"

Return ONLY:

{
  "intent": "CALENDAR_QUERY",
  "confidence": 0.98,
  "date": "today",
  "range": "day",
  "task": null,
  "timeText": null,
  "recurring": false
}

============================================================
ACKNOWLEDGE REMINDER
============================================================

The user may acknowledge a reminder naturally.

Examples:

"done"
"okay"
"ok"
"yes"
"completed"
"finished"
"I did it"
"I have done it"
"I finished the CN video"
"I completed the assignment"
"I drank the water"
"I have drunk the water"
"I already did the work"
"I made the time table"
"water is done"
"haan ho gaya"
"kar diya"
"kar liya"
"👍"
"👌"
"✅"
"✔️"

IMPORTANT:

You MUST use the PENDING REMINDERS list below to determine
which reminder the user completed.

Example:

Pending reminder:
"drink water"

User:
"I have drunk the water"

Return:

{
  "intent": "acknowledge_reminder",
  "confidence": 0.99,
  "task": "drink water",
  "timeText": null,
  "recurring": false
}

Another example:

Pending reminder:
"complete CN video"

User:
"I finished the CN video"

Return:

{
  "intent": "acknowledge_reminder",
  "confidence": 0.99,
  "task": "complete CN video",
  "timeText": null,
  "recurring": false
}

Another example:

Pending reminders:
"drink water"
"make time table"

User:
"I made the time table"

Return:

{
  "intent": "acknowledge_reminder",
  "confidence": 0.99,
  "task": "make time table",
  "timeText": null,
  "recurring": false
}

============================================================
IMPORTANT ACKNOWLEDGMENT RULE
============================================================

If the user says only:

"okay"
"ok"
"yes"
"👍"
"👌"
"done"

and pending reminders exist, select the most recently sent
or most relevant pending reminder.

If no pending reminders exist, classify these messages as:

{
  "intent": "conversation"
}

DO NOT complete a reminder when there is no pending reminder.

============================================================
CONVERSATION
============================================================

Normal conversation includes:

"how are you?"
"tell me a joke"
"I am bored"
"I am excited"
"what do you think?"
"thanks"
"haha"
"good morning"

Return:

{
  "intent": "conversation",
  "confidence": 0.95,
  "task": null,
  "timeText": null,
  "recurring": false
}

============================================================
CANCEL REMINDER
============================================================

Examples:

"cancel my water reminder"
"remove the time table reminder"
"don't remind me about water"
"cancel the 8 PM reminder"

Return:

{
  "intent": "cancel_reminder",
  "confidence": 0.95,
  "task": "water",
  "timeText": null,
  "recurring": false
}

============================================================
RESCHEDULE
============================================================

Examples:

"move water reminder to 12 PM"
"change the reminder to 5 PM"
"reschedule my walk to tomorrow at 7"

Return:

{
  "intent": "reschedule_reminder",
  "confidence": 0.95,
  "task": "water",
  "timeText": "12 PM",
  "recurring": false
}

============================================================
PENDING REMINDERS
============================================================

${pendingReminderContext}

============================================================
CURRENT USER MESSAGE
============================================================

${message.trim()}

============================================================

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
        });
    } catch (firstError) {
      console.error(
        "❌ OpenRouter first attempt failed:",
        firstError.response?.data ||
          firstError.message
      );

      // Retry without response format.
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
      "🤖 AI raw response:",
      content
    );

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
        "⚠️ AI router returned invalid object."
      );
    }

    // ========================================================
    // LOCAL FALLBACK
    // ========================================================

    console.warn(
      "⚠️ Using local router fallback."
    );

    const fallback =
      localFallbackRouter(
        message
      );

    // If semantic completion was detected and reminders exist,
    // use a second small AI call specifically for task matching.
    if (
      pendingReminders.length > 0 &&
      (
        fallback.intent ===
          "acknowledge_reminder" ||
        looksLikeCompletionStatement(
          message
        )
      )
    ) {
      try {
        const matchingResponse =
          await client.chat.completions.create({
            model: MODEL,

            temperature: 0,

            messages: [
              {
                role: "system",

                content: `
You match a user's completion statement to one pending reminder.

Return ONLY JSON:

{
  "intent": "acknowledge_reminder",
  "confidence": 0.99,
  "task": "matching task",
  "timeText": null,
  "recurring": false
}

If there is no clear match:

{
  "intent": "conversation",
  "confidence": 0.5,
  "task": null,
  "timeText": null,
  "recurring": false
}

Pending reminders:

${pendingReminderContext}
`,
              },

              {
                role: "user",
                content:
                  message.trim(),
              },
            ],
          });

        const matchingContent =
          matchingResponse
            ?.choices?.[0]
            ?.message?.content;

        const matchingParsed =
          parseAIJson(
            matchingContent
          );

        const matchingNormalized =
          normalizeRouterResult(
            matchingParsed
          );

        if (
          matchingNormalized
        ) {
          console.log(
            "🎯 Matched acknowledgment:",
            matchingNormalized
          );

          return matchingNormalized;
        }
      } catch (matchError) {
        console.error(
          "❌ Reminder matching failed:",
          matchError.message
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
// CONVERSATION AI
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
to make responses personalized and natural.

IMPORTANT:

- Do not mention the internal memory database.
- Do not reveal internal memory structures.
- Do not invent facts.
- Only use information provided in memory/context.
- If something is uncertain, do not pretend you know it.
- Do not force conversations into reminders.
- Do not sound robotic.
- Be warm and natural.
- Keep WhatsApp responses reasonably concise.

You can:

- chat casually
- answer questions
- help plan the day
- understand emotions
- help with productivity
- remember preferences
- understand references such as "it", "that", "them"
- suggest useful actions when appropriate

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

    let memoryContext =
      "No stored memory available.";

    if (phoneNumber) {
      try {
        memoryContext =
          await buildMemoryContext(
            phoneNumber
          );
      } catch (memoryError) {
        console.error(
          "⚠️ Memory context load failed:",
          memoryError.message
        );
      }
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

Allowed types:

fact
preference
routine

Return ONLY JSON.

Example:

{
  "shouldRemember": true,
  "isUpdate": false,
  "type": "preference",
  "key": "favorite_color",
  "value": "green"
}

If nothing should be remembered:

{
  "shouldRemember": false,
  "isUpdate": false,
  "type": null,
  "key": null,
  "value": null
}

Existing memory:

${memoryContext}

User message:

${message}
`;

    const response =
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
// BACKWARD COMPATIBILITY
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

  isAcknowledgmentMessage,
  looksLikeCompletionStatement,
  looksLikeReminder,

  normalizeRouterResult,
  parseAIJson,
};