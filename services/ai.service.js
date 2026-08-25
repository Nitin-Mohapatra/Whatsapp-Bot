// src/services/ai.service.js

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

const OPENROUTER_MODEL =
  process.env.OPENROUTER_MODEL ||
  "openai/gpt-4o-mini";

const TIMEZONE =
  process.env.USER_TIMEZONE ||
  "Asia/Kolkata";

/*
|--------------------------------------------------------------------------
| Basic validation
|--------------------------------------------------------------------------
*/

if (!OPENROUTER_API_KEY) {
  console.warn("⚠️ OPENROUTER_API_KEY is not configured");
}

/*
|--------------------------------------------------------------------------
| Current date/time context
|--------------------------------------------------------------------------
*/

function getCurrentDateTimeContext() {
  const now = new Date();

  const formatter = new Intl.DateTimeFormat("en-IN", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  });

  const parts = formatter.formatToParts(now);

  const values = {};

  for (const part of parts) {
    if (part.type !== "literal") {
      values[part.type] = part.value;
    }
  }

  const date =
    `${values.year}-${values.month}-${values.day}`;

  const time =
    `${values.hour}:${values.minute}:${values.second}`;

  return {
    date,
    time,
    timezone: TIMEZONE,
    iso: now.toISOString()
  };
}

/*
|--------------------------------------------------------------------------
| Clean AI output
|--------------------------------------------------------------------------
*/

