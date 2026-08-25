// ======================================================
// src/controllers/webhook.controller.js
// ======================================================

const axios =
  require("axios");

const FormData =
  require("form-data");

const Message =
  require("../models/message.model");

const {
  sendWhatsAppMessage,
} =
  require("../services/whatsapp.service");

const {
  processReminderMessage,
} =
  require("../services/reminder.pipeline.service");

const {
  acknowledgeLatestReminder,
} =
  require("../services/reminder.acknowledgement.service");

const {
  analyzeMessage,

  extractMemory,
} =
  require("../services/ai.service");

const {
  addRecentContext,

  saveExtractedMemory,

  updateMemory,

  getRecentContext,
  buildMemoryContext,
} =
  require("../services/memory.service");

const {
  cancelReminderByTask,
  cancelLatestReminder,
} = require("../services/reminder.cancellation.service");

const {
  generateAuthUrl,
} = require("../services/google.calendar.service");


// ======================================================
// SARVAM SPEECH TO TEXT
// ======================================================

const transcribeAudioWithSarvam =
  async ({
    audioBuffer,
    mimeType,
    fileName,
  }) => {

    try {

      console.log(
        "🎙️ Sending audio to Sarvam STT..."
      );

      if (
        !process.env.SARVAM_API_KEY
      ) {

        throw new Error(
          "SARVAM_API_KEY is not configured"
        );
      }

      const formData =
        new FormData();

      formData.append(
        "file",
        audioBuffer,
        {
          filename:
            fileName ||
            "whatsapp-audio.ogg",

          contentType:
            mimeType ||
            "audio/ogg",
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

const downloadWhatsAppMedia =
  async (
    mediaId
  ) => {

    try {

      console.log(
        "🎧 Getting WhatsApp media URL:",
        mediaId
      );

      if (
        !process.env.WHATSAPP_ACCESS_TOKEN
      ) {

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


// ======================================================
// GET /api/whatsapp/webhook
// ======================================================

const verifyWebhook =
  (
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
        .send(
          challenge
        );
    }

    console.log(
      "Webhook verification failed"
    );

    return res.sendStatus(
      403
    );
  };


// ======================================================
// POST /api/whatsapp/webhook
// ======================================================

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

      // ==================================================
      // MAKE SURE THIS IS WHATSAPP EVENT
      // ==================================================

      if (
        body.object !==
        "whatsapp_business_account"
      ) {

        return res.sendStatus(
          404
        );
      }

      // ==================================================
      // EXTRACT MESSAGE
      // ==================================================

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

      // ==================================================
      // MESSAGE INFORMATION
      // ==================================================

      const from =
        message.from;

      const messageId =
        message.id;

      const messageType =
        message.type;

      // ==================================================
      // DUPLICATE CHECK
      // ==================================================

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

      // ==================================================
      // MESSAGE TEXT
      // ==================================================

      let text =
        "";

      let voiceLanguage =
        null;

      let voiceRequestId =
        null;

      // ==================================================
      // TEXT MESSAGE
      // ==================================================

      if (
        messageType === "text"
      ) {

        text =
          message.text?.body ||
          "";
      }

      // ==================================================
      // AUDIO / VOICE MESSAGE
      // ==================================================

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

      // ==================================================
      // OTHER MESSAGE TYPES
      // ==================================================

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

      // ==================================================
      // LOG MESSAGE
      // ==================================================

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

      // ==================================================
      // FINAL TEXT SAFETY CHECK
      // ==================================================

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

      // ==================================================
      // SAVE INCOMING MESSAGE
      // ==================================================

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

      // ==================================================
      // SAVE SHORT-TERM USER CONTEXT
      // ==================================================

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

      // ==================================================
      // GET RECENT CONTEXT
      // ==================================================

      let recentContext =
        [];

      try {

        recentContext =
          await getRecentContext(
            from,
            15
          );

      } catch (
      contextError
      ) {

        console.error(
          "⚠️ Failed to load recent context:",
          contextError.message
        );
      }

      // ==================================================
      // GET LONG-TERM MEMORY
      // ==================================================

      let existingMemory =
        "";

      try {

        existingMemory =
          await buildMemoryContext(
            from
          );

      } catch (
      contextError
      ) {

        console.error(
          "⚠️ Failed to load long-term memory:",
          contextError.message
        );
      }

      // ==================================================
      // AI ROUTER
      // ==================================================

      const aiResult =
        await analyzeMessage(

          text,

          {
            history:
              recentContext,

            userContext:
              existingMemory,

          }

        );

      console.log(
        "🧠 AI Router Result:",
        JSON.stringify(
          aiResult,
          null,
          2
        )
      );

      // ==================================================
      // SAFETY CHECK
      // ==================================================

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

      // ==================================================
      // ROUTE INTENT
      // ==================================================

      switch (
      aiResult.intent
      ) {

        // ==================================================
        // CONNECT GOOGLE CALENDAR
        // ==================================================

        case "connect_google_calendar": {

          console.log(
            "[CALENDAR] Google Calendar connection requested"
          );

          const authUrl =
            await generateAuthUrl(from);

          console.log(
            "[CALENDAR] OAuth URL generated"
          );

          const reply =
            "📅 Let's connect your Google Calendar.\n\n" +
            "Tap this link to authorize access:\n\n" +
            `${authUrl}\n\n` +
            "After you authorize Google Calendar, I'll connect it to your assistant.";

          await sendWhatsAppMessage(
            from,
            reply
          );

          return res.sendStatus(
            200
          );
        }

        // ==================================================
        // CREATE REMINDER
        // ==================================================

        case "create_reminder": {

          console.log(
            "📅 Intent: CREATE_REMINDER"
          );

          const result =
            await processReminderMessage({

              phoneNumber:
                from,

              message:
                text,

              aiResult,

            });

          console.log(
            "📋 Reminder pipeline result:",
            result
          );

          // ----------------------------------------------
          // PIPELINE FAILED
          // ----------------------------------------------

          if (
            !result ||
            !result.isReminder ||
            !result.reminder
          ) {

            console.log(
              "⚠️ Reminder could not be created:",
              result?.reason
            );

            let failureMessage =
              "I understood that you want a reminder, but I couldn't schedule it.";

            if (
              result?.reason ===
              "missing_task"
            ) {

              failureMessage =
                "I understood the reminder, but I couldn't figure out what you want me to remind you about.";
            }

            if (
              result?.reason ===
              "invalid_scheduled_time"
            ) {

              failureMessage =
                "I understood the task, but I couldn't determine a valid time. Please tell me when you'd like the reminder.";
            }

            if (
              result?.reason ===
              "scheduled_time_in_past"
            ) {

              failureMessage =
                "That time has already passed. Please give me a future time.";
            }

            if (
              result?.reason ===
              "missing_recurring_interval"
            ) {

              failureMessage =
                "I understood that you want a recurring reminder, but I couldn't determine how often it should repeat.";
            }

            await sendWhatsAppMessage(

              from,

              failureMessage
            );

            return res.sendStatus(
              200
            );
          }

          // ----------------------------------------------
          // SUCCESS
          // ----------------------------------------------

          const reminder =
            result.reminder;

          let scheduledText =
            "";

          if (
            reminder.scheduledFor
          ) {

            scheduledText =
              new Date(
                reminder.scheduledFor
              ).toLocaleString(

                "en-IN",

                {

                  timeZone:
                    "Asia/Kolkata",

                  day:
                    "2-digit",

                  month:
                    "short",

                  year:
                    "numeric",

                  hour:
                    "2-digit",

                  minute:
                    "2-digit",

                  hour12:
                    true,

                }
              );
          }

          let reply =
            `✅ Reminder created!\n\n` +
            `📝 Task: ${reminder.task}\n`;

          if (
            reminder.reminderType ===
            "one_time"
          ) {

            reply +=
              `⏰ ${scheduledText}\n\n`;

          } else {

            reply +=
              `🔁 Recurring reminder\n`;

            if (
              reminder.intervalMinutes
            ) {

              reply +=
                `⏱️ Every ${reminder.intervalMinutes} minutes\n`;
            }

            if (
              scheduledText
            ) {

              reply +=
                `⏰ First reminder: ${scheduledText}\n`;
            }

            reply +=
              `\n`;
          }

          reply +=
            `I'll remind you at the scheduled time. 😊`;

          await sendWhatsAppMessage(

            from,

            reply
          );

          // Save assistant reminder response

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
          contextError
          ) {

            console.error(
              "⚠️ Failed to save reminder response context:",
              contextError.message
            );
          }

          return res.sendStatus(
            200
          );
        }

        // ==================================================
        // ACKNOWLEDGE REMINDER
        // ==================================================

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

            const completedTask =
              acknowledgmentResult
                ?.reminder
                ?.task ||
              "reminder";

            console.log(
              "✅ Reminder acknowledged:",
              completedTask
            );

            const reply =
              `✅ Got it! "${completedTask}" has been marked as completed.`;

            await sendWhatsAppMessage(

              from,

              reply
            );

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
            contextError
            ) {

              console.error(
                "⚠️ Failed to save acknowledgement context:",
                contextError.message
              );
            }

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

        // ==================================================
        // NORMAL CONVERSATION
        // ==================================================

        case "conversation": {

          console.log(
            "💬 Intent: CONVERSATION"
          );

          /*
           * IMPORTANT:
           *
           * analyzeMessage() has already generated
           * the conversation response.
           *
           * DO NOT call:
           *
           * generateConversationResponse()
           *
           * because it does not exist anymore.
           */

          const reply =
            aiResult.response ||
            "I'm here 😊 Tell me what's on your mind.";

          console.log(
            "🤖 AI conversation response:",
            reply
          );

          await sendWhatsAppMessage(

            from,

            reply
          );

          // ==================================================
          // SAVE ASSISTANT RESPONSE
          // ==================================================

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

          // ==================================================
          // EXTRACT LONG-TERM MEMORY
          // ==================================================

          try {

            console.log(
              "🧠 Starting memory extraction..."
            );

            const latestRecentContext =
              await getRecentContext(
                from,
                10
              );

            const latestExistingMemory =
              await buildMemoryContext(
                from
              );

            const memory =
              await extractMemory({

                message:
                  text,

                phoneNumber:
                  from,

                recentContext:
                  latestRecentContext,

                existingMemory:
                  latestExistingMemory,

              });

            console.log(
              "🧠 Extracted memory:",
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
            } else {

              console.log(
                "ℹ️ No new long-term memory detected"
              );
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

        // ==================================================
        // CANCEL REMINDER
        // ==================================================

        // ======================================
        // CANCEL REMINDER
        // ======================================

        case "cancel_reminder": {

          console.log(
            "🗑️ Intent: CANCEL_REMINDER"
          );

          console.log(
            "📝 Cancellation task from AI:",
            aiResult.task
          );

          // ==================================================
          // CASE 1:
          // AI identified a specific task
          //
          // Example:
          //
          // "cancel my water reminder"
          //
          // AI:
          //
          // {
          //   intent: "cancel_reminder",
          //   task: "water"
          // }
          // ==================================================

          if (
            aiResult.task &&
            aiResult.task.trim()
          ) {

            const cancellationResult =
              await cancelReminderByTask(
                from,
                aiResult.task
              );

            console.log(
              "🗑️ Cancellation result:",
              cancellationResult
            );

            // ----------------------------------------------
            // SUCCESS
            // ----------------------------------------------

            if (
              cancellationResult.cancelled &&
              cancellationResult.reminder
            ) {

              const cancelledReminder =
                cancellationResult.reminder;

              await sendWhatsAppMessage(
                from,

                `🗑️ Reminder cancelled!\n\n` +
                `📝 Task: ${cancelledReminder.task}`
              );

              return res.sendStatus(
                200
              );
            }

            // ----------------------------------------------
            // AMBIGUOUS
            // ----------------------------------------------

            if (
              cancellationResult.reason ===
              "ambiguous_match"
            ) {

              const matches =
                cancellationResult.matches || [];

              let reply =
                "I found more than one reminder that could match. Which one should I cancel?\n\n";

              matches.forEach(
                (
                  reminder,
                  index
                ) => {

                  reply +=
                    `${index + 1}. ${reminder.task}`;

                  if (
                    reminder.nextRunAt
                  ) {

                    reply +=
                      ` — ${new Date(
                        reminder.nextRunAt
                      ).toLocaleString(
                        "en-IN",
                        {
                          timeZone:
                            "Asia/Kolkata",

                          day:
                            "2-digit",

                          month:
                            "short",

                          hour:
                            "2-digit",

                          minute:
                            "2-digit",

                          hour12:
                            true,
                        }
                      )}`;
                  }

                  reply +=
                    "\n";
                }
              );

              await sendWhatsAppMessage(
                from,
                reply
              );

              return res.sendStatus(
                200
              );
            }

            // ----------------------------------------------
            // NO ACTIVE REMINDERS
            // ----------------------------------------------

            if (
              cancellationResult.reason ===
              "no_active_reminders"
            ) {

              await sendWhatsAppMessage(
                from,

                "You don't have any active reminders to cancel. 😊"
              );

              return res.sendStatus(
                200
              );
            }

            // ----------------------------------------------
            // NO MATCH
            // ----------------------------------------------

            if (
              cancellationResult.reason ===
              "no_matching_reminder"
            ) {

              await sendWhatsAppMessage(
                from,

                `I couldn't find an active reminder for "${aiResult.task}".\n\n` +
                `You can ask me to cancel another reminder by mentioning its task name.`
              );

              return res.sendStatus(
                200
              );
            }

            // ----------------------------------------------
            // WEAK MATCH
            // ----------------------------------------------

            if (
              cancellationResult.reason ===
              "weak_match"
            ) {

              await sendWhatsAppMessage(
                from,

                `I couldn't confidently identify which reminder you want to cancel.\n\n` +
                `Please mention the reminder task more specifically.`
              );

              return res.sendStatus(
                200
              );
            }

            // ----------------------------------------------
            // REMINDER ALREADY PROCESSING
            // ----------------------------------------------

            if (
              cancellationResult.reason ===
              "already_processing"
            ) {

              await sendWhatsAppMessage(
                from,

                "That reminder is already being processed, so I couldn't cancel it. Please try again if needed."
              );

              return res.sendStatus(
                200
              );
            }

            // ----------------------------------------------
            // UNKNOWN CANCELLATION FAILURE
            // ----------------------------------------------

            await sendWhatsAppMessage(
              from,

              "I understood that you want to cancel the reminder, but I couldn't cancel it right now. Please try again."
            );

            return res.sendStatus(
              200
            );
          }

          // ==================================================
          // CASE 2:
          // NO TASK WAS PROVIDED
          //
          // Examples:
          //
          // "cancel my latest reminder"
          // "cancel the last reminder"
          //
          // ==================================================

          console.log(
            "🗑️ No specific task provided. Trying latest reminder."
          );

          const latestResult =
            await cancelLatestReminder(
              from
            );

          console.log(
            "🗑️ Latest cancellation result:",
            latestResult
          );

          // ----------------------------------------------
          // SUCCESS
          // ----------------------------------------------

          if (
            latestResult.cancelled &&
            latestResult.reminder
          ) {

            const cancelledReminder =
              latestResult.reminder;

            await sendWhatsAppMessage(
              from,

              `🗑️ Reminder cancelled!\n\n` +
              `📝 Task: ${cancelledReminder.task}`
            );

            return res.sendStatus(
              200
            );
          }

          // ----------------------------------------------
          // NO REMINDERS
          // ----------------------------------------------

          if (
            latestResult.reason ===
            "no_active_reminders"
          ) {

            await sendWhatsAppMessage(
              from,

              "You don't have any active reminders to cancel. 😊"
            );

            return res.sendStatus(
              200
            );
          }

          // ----------------------------------------------
          // MULTIPLE REMINDERS
          // ----------------------------------------------

          if (
            latestResult.reason ===
            "multiple_reminders"
          ) {

            const matches =
              latestResult.matches || [];

            let reply =
              "You have multiple active reminders. Which one should I cancel?\n\n";

            matches.forEach(
              (
                reminder,
                index
              ) => {

                reply +=
                  `${index + 1}. ${reminder.task}`;

                if (
                  reminder.nextRunAt
                ) {

                  reply +=
                    ` — ${new Date(
                      reminder.nextRunAt
                    ).toLocaleString(
                      "en-IN",
                      {
                        timeZone:
                          "Asia/Kolkata",

                        day:
                          "2-digit",

                        month:
                          "short",

                        hour:
                          "2-digit",

                        minute:
                          "2-digit",

                        hour12:
                          true,
                      }
                    )}`;
                }

                reply +=
                  "\n";
              }
            );

            reply +=
              "\nTell me the task name you want to cancel.";

            await sendWhatsAppMessage(
              from,
              reply
            );

            return res.sendStatus(
              200
            );
          }

          // ----------------------------------------------
          // FALLBACK
          // ----------------------------------------------

          await sendWhatsAppMessage(
            from,

            "I couldn't find a reminder to cancel. 😊"
          );

          return res.sendStatus(
            200
          );
        }

        // ==================================================
        // RESCHEDULE REMINDER
        // ==================================================

        case "reschedule_reminder": {

          console.log(
            "🔄 Intent: RESCHEDULE_REMINDER"
          );

          /*
           * Rescheduling is intentionally left
           * for the next development step.
           */

          await sendWhatsAppMessage(

            from,

            "I understand you want to reschedule a reminder. The rescheduling feature is coming next. 👍"
          );

          return res.sendStatus(
            200
          );
        }

        // ==================================================
        // LIST REMINDERS
        // ==================================================

        case "list_reminders": {

          console.log(
            "📋 Intent: LIST_REMINDERS"
          );

          /*
           * Listing reminders will be implemented
           * together with cancellation/rescheduling.
           */

          await sendWhatsAppMessage(

            from,

            "I understand you want to see your reminders. The reminder list feature is coming next. 👍"
          );

          return res.sendStatus(
            200
          );
        }

        // ==================================================
        // UNKNOWN
        // ==================================================

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

        // ==================================================
        // FALLBACK
        // ==================================================

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
        "❌ Webhook processing error:",
        error.response?.data ||
        error.message
      );

      /*
       * Always acknowledge Meta.
       */

      return res.sendStatus(
        200
      );
    }
  };


// ======================================================
// EXPORTS
// ======================================================

module.exports = {

  verifyWebhook,

  receiveWebhook,

};