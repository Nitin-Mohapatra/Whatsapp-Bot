const OpenAI = require("openai");

const client = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: "https://openrouter.ai/api/v1",
});


// ============================================================
// HELPER — CLEAN AI JSON RESPONSE
// ============================================================

const parseAIJson = (content) => {
  if (!content) {
    throw new Error("AI returned an empty response");
  }

  let cleaned = content.trim();

  console.log("AI raw response:", content);

  // ----------------------------------------------------------
  // Remove Markdown code fences
  //
  // Example:
  //
  // ```json
  // {
  //   "intent": "conversation"
  // }
  // ```
  //
  // becomes:
  //
  // {
  //   "intent": "conversation"
  // }
  // ----------------------------------------------------------

  cleaned = cleaned
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();


  // ----------------------------------------------------------
  // Sometimes the model may return extra text before/after JSON.
  //
  // Try to extract the first JSON object.
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


  console.log("AI cleaned response:", cleaned);


  try {
    return JSON.parse(cleaned);
  } catch (error) {

    console.error(
      "❌ AI JSON parsing failed"
    );

    console.error(
      "Raw AI response:",
      content
    );

    console.error(
      "Cleaned AI response:",
      cleaned
    );

    throw new Error(
      `AI returned invalid JSON: ${error.message}`
    );
  }
};


// ============================================================
// OPENROUTER REQUEST
// ============================================================

