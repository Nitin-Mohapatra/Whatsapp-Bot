const OpenAI = require("openai");
const { jsonrepair } = require("jsonrepair");


// ============================================================
// OPENROUTER CLIENT
// ============================================================

const client = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: "https://openrouter.ai/api/v1",
});


// ============================================================
// MODEL
// ============================================================

const MODEL =
  process.env.OPENROUTER_MODEL ||
  "openrouter/free";


// ============================================================
// CLEAN AI RESPONSE
// ============================================================

const cleanAIResponse = (content) => {
  if (!content) {
    throw new Error("AI returned an empty response");
  }

  let cleaned = String(content).trim();

  console.log("AI raw response:", cleaned);


  // ----------------------------------------------------------
  // Remove markdown code fences
  // ----------------------------------------------------------

  cleaned = cleaned
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();


  // ----------------------------------------------------------
  // If there is text before/after JSON,
  // extract the JSON object.
  // ----------------------------------------------------------

  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");


  if (
    firstBrace !== -1 &&
    lastBrace !== -1 &&
    lastBrace > firstBrace
  ) {
    cleaned = cleaned.substring(
      firstBrace,
      lastBrace + 1
    );
  }


  console.log(
    "AI cleaned response:",
    cleaned
  );


  return cleaned;
};


// ============================================================
// PARSE JSON SAFELY
// ============================================================

const parseAIJson = (content) => {

  const cleaned = cleanAIResponse(content);


  // ----------------------------------------------------------
  // FIRST ATTEMPT
  // ----------------------------------------------------------

  try {

    return JSON.parse(cleaned);

  } catch (firstError) {

    console.log(
      "⚠️ Normal JSON.parse failed. Trying jsonrepair..."
    );


    // --------------------------------------------------------
    // SECOND ATTEMPT — JSON REPAIR
    // --------------------------------------------------------

    try {

      const repaired =
        jsonrepair(cleaned);

      console.log(
        "AI repaired JSON:",
        repaired
      );


      return JSON.parse(repaired);

    } catch (repairError) {

      console.error(
        "❌ AI JSON parsing failed"
      );

      console.error(
        "Raw response:",
        content
      );

      console.error(
        "Cleaned response:",
        cleaned
      );

      throw new Error(
        `AI returned invalid JSON: ${firstError.message}`
      );
    }
  }
};


// ============================================================
// VALIDATE ROUTER RESPONSE
// ============================================================

const validateRouterResult = (result) => {

  if (!result || typeof result !== "object") {
    throw new Error(
      "AI router returned an invalid object"
    );
  }


  const allowedIntents = [
    "create_reminder",
    "acknowledge_reminder",
    "conversation",
    "unknown",
  ];


  if (
    !allowedIntents.includes(result.intent)
  ) {

    throw new Error(
      `Invalid AI intent: ${result.intent}`
    );
  }


  return result;
};


// ============================================================
// VALIDATE REMINDER RESPONSE
// ============================================================

const validateReminderResult = (result) => {

  if (!result || typeof result !== "object") {
    throw new Error(
      "AI reminder parser returned an invalid object"
    );
  }


  // ----------------------------------------------------------
  // Unknown
  // ----------------------------------------------------------

  if (result.intent === "unknown") {

    return {
      intent: "unknown",
      task: null,
      timeText: null,
      recurring: false,
    };
  }


  // ----------------------------------------------------------
  // Must be create_reminder
  // ----------------------------------------------------------

  if (
    result.intent !== "create_reminder"
  ) {

    throw new Error(
      `Invalid reminder intent: ${result.intent}`
    );
  }


  // ----------------------------------------------------------
  // Task required
  // ----------------------------------------------------------

  if (
    typeof result.task !== "string" ||
    !result.task.trim()
  ) {

    throw new Error(
      "Reminder task is missing"
    );
  }


  // ----------------------------------------------------------
  // Time required
  // ----------------------------------------------------------

  if (
    typeof result.timeText !== "string" ||
    !result.timeText.trim()
  ) {

    throw new Error(
      "Reminder timeText is missing"
    );
  }


  return {
    intent: "create_reminder",

    task: result.task.trim(),

    timeText: result.timeText.trim(),

    recurring:
      Boolean(result.recurring),
  };
};


// ============================================================
// STRUCTURED AI REQUEST
// ============================================================

