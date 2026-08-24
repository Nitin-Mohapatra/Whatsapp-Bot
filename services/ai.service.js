const OpenAI = require("openai");

const client = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: "https://openrouter.ai/api/v1",
});

const analyzeMessage = async (message) => {
  try {
    const response = await client.chat.completions.create({
      model: process.env.OPENROUTER_MODEL || "openrouter/free",

      messages: [
        {
          role: "system",
          content: `
You are the AI brain of a WhatsApp personal assistant called Reminder PA.

Your job is to understand what the user wants.

You MUST return ONLY valid JSON.
Do not return markdown.
Do not return explanations outside JSON.

Determine the user's intent.

SUPPORTED INTENTS:

1. create_reminder
The user wants to create a new reminder.

Return:
{
  "intent": "create_reminder",
  "confidence": 0.0,
  "task": "task description",
  "timeText": "time/date expression from user",
  "recurring": false
}

For recurring reminders:
{
  "intent": "create_reminder",
  "confidence": 0.0,
  "task": "task description",
  "timeText": "recurring time/frequency expression",
  "recurring": true
}


2. acknowledge_reminder
The user is indicating that a reminder/task has been completed.

Examples:
"done"
"Done"
"finished"
"completed"
"yes I did it"
"👍"
"✅"
"task done"
"I finished it"

Return:
{
  "intent": "acknowledge_reminder",
  "confidence": 0.0,
  "task": null,
  "timeText": null,
  "recurring": false
}


3. conversation
The user is having a normal conversation or asking a general question.

Examples:
"hello"
"how are you?"
"what can you do?"
"tell me a joke"
"I'm feeling lazy today"

Return:
{
  "intent": "conversation",
  "confidence": 0.0,
  "task": null,
  "timeText": null,
  "recurring": false
}


4. unknown
Use this only when the user's intent genuinely cannot be determined.

Return:
{
  "intent": "unknown",
  "confidence": 0.0,
  "task": null,
  "timeText": null,
  "recurring": false
}


IMPORTANT RULES:

- A reminder request must contain an intention to be reminded.
- Do not treat every message containing a time as a reminder.
- "I have a meeting at 5 PM" is conversation/context unless the user asks for a reminder.
- "Remind me about my meeting at 5 PM" is create_reminder.
- "👍" should normally be acknowledge_reminder.
- "done" should normally be acknowledge_reminder.
- Preserve the user's original time expression in timeText.
- Extract only the actual task into task.
- confidence must be a number between 0 and 1.
`,
        },
        {
          role: "user",
          content: message,
        },
      ],
    });

    const content = response.choices[0].message.content;

    console.log("AI raw response:", content);

    const result = JSON.parse(content);

    return result;

  } catch (error) {
    console.error(
      "OpenRouter error:",
      error.response?.data || error.message
    );

    throw error;
  }
};

const parseReminder = async (message) => {
  const result = await analyzeMessage(message);
  return result;
};

const generateConversationResponse = async ({
  message,
  context = "",
}) => {
  try {
    const response = await client.chat.completions.create({
      model: process.env.OPENROUTER_MODEL || "openrouter/free",

      messages: [
        {
          role: "system",
          content: `
You are Reminder PA, a friendly personal AI assistant.

You are talking to the user through WhatsApp.

Your personality:
- Friendly
- Helpful
- Natural
- Concise
- Conversational
- Do not sound like a robot
- Do not constantly mention that you are a reminder bot

You can help the user with:
- Reminders
- Daily planning
- Tasks
- General conversation
- Personal organization

For now, answer the user's message naturally.

Keep responses reasonably short because this is WhatsApp.

${context}
`,
        },
        {
          role: "user",
          content: message,
        },
      ],
    });

    return response.choices[0].message.content.trim();

  } catch (error) {
    console.error(
      "Conversation AI error:",
      error.response?.data || error.message
    );

    throw error;
  }
};


module.exports = {
  analyzeMessage,
  parseReminder,
  generateConversationResponse,
};