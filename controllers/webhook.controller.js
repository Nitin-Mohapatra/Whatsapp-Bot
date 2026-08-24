const axios = require("axios");
const FormData = require("form-data");

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
  extractMemory,
} = require("../services/ai.service");

const {
  addRecentContext,
  saveExtractedMemory,
  updateMemory,
  getRecentContext,
  buildMemoryContext,
} = require("../services/memory.service");


// ======================================================
// SARVAM SPEECH TO TEXT
// ======================================================

const transcribeAudioWithSarvam = async ({
  audioBuffer,
  mimeType,
  fileName,
}) => {

  try {

    console.log("🎙️ Sending audio to Sarvam STT...");

    if (!process.env.SARVAM_API_KEY) {
      throw new Error(
        "SARVAM_API_KEY is not configured"
      );
    }

    const formData = new FormData();

    formData.append(
      "file",
      audioBuffer,
      {
        filename:
          fileName || "whatsapp-audio.ogg",

        contentType:
          mimeType || "audio/ogg",
      }
    );

    formData.append(
      "model",
      process.env.SARVAM_STT_MODEL ||
      "saaras:v3"
    );

    formData.append(
      "language_code",
      process.env.SARVAM_LANGUAGE_CODE ||
      "unknown"
    );

    formData.append(
      "mode",
      process.env.SARVAM_STT_MODE ||
      "transcribe"
    );

    const response =
      await axios.post(
        "https://api.sarvam.ai/speech-to-text",
        formData,
        {
          headers: {
            ...formData.getHeaders(),

            "api-subscription-key":
              process.env.SARVAM_API_KEY,
          },

          maxBodyLength:
            Infinity,

          maxContentLength:
            Infinity,

          timeout:
            60000,
        }
      );

    console.log(
      "🎙️ Sarvam STT response:",
      response.data
    );

    const transcript =
      response.data?.transcript?.trim();

    if (!transcript) {
      throw new Error(
        "Sarvam returned an empty transcript"
      );
    }

    console.log(
      "📝 Voice transcript:",
      transcript
    );

    console.log(
      "🌐 Detected language:",
      response.data?.language_code
    );

    return {
      transcript,

      languageCode:
        response.data?.language_code ||
        null,

      requestId:
        response.data?.request_id ||
        null,
    };

  } catch (error) {

    console.error(
      "❌ Sarvam STT error:",
      error.response?.data ||
      error.message
    );

    throw new Error(
      "Failed to transcribe WhatsApp voice message"
    );
  }
};


// ======================================================
// DOWNLOAD WHATSAPP MEDIA
// ======================================================

const downloadWhatsAppMedia = async (
  mediaId
) => {

  try {

    console.log(
      "🎧 Getting WhatsApp media URL:",
      mediaId
    );

    if (!process.env.WHATSAPP_ACCESS_TOKEN) {
      throw new Error(
        "WHATSAPP_ACCESS_TOKEN is not configured"
      );
    }

    const mediaResponse =
      await axios.get(
        `https://graph.facebook.com/v23.0/${mediaId}`,
        {
          headers: {
            Authorization:
              `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
          },

          timeout:
            30000,
        }
      );

    const mediaUrl =
      mediaResponse.data?.url;

    const mimeType =
      mediaResponse.data?.mime_type ||
      "audio/ogg";

    if (!mediaUrl) {
      throw new Error(
        "WhatsApp did not return a media URL"
      );
    }

    console.log(
      "🔗 WhatsApp media URL received"
    );

    console.log(
      "🎵 MIME type:",
      mimeType
    );

    const audioResponse =
      await axios.get(
        mediaUrl,
        {
          headers: {
            Authorization:
              `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
          },

          responseType:
            "arraybuffer",

          timeout:
            30000,
        }
      );

    const audioBuffer =
      Buffer.from(
        audioResponse.data
      );

    console.log(
      "✅ WhatsApp audio downloaded:",
      audioBuffer.length,
      "bytes"
    );

    return {
      audioBuffer,

      mimeType,

      fileName:
        `whatsapp-${mediaId}.ogg`,
    };

  } catch (error) {

    console.error(
      "❌ WhatsApp media download failed:",
      error.response?.data ||
      error.message
    );

    throw new Error(
      "Failed to download WhatsApp voice message"
    );
  }
};


// ========================================
// GET /api/whatsapp/webhook
// ========================================

const verifyWebhook = (
  req,
  res
) => {

  const mode =
    req.query["hub.mode"];

  const token =
    req.query["hub.verify_token"];

  const challenge =
    req.query["hub.challenge"];

  console.log(
    "Webhook verification request received"
  );

  if (
    mode === "subscribe" &&
    token ===
    process.env.WHATSAPP_VERIFY_TOKEN
  ) {

    console.log(
      "Webhook verified successfully"
    );

    return res
      .status(200)
      .send(challenge);
  }

  console.log(
    "Webhook verification failed"
  );

  return res.sendStatus(403);
};