const callStructuredAI = async ({
  systemPrompt,
  message,
  retry = true,
}) => {

  try {

    // --------------------------------------------------------
    // IMPORTANT:
    //
    // response_format asks OpenRouter/model to return JSON.
    // --------------------------------------------------------

    const response =
      await client.chat.completions.create({

        model: MODEL,

        messages: [

          {
            role: "system",
            content: systemPrompt,
          },

          {
            role: "user",
            content: message,
          },

        ],

        // ----------------------------------------------------
        // Ask model for JSON
        // ----------------------------------------------------

        response_format: {
          type: "json_schema",
          json_schema: {
            name: "assistant_router",
            strict: true,
            schema: {
              type: "object",
              properties: {
                intent: {
                  type: "string",
                  enum: [
                    "create_reminder",
                    "acknowledge_reminder",
                    "conversation",
                    "unknown"
                  ]
                },
                confidence: {
                  type: "number"
                },
                task: {
                  type: ["string", "null"]
                },
                timeText: {
                  type: ["string", "null"]
                },
                recurring: {
                  type: "boolean"
                }
              },
              required: [
                "intent",
                "confidence",
                "task",
                "timeText",
                "recurring"
              ],
              additionalProperties: false
            }
          }
        },

        // Keep router responses small
        max_tokens: 500,
      });


    const content =
      response?.choices?.[0]?.message?.content;


    if (!content) {

      throw new Error(
        "OpenRouter returned no content"
      );
    }


    return parseAIJson(content);

  } catch (error) {

    console.error(
      "OpenRouter structured request error:",
      error.response?.data ||
      error.message
    );


    // --------------------------------------------------------
    // RETRY ONCE
    // --------------------------------------------------------

    if (retry) {

      console.log(
        "🔄 Retrying AI request..."
      );


      const retryPrompt = `
IMPORTANT:

Return ONLY a valid JSON object.

Do not return Markdown.
Do not use code fences.
Do not return explanations.
Do not return safety messages.
Do not return plain text.

The output MUST start with { and end with }.

${systemPrompt}
`;


      return await callStructuredAI({
        systemPrompt: retryPrompt,
        message,
        retry: false,
      });
    }


    throw error;
  }
};


// ============================================================
// AI ROUTER
// ============================================================
//
// EVERY USER MESSAGE SHOULD GO THROUGH THIS ROUTER.
//
// ============================================================

const analyzeMessage = async (message) => {

  const systemPrompt = `

You are the main AI router for a personal WhatsApp AI assistant.

You are NOT just a reminder bot.

You are responsible for understanding what the user wants.

Possible intents:

1. create_reminder
2. acknowledge_reminder
3. conversation
4. unknown


============================================================
CREATE REMINDER
============================================================

Use create_reminder when the user explicitly asks to be reminded.

Example:

"Remind me to call Mom tomorrow at 8 PM"

Return:

{
  "intent": "create_reminder",
  "confidence": 1,
  "task": "call Mom",
  "timeText": "tomorrow at 8 PM",
  "recurring": false
}


Example:

"Remind me to drink water every 2 hours"

Return:

{
  "intent": "create_reminder",
  "confidence": 1,
  "task": "drink water",
  "timeText": "every 2 hours",
  "recurring": true
}


IMPORTANT:

Do NOT classify a normal statement as a reminder.

For example:

"I have a meeting tomorrow at 8 AM"

is NOT automatically a reminder.

It should be:

{
  "intent": "conversation",
  "confidence": 0.9
}


But:

"Remind me about my meeting tomorrow at 8 AM"

is:

{
  "intent": "create_reminder",
  "confidence": 1,
  "task": "meeting",
  "timeText": "tomorrow at 8 AM",
  "recurring": false
}


============================================================
ACKNOWLEDGE REMINDER
============================================================

Use acknowledge_reminder when the user indicates that a task
has been completed.

Examples:

"done"

"finished"

"completed"

"yes done"

"did it"

"done 👍"

"👍"

"✅"

"👌"


Return:

{
  "intent": "acknowledge_reminder",
  "confidence": 1
}


IMPORTANT:

Emoji can carry meaning.

👍 = completed

✅ = completed

👌 = completed


============================================================
CONVERSATION
============================================================

Use conversation for normal conversation.

Examples:

"Hey, how are you?"

"I got a project worth 1 crore"

"I am excited"

"I am scared"

"What should I do today?"

"Help me plan my day"

"Tell me something interesting"

"How was your day?"


Return:

{
  "intent": "conversation",
  "confidence": 0.95
}


============================================================
UNKNOWN
============================================================

Only use unknown if the message cannot reasonably be
classified.

Return:

{
  "intent": "unknown",
  "confidence": 0.5
}


============================================================
STRICT OUTPUT
============================================================

Return ONLY JSON.

Never return:

User Safety: safe

Never return:

User Safety: unsafe

Never return Markdown.

Never return:

\`\`\`json

Never return explanations.

Never return text before or after the JSON.

`;


  const result =
    await callStructuredAI({
      systemPrompt,
      message,
    });


  const validated =
    validateRouterResult(result);


  console.log(
    "🧠 AI Router Result:",
    validated
  );


  return validated;
};


