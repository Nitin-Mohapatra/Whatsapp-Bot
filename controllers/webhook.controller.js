const Message = require("../models/message.model");
const {
  sendWhatsAppMessage,
} = require("../services/whatsapp.service");


// GET /api/whatsapp/webhook
// Meta uses this to verify our webhook
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


// POST /api/whatsapp/webhook
// Meta sends incoming WhatsApp messages here
const receiveWebhook = async (req, res) => {
  try {
    console.log(
      "Incoming WhatsApp webhook:",
      JSON.stringify(req.body, null, 2)
    );

    const body = req.body;

    // Make sure this is a WhatsApp event
    if (body.object !== "whatsapp_business_account") {
      return res.sendStatus(404);
    }

    const entry = body.entry?.[0];

    const change = entry?.changes?.[0];

    const value = change?.value;

    const message = value?.messages?.[0];

    // Sometimes Meta sends status updates instead of messages
    if (!message) {
      console.log("No incoming message found");
      return res.sendStatus(200);
    }

    const from = message.from;
    const messageId = message.id;
    const messageType = message.type;

    let text = "";

    if (messageType === "text") {
      text = message.text?.body || "";
    }

    console.log("From:", from);
    console.log("Message:", text);

    // Prevent duplicate webhook processing
    const existingMessage = await Message.findOne({
      whatsappMessageId: messageId,
    });

    if (existingMessage) {
      console.log("Message already processed");

      return res.sendStatus(200);
    }

    // Save incoming message
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

    // Temporary reply
    await sendWhatsAppMessage(
      from,
      `I received your message: "${text}"\n\nReminder PA backend is working 🚀`
    );

    return res.sendStatus(200);

  } catch (error) {
    console.error(
      "Webhook processing error:",
      error.response?.data || error.message
    );

    // Important: still acknowledge Meta
    return res.sendStatus(200);
  }
};


module.exports = {
  verifyWebhook,
  receiveWebhook,
};