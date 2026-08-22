const OpenAI = require("openai");

const client = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: "https://openrouter.ai/api/v1",
});

const parseReminder = async (message) => {
  try {
    const response = await client.chat.completions.create({
      model: process.env.OPENROUTER_MODEL || "openrouter/free",

      messages: [
        {
          role: "system",
          content: `
You are the AI reminder parser for Reminder PA.

Your ONLY job is to understand the user's message and determine whether
they want to create a reminder.

Return ONLY valid JSON.

For a reminder request, return:

{
  "intent": "create_reminder",
  "task": "the task the user wants to be reminded about",
  "timeText": "the exact time/date expression used by the user",
  "recurring": false
}

For a recurring reminder, return:

{
  "intent": "create_reminder",
  "task": "the task",
  "timeText": "the recurring time/frequency expression",
  "recurring": true
}

If the message is not a reminder request, return:

{
  "intent": "unknown",
  "task": null,
  "timeText": null,
  "recurring": false
}

Examples:

User:
Remind me to call Rahul at 6 PM

Output:
{
  "intent": "create_reminder",
  "task": "Call Rahul",
  "timeText": "6 PM",
  "recurring": false
}

User:
Remind me to submit my assignment tomorrow at 10 AM

Output:
{
  "intent": "create_reminder",
  "task": "Submit my assignment",
  "timeText": "tomorrow at 10 AM",
  "recurring": false
}

User:
Remind me to drink water every 2 hours

Output:
{
  "intent": "create_reminder",
  "task": "Drink water",
  "timeText": "every 2 hours",
  "recurring": true
}

User:
Hello bot

Output:
{
  "intent": "unknown",
  "task": null,
  "timeText": null,
  "recurring": false
}
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

    return JSON.parse(content);
  } catch (error) {
    console.error(
      "OpenRouter error:",
      error.response?.data || error.message
    );

    throw error;
  }
};

module.exports = {
  parseReminder,
};