// ============================================================
// REMINDER PARSER
// ============================================================
//
// This is used by reminder.pipeline.service.js.
//
// It extracts:
//
// task
// timeText
// recurring
//
// ============================================================

const parseReminder = async (message) => {

  const systemPrompt = `

You are the reminder extraction AI for a personal assistant.

Your job is to determine whether the user wants to create
a reminder.

Return ONLY a JSON object.


============================================================
CREATE REMINDER
============================================================

Example:

User:

Remind me to call Rahul at 6 PM

Return:

{
  "intent": "create_reminder",
  "task": "call Rahul",
  "timeText": "6 PM",
  "recurring": false
}


Example:

User:

Remind me to submit my assignment tomorrow at 10 AM

Return:

{
  "intent": "create_reminder",
  "task": "submit my assignment",
  "timeText": "tomorrow at 10 AM",
  "recurring": false
}


Example:

User:

Remind me to drink water every 2 hours

Return:

{
  "intent": "create_reminder",
  "task": "drink water",
  "timeText": "every 2 hours",
  "recurring": true
}


Example:

User:

Remind me to write down rashmi aunty and vedic mom tomorrow at 8am

Return:

{
  "intent": "create_reminder",
  "task": "write down rashmi aunty and vedic mom",
  "timeText": "tomorrow at 8am",
  "recurring": false
}


============================================================
NOT A REMINDER
============================================================

If the user does not want a reminder:

{
  "intent": "unknown",
  "task": null,
  "timeText": null,
  "recurring": false
}


============================================================
IMPORTANT
============================================================

Never return:

User Safety: safe

Never return:

User Safety: unsafe

Never return Markdown.

Never return code fences.

Never return explanations.

Return ONLY JSON.

`;


  let result;


  try {

    result =
      await callStructuredAI({
        systemPrompt,
        message,
      });

  } catch (error) {

    console.error(
      "❌ Reminder AI failed:",
      error.message
    );


    // --------------------------------------------------------
    // IMPORTANT:
    //
    // Returning unknown prevents the entire WhatsApp webhook
    // from crashing if the AI provider gives an unusable
    // response.
    // --------------------------------------------------------

    return {
      intent: "unknown",
      task: null,
      timeText: null,
      recurring: false,
    };
  }


  const validated =
    validateReminderResult(result);


  console.log(
    "📝 Reminder AI result:",
    validated
  );


  return validated;
};


// ============================================================
// NORMAL CONVERSATION RESPONSE
// ============================================================
//
// This function DOES NOT return JSON.
// It returns normal natural-language text.
//
// ============================================================

const generateConversationResponse = async ({
  message,
}) => {

  try {

    const response =
      await client.chat.completions.create({

        model: MODEL,

        messages: [

          {
            role: "system",

            content: `

You are a friendly personal AI assistant inside WhatsApp.

You are a personal assistant and friend, not just a reminder bot.

Your job is to have natural conversations with the user.

Be:

- friendly
- natural
- concise
- supportive
- helpful
- conversational

If the user shares good news, celebrate with them.

If the user is worried, be supportive.

If the user is excited, respond with excitement.

If the user asks a question, answer it.

If the user asks for help planning their day, help them.

If the user talks casually, respond naturally.

Use emojis naturally when appropriate.

Do not sound robotic.

Do not repeatedly say "I am an AI".

Keep WhatsApp responses reasonably short.

IMPORTANT:

Do not create reminders from this function.

Reminder creation is handled separately by the reminder system.

`,

          },

          {
            role: "user",
            content: message,
          },

        ],

        max_tokens: 500,
      });


    const content =
      response?.choices?.[0]?.message?.content;


    if (!content) {

      throw new Error(
        "AI returned an empty conversation response"
      );
    }


    return content.trim();

  } catch (error) {

    console.error(
      "OpenRouter conversation error:",
      error.response?.data ||
      error.message
    );


    return "I'm here 😊 Tell me what's on your mind.";
  }
};


// ============================================================
// EXPORTS
// ============================================================

module.exports = {

  analyzeMessage,

  parseReminder,

  generateConversationResponse,

};