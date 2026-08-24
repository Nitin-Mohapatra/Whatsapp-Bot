const Message = require("../models/message.model");

const {
  sendWhatsAppMessage,
} = require("../services/whatsapp.service");

const {
  processReminderMessage,
} = require("../services/reminder.pipeline.service");

const {
  acknowledgeLatestReminder,
} = require("../services/reminder.acknowledgement.service");

const {
  analyzeMessage,
  generateConversationResponse,
} = require("../services/ai.service");


// ========================================
// GET /api/whatsapp/webhook
// Meta uses this to verify our webhook
// ========================================

const verifyWebhook = (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  console.log("Webhook verification request received");

  if (
    mode === "subscribe" &&
    token === process.env.WHATSAPP_VERIFY_TOKEN
  ) {
    console.log("Webhook verified successfully");

    return res.status(200).send(challenge);
  }

  console.log("Webhook verification failed");

  return res.sendStatus(403);
};


// ========================================
// POST /api/whatsapp/webhook
// Meta sends incoming WhatsApp messages here
// ========================================

const receiveWebhook = async (req, res) => {
  try {

    console.log(
      "Incoming WhatsApp webhook:",
      JSON.stringify(req.body, null, 2)
    );

    const body = req.body;


    // ========================================
    // MAKE SURE THIS IS A WHATSAPP EVENT
    // ========================================

    if (body.object !== "whatsapp_business_account") {
      return res.sendStatus(404);
    }


    // ========================================
    // EXTRACT MESSAGE
    // ========================================

    const entry = body.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;
    const message = value?.messages?.[0];


    // Meta can also send status updates
    // instead of actual messages.

    if (!message) {
      console.log("No incoming message found");

      return res.sendStatus(200);
    }


    // ========================================
    // MESSAGE INFORMATION
    // ========================================

    const from = message.from;
    const messageId = message.id;
    const messageType = message.type;

    let text = "";


    // ========================================
    // TEXT MESSAGE
    // ========================================

    if (messageType === "text") {
      text = message.text?.body || "";
    }


    console.log("From:", from);
    console.log("Message type:", messageType);
    console.log("Message:", text);


    // ========================================
    // CURRENT PROTOTYPE SUPPORTS TEXT
    // ========================================

    if (!text.trim()) {

      console.log(
        `Message type "${messageType}" does not contain text yet`
      );

      await sendWhatsAppMessage(
        from,
        "I can currently understand text messages. Voice-message support is coming soon 🎙️"
      );

      return res.sendStatus(200);
    }


    // ========================================
    // PREVENT DUPLICATE PROCESSING
    // ========================================

    const existingMessage = await Message.findOne({
      whatsappMessageId: messageId,
    });


    if (existingMessage) {

      console.log(
        "Message already processed:",
        messageId
      );

      return res.sendStatus(200);
    }


    // ========================================
    // SAVE INCOMING MESSAGE
    // ========================================

    await Message.create({
      whatsappMessageId: messageId,
      from,
      messageType,
      text,

      timestamp: message.timestamp
        ? new Date(Number(message.timestamp) * 1000)
        : new Date(),

      rawPayload: body,
    });


    console.log(
      "✅ Incoming message saved"
    );


    // ========================================
    // AI ROUTER
    // ========================================
    //
    // EVERY MESSAGE GOES TO THE AI FIRST.
    //
    // The AI decides:
    //
    // create_reminder
    // acknowledge_reminder
    // conversation
    // unknown
    //
    // ========================================

    const aiResult = await analyzeMessage(text);


    console.log(
      "🧠 AI Router Result:",
      aiResult
    );


    // ========================================
    // SAFETY CHECK
    // ========================================

    if (
      !aiResult ||
      !aiResult.intent
    ) {

      console.error(
        "❌ AI returned invalid result:",
        aiResult
      );

      await sendWhatsAppMessage(
        from,
        "Sorry, I couldn't understand that. Could you try again?"
      );

      return res.sendStatus(200);
    }


    // ========================================
    // ROUTE USER INTENT
    // ========================================

    switch (aiResult.intent) {


      // ======================================
      // CREATE REMINDER
      // ======================================

      case "create_reminder": {

        console.log(
          "📅 Intent: CREATE_REMINDER"
        );


        const result =
          await processReminderMessage({
            phoneNumber: from,
            message: text,
          });


        console.log(
          "Reminder pipeline result:",
          result
        );


        // --------------------------------------
        // AI said reminder, but pipeline failed
        // --------------------------------------

        if (
          !result ||
          !result.isReminder ||
          !result.reminder
        ) {

          console.log(
            "⚠️ Reminder intent detected but reminder could not be created"
          );


          await sendWhatsAppMessage(
            from,
            "I understood that you want a reminder, but I couldn't figure out when to remind you. Could you tell me the time or date?"
          );


          return res.sendStatus(200);
        }


        const reminder = result.reminder;


        // --------------------------------------
        // SUCCESS
        // --------------------------------------

        const reply =
          `✅ Reminder created!\n\n` +
          `📝 Task: ${reminder.task}\n` +
          `⏰ Type: ${reminder.reminderType}\n\n` +
          `I'll remind you at the scheduled time.`;


        await sendWhatsAppMessage(
          from,
          reply
        );


        return res.sendStatus(200);
      }


      // ======================================
      // ACKNOWLEDGE REMINDER
      // ======================================

      case "acknowledge_reminder": {

        console.log(
          "✅ Intent: ACKNOWLEDGE_REMINDER"
        );


        const acknowledgmentResult =
          await acknowledgeLatestReminder(from);


        // --------------------------------------
        // Reminder found
        // --------------------------------------

        if (
          acknowledgmentResult &&
          acknowledgmentResult.acknowledged
        ) {

          console.log(
            "✅ Reminder acknowledged:",
            acknowledgmentResult.reminder.task
          );


          await sendWhatsAppMessage(
            from,
            `✅ Got it! "${acknowledgmentResult.reminder.task}" has been marked as completed.`
          );

        }

        // --------------------------------------
        // No pending reminder
        // --------------------------------------

        else {

          console.log(
            "ℹ️ No pending reminder found to acknowledge"
          );


          await sendWhatsAppMessage(
            from,
            "👍 Got it!"
          );
        }


        return res.sendStatus(200);
      }


      // ======================================
      // NORMAL CONVERSATION
      // ======================================

      case "conversation": {

        console.log(
          "💬 Intent: CONVERSATION"
        );


      const reply =
  await generateConversationResponse({
    message: text,
    phoneNumber: from,
  });


        console.log(
          "🤖 AI conversation response:",
          reply
        );


        await sendWhatsAppMessage(
          from,
          reply
        );


        return res.sendStatus(200);
      }


      // ======================================
      // UNKNOWN
      // ======================================

      case "unknown":

        console.log(
          "❓ Intent: UNKNOWN"
        );


        await sendWhatsAppMessage(
          from,
          "I'm not completely sure what you mean. You can ask me to create a reminder, or we can just chat 😊"
        );


        return res.sendStatus(200);


      // ======================================
      // FALLBACK
      // ======================================

      default:

        console.log(
          "⚠️ Unsupported AI intent:",
          aiResult.intent
        );


        await sendWhatsAppMessage(
          from,
          "I'm not sure how to handle that yet, but I'm learning 😊"
        );


        return res.sendStatus(200);
    }


  } catch (error) {

    console.error(
      "❌ Webhook processing error:",
      error.response?.data ||
      error.message
    );


    // ========================================
    // IMPORTANT
    // Always acknowledge Meta's webhook
    // ========================================

    return res.sendStatus(200);
  }
};


module.exports = {
  verifyWebhook,
  receiveWebhook,
};