const callAI = async (systemPrompt, message) => {

  try {

    const response =
      await client.chat.completions.create({

        model:
          process.env.OPENROUTER_MODEL ||
          "openrouter/free",

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
      "OpenRouter error:",
      error.response?.data ||
      error.message
    );

    throw error;
  }
};


// ============================================================
// AI ROUTER
// ============================================================
//
// EVERY USER MESSAGE COMES HERE FIRST.
//
// Possible intents:
//
// create_reminder
// acknowledge_reminder
// conversation
// unknown
//
// ============================================================

const analyzeMessage = async (message) => {

  const systemPrompt = `
You are the main AI router for a personal WhatsApp AI assistant.

Your job is to understand the user's message and decide what the
assistant should do.

The assistant is a personal assistant, not only a reminder bot.

The user may:

1. Create a reminder
2. Complete/acknowledge a reminder
3. Have a normal conversation
4. Ask questions
5. Share information
6. Express emotions
7. Use emojis
8. Ask the assistant to help plan their day
9. Ask for suggestions
10. Say something casually

IMPORTANT:

Return ONLY valid JSON.

DO NOT use Markdown.

DO NOT use:
\`\`\`
\`\`\`json

DO NOT add explanations before or after the JSON.

--------------------------------------------------
INTENT: create_reminder
--------------------------------------------------

Use this when the user wants the assistant to remind them about
something at a particular time/date/frequency.

Example:

"Remind me to call Mom tomorrow at 8 PM"

Return:

{
  "intent": "create_reminder",
  "confidence": 1.0,
  "task": "call Mom",
  "timeText": "tomorrow at 8 PM",
  "recurring": false
}

Another example:

"Remind me to drink water every 2 hours"

Return:

{
  "intent": "create_reminder",
  "confidence": 1.0,
  "task": "drink water",
  "timeText": "every 2 hours",
  "recurring": true
}

--------------------------------------------------
INTENT: acknowledge_reminder
--------------------------------------------------

Use this when the user is indicating that a reminder/task has
been completed.

This includes:

"done"
"finished"
"completed"
"yes done"
"👍"
"✅"
"👌"
"yes"
"okay done"
"did it"
"completed it"

Important:

Emoji can communicate intent.

For example:

👍 = task completed
✅ = task completed
Done = task completed

Return:

{
  "intent": "acknowledge_reminder",
  "confidence": 1.0
}

--------------------------------------------------
INTENT: conversation
--------------------------------------------------

Use this for normal conversation.

Examples:

"Hey, how are you?"

"Today I got a project worth 1 crore"

"I am feeling excited"

"I am scared about tomorrow"

"What should I do today?"

"Tell me something interesting"

"Can you help me plan my day?"

Return:

{
  "intent": "conversation",
  "confidence": 0.95
}

--------------------------------------------------
INTENT: unknown
--------------------------------------------------

Use this only when the message cannot reasonably be classified.

Return:

{
  "intent": "unknown",
  "confidence": 0.5
}

--------------------------------------------------
IMPORTANT
--------------------------------------------------

Do NOT classify every message as a reminder.

A reminder requires an actual intention to be reminded about
something.

For example:

"I have a meeting tomorrow at 8 AM"

is conversation/information unless the user asks to be reminded.

But:

"Remind me about my meeting tomorrow at 8 AM"

is create_reminder.

Return ONLY JSON.
`;


  return await callAI(
    systemPrompt,
    message
  );
};


// ============================================================
// REMINDER PARSER
// ============================================================
//
// Used by reminder.pipeline.service.js
//
// It extracts the actual reminder information.
//
// ============================================================

const parseReminder = async (message) => {

  const systemPrompt = `
You are the reminder extraction AI for a personal assistant.

Determine whether the user wants to create a reminder.

Return ONLY valid JSON.

DO NOT use Markdown.
DO NOT use \`\`\`json.
DO NOT add explanations.

--------------------------------------------------
REMINDER
--------------------------------------------------

If the user wants a reminder:

{
  "intent": "create_reminder",
  "task": "the task",
  "timeText": "the exact date/time/frequency expression",
  "recurring": false
}

--------------------------------------------------
RECURRING REMINDER
--------------------------------------------------

For recurring reminders:

{
  "intent": "create_reminder",
  "task": "the task",
  "timeText": "the recurring expression",
  "recurring": true
}

--------------------------------------------------
NOT A REMINDER
--------------------------------------------------

If the user does not want a reminder:

{
  "intent": "unknown",
  "task": null,
  "timeText": null,
  "recurring": false
}

--------------------------------------------------
EXAMPLES
--------------------------------------------------

User:

Remind me to call Rahul at 6 PM

Return:

{
  "intent": "create_reminder",
  "task": "call Rahul",
  "timeText": "6 PM",
  "recurring": false
}


User:

Remind me to write down Rashmi aunty and Vedic mom tomorrow at 8am

Return:

{
  "intent": "create_reminder",
  "task": "write down Rashmi aunty and Vedic mom",
  "timeText": "tomorrow at 8am",
  "recurring": false
}


User:

Remind me to drink water every 2 hours

Return:

{
  "intent": "create_reminder",
  "task": "drink water",
  "timeText": "every 2 hours",
  "recurring": true
}


User:

Hey how are you?

Return:

{
  "intent": "unknown",
  "task": null,
  "timeText": null,
  "recurring": false
}

Return ONLY JSON.
`;


  return await callAI(
    systemPrompt,
    message
  );
};


// ============================================================
// NORMAL CONVERSATION RESPONSE
// ============================================================
//
// Used when the user is NOT asking for a reminder.
//
// ============================================================

const generateConversationResponse = async ({
  message,
}) => {

  try {

    const response =
      await client.chat.completions.create({

        model:
          process.env.OPENROUTER_MODEL ||
          "openrouter/free",

        messages: [

          {
            role: "system",

            content: `
You are a friendly personal AI assistant living inside WhatsApp.

You are NOT only a reminder bot.

Your personality should feel like a helpful personal assistant
and friend.

Be:

- friendly
- natural
- concise
- supportive
- conversational
- useful

Do not sound robotic.

Do not unnecessarily mention that you are an AI.

If the user shares something exciting, respond naturally.

If the user shares something stressful, be supportive.

If the user asks a question, answer it.

If the user asks for help planning something, help them.

If the user talks casually, have a normal conversation.

Keep WhatsApp responses reasonably short unless the user asks
for detailed information.

IMPORTANT:

Do NOT create reminders from this function.

Reminder creation is handled separately by the reminder system.
            `,
          },

          {
            role: "user",
            content: message,
          },

        ],

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

    throw error;
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