// ========================================
// POST /api/whatsapp/webhook
// ========================================

const receiveWebhook =
  async (
    req,
    res
  ) => {

    try {

      console.log(
        "Incoming WhatsApp webhook:",
        JSON.stringify(
          req.body,
          null,
          2
        )
      );

      const body =
        req.body;

      // ========================================
      // MAKE SURE THIS IS WHATSAPP EVENT
      // ========================================

      if (
        body.object !==
        "whatsapp_business_account"
      ) {

        return res.sendStatus(
          404
        );
      }

      // ========================================
      // EXTRACT MESSAGE
      // ========================================

      const entry =
        body.entry?.[0];

      const change =
        entry?.changes?.[0];

      const value =
        change?.value;

      const message =
        value?.messages?.[0];

      // Status updates etc.
      if (!message) {

        console.log(
          "No incoming message found"
        );

        return res.sendStatus(
          200
        );
      }

      // ========================================
      // MESSAGE INFORMATION
      // ========================================

      const from =
        message.from;

      const messageId =
        message.id;

      const messageType =
        message.type;

      // ========================================
      // DUPLICATE CHECK
      // ========================================

      const existingMessage =
        await Message.findOne({
          whatsappMessageId:
            messageId,
        });

      if (
        existingMessage
      ) {

        console.log(
          "Message already processed:",
          messageId
        );

        return res.sendStatus(
          200
        );
      }

      // ========================================
      // MESSAGE TEXT
      // ========================================

      let text = "";

      let voiceLanguage = null;

      let voiceRequestId = null;

      // ========================================
      // TEXT
      // ========================================

      if (
        messageType === "text"
      ) {

        text =
          message.text?.body ||
          "";
      }

      // ========================================
      // AUDIO / VOICE
      // ========================================

      else if (
        messageType === "audio"
      ) {

        console.log(
          "🎙️ WhatsApp voice message received"
        );

        const mediaId =
          message.audio?.id;

        if (!mediaId) {

          console.error(
            "❌ Voice message does not contain media ID"
          );

          await sendWhatsAppMessage(
            from,
            "Sorry, I couldn't access that voice message. Please try sending it again."
          );

          return res.sendStatus(
            200
          );
        }

        const {
          audioBuffer,
          mimeType,
          fileName,
        } =
          await downloadWhatsAppMedia(
            mediaId
          );

        const transcription =
          await transcribeAudioWithSarvam({
            audioBuffer,
            mimeType,
            fileName,
          });

        text =
          transcription.transcript;

        voiceLanguage =
          transcription.languageCode;

        voiceRequestId =
          transcription.requestId;

        console.log(
          "🗣️ Transcribed voice:",
          text
        );

        if (
          !text ||
          !text.trim()
        ) {

          await sendWhatsAppMessage(
            from,
            "I couldn't understand the voice message. Could you please say that again? 🎙️"
          );

          return res.sendStatus(
            200
          );
        }

        console.log(
          "🎙️ Voice successfully converted to text"
        );
      }

      // ========================================
      // OTHER MESSAGE TYPES
      // ========================================

      else {

        console.log(
          `Message type "${messageType}" is not supported yet`
        );

        await sendWhatsAppMessage(
          from,
          "I can currently understand text and voice messages. 😊"
        );

        return res.sendStatus(
          200
        );
      }

      console.log(
        "From:",
        from
      );

      console.log(
        "Message type:",
        messageType
      );

      console.log(
        "Message:",
        text
      );

      // ========================================
      // FINAL TEXT SAFETY CHECK
      // ========================================

      if (
        !text.trim()
      ) {

        console.log(
          "No usable text after processing"
        );

        await sendWhatsAppMessage(
          from,
          "I couldn't understand that message. Could you try again? 😊"
        );

        return res.sendStatus(
          200
        );
      }

      // ========================================
      // SAVE INCOMING MESSAGE
      // ========================================

      await Message.create({

        whatsappMessageId:
          messageId,

        from,

        messageType,

        text,

        timestamp:
          message.timestamp
            ? new Date(
              Number(
                message.timestamp
              ) * 1000
            )
            : new Date(),

        rawPayload:
          body,
      });

      console.log(
        "✅ Incoming message saved"
      );

      // ========================================
      // SAVE SHORT-TERM MEMORY
      // ========================================

      try {

        await addRecentContext({

          phoneNumber:
            from,

          role:
            "user",

          content:
            text,

        });

      } catch (
      memoryError
      ) {

        console.error(
          "⚠️ Failed to save recent user context:",
          memoryError.message
        );
      }

      // ========================================
      // AI ROUTER
      // ========================================

      const aiResult =
        await analyzeMessage(
          text
        );

      console.log(
        "🧠 AI Router Result:",
        JSON.stringify(
          aiResult,
          null,
          2
        )
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

        return res.sendStatus(
          200
        );
      }

      // ========================================
      // ROUTE INTENT
      // ========================================

      switch (
        aiResult.intent
      ) {

        // ======================================
        // CREATE REMINDER
        // ======================================

        case "create_reminder": {

          console.log(
            "📅 Intent: CREATE_REMINDER"
          );

          // --------------------------------------
          // GET REMINDER ARRAY
          // --------------------------------------

          const reminders =
            Array.isArray(
              aiResult.reminders
            )
              ? aiResult.reminders
              : [];

          // --------------------------------------
          // BACKWARD COMPATIBILITY
          // --------------------------------------

          let normalizedReminders =
            reminders;

          if (
            normalizedReminders.length === 0 &&
            aiResult.task &&
            aiResult.timeText
          ) {

            normalizedReminders = [
              {
                task:
                  aiResult.task,

                timeText:
                  aiResult.timeText,

                recurring:
                  Boolean(
                    aiResult.recurring
                  ),
              },
            ];
          }

          console.log(
            `📋 Reminders detected: ${normalizedReminders.length}`
          );

          // --------------------------------------
          // NO REMINDER DATA
          // --------------------------------------

          if (
            normalizedReminders.length === 0
          ) {

            console.log(
              "⚠️ Reminder intent detected but no reminders were extracted"
            );

            await sendWhatsAppMessage(
              from,

              "I understood that you want reminders, but I couldn't figure out the task and time. Could you tell me what I should remind you about and when?"
            );

            return res.sendStatus(
              200
            );
          }

          // --------------------------------------
          // CREATE EACH REMINDER
          // --------------------------------------

          const createdReminders = [];

          const failedReminders = [];

          for (
            let i = 0;
            i < normalizedReminders.length;
            i++
          ) {

            const reminderData =
              normalizedReminders[i];

            console.log(
              `⏰ Creating reminder ${i + 1}/${normalizedReminders.length}:`,
              reminderData
            );

            try {

              /*
              IMPORTANT:

              The existing reminder pipeline accepts
              one reminder message at a time.

              So we convert each AI reminder into a
              normal reminder sentence and pass it
              through the existing pipeline.
              */

              const reminderMessage =
                `Remind me to ${reminderData.task} ${reminderData.timeText}`;

              console.log(
                "📨 Reminder pipeline input:",
                reminderMessage
              );

              const result =
                await processReminderMessage({

                  phoneNumber:
                    from,

                  message:
                    reminderMessage,

                });

              console.log(
                "Reminder pipeline result:",
                result
              );

              if (
                result &&
                result.isReminder &&
                result.reminder
              ) {

                createdReminders.push(
                  result.reminder
                );

                console.log(
                  "✅ Reminder created:",
                  result.reminder.task
                );

              } else {

                failedReminders.push(
                  reminderData
                );

                console.log(
                  "❌ Reminder could not be created:",
                  reminderData
                );
              }

            } catch (reminderError) {

              console.error(
                "❌ Reminder creation failed:",
                reminderError.message
              );

              failedReminders.push(
                reminderData
              );
            }
          }

          // --------------------------------------
          // NO REMINDERS CREATED
          // --------------------------------------

          if (
            createdReminders.length === 0
          ) {

            await sendWhatsAppMessage(
              from,

              "I understood the reminders, but I couldn't create them. Please try again."
            );

            return res.sendStatus(
              200
            );
          }

          // --------------------------------------
          // BUILD RESPONSE
          // --------------------------------------

          let reply =
            `✅ ${createdReminders.length === 1
              ? "Reminder created!"
              : `${createdReminders.length} reminders created!`
            }\n\n`;

          createdReminders.forEach(
            (
              reminder,
              index
            ) => {

              reply +=
                `📝 ${index + 1}. ${reminder.task}\n`;

              reply +=
                `⏰ ${reminder.reminderType}\n\n`;
            }
          );

          // --------------------------------------
          // PARTIAL FAILURE
          // --------------------------------------

          if (
            failedReminders.length > 0
          ) {

            reply +=
              `⚠️ I couldn't create ${failedReminders.length} reminder${failedReminders.length > 1 ? "s" : ""}.\n`;

            failedReminders.forEach(
              (
                reminder,
                index
              ) => {

                reply +=
                  `• ${reminder.task} — ${reminder.timeText}\n`;
              }
            );
          } else {

            reply +=
              "I'll remind you at the scheduled times. 😊";
          }

          // --------------------------------------
          // SEND RESPONSE
          // --------------------------------------

          await sendWhatsAppMessage(
            from,
            reply
          );

          return res.sendStatus(
            200
          );
        }

        // ======================================
        // ACKNOWLEDGE REMINDER
        // ======================================

        case "acknowledge_reminder": {

          console.log(
            "✅ Intent: ACKNOWLEDGE_REMINDER"
          );

          const acknowledgmentResult =
            await acknowledgeLatestReminder(
              from
            );

          if (
            acknowledgmentResult &&
            acknowledgmentResult.acknowledged
          ) {

            console.log(
              "✅ Reminder acknowledged:",
              acknowledgmentResult
                .reminder
                .task
            );

            await sendWhatsAppMessage(
              from,

              `✅ Got it! "${acknowledgmentResult.reminder.task}" has been marked as completed.`
            );

          } else {

            console.log(
              "ℹ️ No pending reminder found to acknowledge"
            );

            await sendWhatsAppMessage(
              from,

              "👍 Got it!"
            );
          }

          return res.sendStatus(
            200
          );
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

              message:
                text,

              phoneNumber:
                from,

            });

          console.log(
            "🤖 AI conversation response:",
            reply
          );

          await sendWhatsAppMessage(
            from,
            reply
          );

          // --------------------------------------
          // Save assistant response
          // --------------------------------------

          try {

            await addRecentContext({

              phoneNumber:
                from,

              role:
                "assistant",

              content:
                reply,

            });

          } catch (
          memoryError
          ) {

            console.error(
              "⚠️ Failed to save assistant context:",
              memoryError.message
            );
          }

          // --------------------------------------
          // Extract long-term memory
          // --------------------------------------

          try {

            const recentContext =
              await getRecentContext(
                from,
                10
              );

            const existingMemory =
              await buildMemoryContext(
                from
              );

            console.log(
              "🧠 Existing memory loaded for extraction"
            );

            const memory =
              await extractMemory({

                message:
                  text,

                phoneNumber:
                  from,

                recentContext,

                existingMemory,

              });

            console.log(
              "🧠 Context-aware extracted memory:",
              memory
            );

            if (
              memory &&
              memory.shouldRemember
            ) {

              if (
                memory.isUpdate
              ) {

                console.log(
                  "🔄 Updating existing memory:",
                  memory.key
                );

                await updateMemory({

                  phoneNumber:
                    from,

                  memory,

                });

                console.log(
                  "✅ Existing memory updated successfully"
                );

              } else {

                console.log(
                  "💾 Saving new memory:",
                  memory.key
                );

                await saveExtractedMemory({

                  phoneNumber:
                    from,

                  memory,

                });

                console.log(
                  "✅ New memory saved successfully"
                );
              }
            }

          } catch (
          memoryError
          ) {

            console.error(
              "⚠️ Context-aware memory extraction/save failed:",
              memoryError.message
            );
          }

          return res.sendStatus(
            200
          );
        }

        // ======================================
        // CANCEL REMINDER
        // ======================================

        case "cancel_reminder": {

          console.log(
            "🗑️ Intent: CANCEL_REMINDER"
          );

          await sendWhatsAppMessage(
            from,

            "I understand you want to cancel a reminder. The cancellation feature is coming next. 👍"
          );

          return res.sendStatus(
            200
          );
        }

        // ======================================
        // RESCHEDULE REMINDER
        // ======================================

        case "reschedule_reminder": {

          console.log(
            "🔄 Intent: RESCHEDULE_REMINDER"
          );

          await sendWhatsAppMessage(
            from,

            "I understand you want to reschedule a reminder. The rescheduling feature is coming next. 👍"
          );

          return res.sendStatus(
            200
          );
        }

        // ======================================
        // UNKNOWN
        // ======================================

        case "unknown": {

          console.log(
            "❓ Intent: UNKNOWN"
          );

          await sendWhatsAppMessage(
            from,

            "I'm not completely sure what you mean. You can ask me to create a reminder, or we can just chat 😊"
          );

          return res.sendStatus(
            200
          );
        }

        // ======================================
        // FALLBACK
        // ======================================

        default: {

          console.log(
            "⚠️ Unsupported AI intent:",
            aiResult.intent
          );

          await sendWhatsAppMessage(
            from,

            "I'm not sure how to handle that yet. 😊"
          );

          return res.sendStatus(
            200
          );
        }
      }

    } catch (error) {

      console.error(
        "Webhook processing error:",
        error.response?.data ||
        error.message
      );

      /*
      Always acknowledge Meta.
      */

      return res.sendStatus(
        200
      );
    }
  };


module.exports = {
  verifyWebhook,
  receiveWebhook,
};