function cleanAIResponse(text) {
  if (!text || typeof text !== "string") {
    return "";
  }

  let cleaned = text.trim();

  /*
   * Remove markdown code fences.
   *
   * ```json
   * {...}
   * ```
   */
  cleaned = cleaned.replace(/^```json\s*/i, "");
  cleaned = cleaned.replace(/^```\s*/i, "");
  cleaned = cleaned.replace(/\s*```$/i, "");

  cleaned = cleaned.trim();

  /*
   * Sometimes models return text before/after JSON.
   *
   * Example:
   *
   * Here is the result:
   * {...}
   */
  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");

  if (firstBrace !== -1 && lastBrace !== -1) {
    cleaned = cleaned.substring(
      firstBrace,
      lastBrace + 1
    );
  }

  return cleaned.trim();
}

/*
|--------------------------------------------------------------------------
| Safely parse JSON
|--------------------------------------------------------------------------
*/

function parseAIJSON(text) {
  const cleaned = cleanAIResponse(text);

  if (!cleaned) {
    return null;
  }

  try {
    return JSON.parse(cleaned);
  } catch (error) {
    console.warn(
      "⚠️ Normal JSON.parse failed:",
      error.message
    );
  }

  /*
   * Attempt to repair common JSON issues.
   */

  try {
    let repaired = cleaned;

    repaired = repaired
      .replace(/[\u0000-\u001F]+/g, " ")
      .replace(/,\s*}/g, "}")
      .replace(/,\s*]/g, "]");

    return JSON.parse(repaired);
  } catch (error) {
    console.error(
      "❌ Could not parse AI JSON:",
      error.message
    );

    return null;
  }
}

/*
|--------------------------------------------------------------------------
| Validate reminder object
|--------------------------------------------------------------------------
*/

function normalizeReminderResult(result) {
  if (!result || typeof result !== "object") {
    return null;
  }

  const normalized = {
    intent: result.intent || "conversation",

    confidence:
      typeof result.confidence === "number"
        ? result.confidence
        : 0,

    task:
      typeof result.task === "string"
        ? result.task.trim()
        : null,

    date:
      typeof result.date === "string"
        ? result.date.trim()
        : null,

    time:
      typeof result.time === "string"
        ? result.time.trim()
        : null,

    scheduledFor:
      typeof result.scheduledFor === "string"
        ? result.scheduledFor.trim()
        : null,

    recurring:
      Boolean(result.recurring),

    recurrence:
      result.recurrence || null,

    response:
      typeof result.response === "string"
        ? result.response.trim()
        : null
  };

  return normalized;
}

/*
|--------------------------------------------------------------------------
| System prompt
|--------------------------------------------------------------------------
*/

function buildSystemPrompt(context = {}) {
  const current = getCurrentDateTimeContext();

  const conversationHistory =
    Array.isArray(context.history)
      ? context.history
      : [];

  return `
You are the AI brain of a personal WhatsApp assistant.

Your job is NOT only to create reminders.

You are a personal assistant who can:

- have normal conversations
- understand emotions and casual messages
- remember user preferences when provided
- understand emojis
- understand voice-to-text messages
- create reminders
- reschedule reminders
- cancel reminders
- complete reminders
- understand recurring tasks
- understand natural language dates and times
- answer questions
- help the user plan their day

IMPORTANT:

You must return ONLY valid JSON.

Never return:
- markdown
- code fences
- explanations outside JSON
- "User Safety: safe"
- "Here is the JSON"
- plain text outside the JSON object

--------------------------------------------------
CURRENT TIME CONTEXT
--------------------------------------------------

Current date:
${current.date}

Current time:
${current.time}

Timezone:
${current.timezone}

Current UTC time:
${current.iso}

--------------------------------------------------
USER CONTEXT
--------------------------------------------------

${context.userContext || "No additional user context available."}

--------------------------------------------------
RECENT CONVERSATION
--------------------------------------------------

${conversationHistory.length
    ? JSON.stringify(conversationHistory.slice(-15))
    : "No previous conversation available."
}

--------------------------------------------------
INTENT TYPES
--------------------------------------------------

You must choose exactly one:

conversation
create_reminder
reschedule_reminder
cancel_reminder
complete_reminder
list_reminders
unknown

--------------------------------------------------
CREATE REMINDER
--------------------------------------------------

Examples:

"remind me to drink water at 10 49"

"remind me to drink water at 10:49"

"remind me to drink water at 10.49"

"remind me to call mom tomorrow at 8"

"remind me to study after 2 hours"

"remind me every day at 7 to walk"

For all of these, extract the actual task and schedule.

IMPORTANT:

Human time formats must be understood.

These all mean the same thing:

10 49
10:49
10.49
10-49

Therefore:

"remind me to drink water at 10 49"

must produce:

time = "10:49"

--------------------------------------------------
TIME RULES
--------------------------------------------------

If the user says:

"at 10 49"

interpret it as:

10:49

If AM/PM is not specified:

Use normal contextual interpretation.

If the requested time is later today,
schedule today.

If the requested time has already passed today,
schedule tomorrow unless the user explicitly says today.

Examples:

Current time: 10:47 AM

User:
"remind me to drink water at 10 49"

Result:
today at 10:49 AM

Current time: 11:00 AM

User:
"remind me to drink water at 10 49"

Result:
tomorrow at 10:49 AM

If user says:

"tomorrow at 10 49"

it MUST be tomorrow.

If user says:

"today at 10 49"

it MUST be today.

--------------------------------------------------
RELATIVE TIME
--------------------------------------------------

Understand:

after 5 minutes
after 2 hours
in 10 minutes
in 3 hours
after half an hour

Convert these into an exact scheduledFor datetime.

--------------------------------------------------
RECURRING REMINDERS
--------------------------------------------------

Examples:

"remind me every day at 7 to walk"

"remind me every Monday at 9 to call mom"

"remind me every morning to drink water"

Set:

recurring = true

and provide:

recurrence

--------------------------------------------------
NORMAL CONVERSATION
--------------------------------------------------

If the user is simply chatting:

"how are you?"

"tell me a joke"

"I am bored"

"what do you think about this?"

Do NOT create a reminder.

Return:

intent = conversation

and put the natural reply in:

response

--------------------------------------------------
COMPLETION
--------------------------------------------------

The user may use:

done
ok
okay
👍
👍🏻
👍🏽
👍🏿
✅
✔️
completed
finished
yes done
haan
ho gaya
kar diya

These can indicate completion ONLY when there is an active reminder/task context.

Do NOT mark a random reminder as completed merely because the user said:

"okay"

during normal conversation.

If there is no clear active reminder context, use:

intent = conversation

--------------------------------------------------
EMOJI UNDERSTANDING
--------------------------------------------------

Understand common emoji meanings.

Examples:

👍
👍🏻
👍🏽
👍🏿
✅
✔️

can indicate completion when responding to an active reminder.

❌
🚫

can indicate rejection/cancellation when clearly referring to an active reminder.

❤️
😊
😂
😢
😡

are normally conversational/emotional and should NOT automatically trigger reminder actions.

--------------------------------------------------
RESCHEDULE
--------------------------------------------------

Examples:

"change my water reminder to 11"

"reschedule the water reminder to 1:40"

"make that reminder tomorrow at 8"

Return:

intent = reschedule_reminder

and extract the new date/time.

--------------------------------------------------
CANCEL
--------------------------------------------------

Examples:

"cancel my water reminder"

"remove the timetable reminder"

"don't remind me about that"

Return:

intent = cancel_reminder

--------------------------------------------------
OUTPUT FORMAT
--------------------------------------------------

Return exactly this structure:

{
  "intent": "create_reminder",
  "confidence": 0.98,
  "task": "drink water",
  "date": "2026-08-25",
  "time": "10:49",
  "scheduledFor": "2026-08-25T10:49:00+05:30",
  "recurring": false,
  "recurrence": null,
  "response": null
}

For conversation:

{
  "intent": "conversation",
  "confidence": 0.98,
  "task": null,
  "date": null,
  "time": null,
  "scheduledFor": null,
  "recurring": false,
  "recurrence": null,
  "response": "Of course 😊 What are you thinking about?"
}

Never omit required fields.

--------------------------------------------------
FINAL RULE
--------------------------------------------------

Your response must be pure JSON.

NO markdown.
NO code fences.
NO additional text.
`;
}

/*
|--------------------------------------------------------------------------
| Call OpenRouter
|--------------------------------------------------------------------------
*/

async function callAI(message, context = {}) {
  if (!OPENROUTER_API_KEY) {
    throw new Error(
      "OPENROUTER_API_KEY is missing"
    );
  }

  const systemPrompt =
    buildSystemPrompt(context);

  const payload = {
    model: OPENROUTER_MODEL,

    messages: [
      {
        role: "system",
        content: systemPrompt
      },
      {
        role: "user",
        content: message
      }
    ],

    temperature: 0.1,

    /*
     * Ask OpenRouter/model for JSON.
     *
     * Some models support this parameter.
     */
    response_format: {
      type: "json_object"
    }
  };

  const response = await fetch(
    OPENROUTER_URL,
    {
      method: "POST",

      headers: {
        "Authorization":
          `Bearer ${OPENROUTER_API_KEY}`,

        "Content-Type":
          "application/json",

        "HTTP-Referer":
          process.env.APP_URL ||
          "https://whatsapp-pa.onrender.com",

        "X-Title":
          "WhatsApp Personal Assistant"
      },

      body: JSON.stringify(payload)
    }
  );

  const responseText =
    await response.text();

  if (!response.ok) {
    console.error(
      "❌ OpenRouter HTTP error:",
      response.status,
      responseText
    );

    throw new Error(
      `OpenRouter request failed: ${response.status}`
    );
  }

  let data;

  try {
    data = JSON.parse(responseText);
  } catch (error) {
    console.error(
      "❌ OpenRouter returned invalid HTTP JSON:",
      responseText
    );

    throw new Error(
      "Invalid OpenRouter response"
    );
  }

  const content =
    data?.choices?.[0]?.message?.content;

  if (!content) {
    console.error(
      "❌ OpenRouter response missing content:",
      JSON.stringify(data, null, 2)
    );

    throw new Error(
      "AI response content missing"
    );
  }

  console.log(
    "🤖 AI raw response:",
    content
  );

  return content;
}

/*
|--------------------------------------------------------------------------
| Analyze user message
|--------------------------------------------------------------------------
*/

async function analyzeMessage(
  message,
  context = {}
) {
  if (!message || typeof message !== "string") {
    throw new Error(
      "Message is required"
    );
  }

  console.log(
    "🧠 AI analyzing:",
    message
  );

  let rawResponse;

  try {
    rawResponse =
      await callAI(
        message,
        context
      );
  } catch (error) {
    console.error(
      "❌ AI call failed:",
      error.message
    );

    throw error;
  }

  const parsed =
    parseAIJSON(rawResponse);

  if (!parsed) {
    console.error(
      "❌ AI returned invalid JSON"
    );

    /*
     * Return a safe conversation response
     * rather than accidentally creating a reminder.
     */
    return {
      intent: "conversation",
      confidence: 0,
      task: null,
      date: null,
      time: null,
      scheduledFor: null,
      recurring: false,
      recurrence: null,
      response:
        "Sorry, I couldn't understand that properly. Could you say it another way?"
    };
  }

  const result =
    normalizeReminderResult(parsed);

  if (!result) {
    return {
      intent: "conversation",
      confidence: 0,
      task: null,
      date: null,
      time: null,
      scheduledFor: null,
      recurring: false,
      recurrence: null,
      response:
        "I'm here 😊 Tell me what you'd like me to help with."
    };
  }

  console.log(
    "🧠 AI Router Result:",
    result
  );

  return result;
}

/*
|--------------------------------------------------------------------------
| Validate scheduled time
|--------------------------------------------------------------------------
*/

function validateScheduledTime(result) {
  if (!result) {
    return false;
  }

  if (
    result.intent !== "create_reminder" &&
    result.intent !== "reschedule_reminder"
  ) {
    return true;
  }

  if (!result.task) {
    console.warn(
      "⚠️ Reminder has no task"
    );

    return false;
  }

  if (!result.scheduledFor) {
    console.warn(
      "⚠️ Reminder has no scheduledFor"
    );

    return false;
  }

  const date =
    new Date(result.scheduledFor);

  if (Number.isNaN(date.getTime())) {
    console.warn(
      "⚠️ Invalid scheduledFor:",
      result.scheduledFor
    );

    return false;
  }

  return true;
}

/*
|--------------------------------------------------------------------------
| Main helper used by controllers
|--------------------------------------------------------------------------
*/

async function processMessage(
  message,
  context = {}
) {
  const result =
    await analyzeMessage(
      message,
      context
    );

  /*
   * Never create a reminder if the
   * AI did not provide enough information.
   */
  if (
    result.intent === "create_reminder" &&
    !validateScheduledTime(result)
  ) {
    console.warn(
      "⚠️ AI identified reminder but scheduling data is incomplete."
    );

    return {
      ...result,
      intent: "conversation",
      response:
        "I understood that you want a reminder, but I couldn't determine the exact time. Could you tell me when you'd like me to remind you?"
    };
  }

  return result;
}

/*
|--------------------------------------------------------------------------
| Exports
|--------------------------------------------------------------------------
*/

module.exports = {
  analyzeMessage,
  processMessage,
  callAI,
  parseAIJSON,
  cleanAIResponse,
  normalizeReminderResult,
  validateScheduledTime,
  getCurrentDateTimeContext
};