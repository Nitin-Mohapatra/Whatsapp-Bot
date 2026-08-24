const axios = require("axios");
const FormData = require("form-data");


// ============================================================
// SARVAM CONFIG
// ============================================================

const SARVAM_API_URL =
  "https://api.sarvam.ai/speech-to-text";


// ============================================================
// TRANSCRIBE AUDIO
// ============================================================

const transcribeAudio = async ({
  audioBuffer,
  filename = "audio.ogg",
  mimeType = "audio/ogg",
  languageCode = "unknown",
}) => {
  try {

    if (!audioBuffer) {
      throw new Error(
        "Audio buffer is required"
      );
    }


    if (!process.env.SARVAM_API_KEY) {
      throw new Error(
        "SARVAM_API_KEY is missing from environment variables"
      );
    }


    console.log(
      "🎙️ Sending audio to Sarvam..."
    );

    console.log(
      "🎙️ Audio:",
      {
        filename,
        mimeType,
        size: audioBuffer.length,
      }
    );


    // ========================================================
    // CREATE MULTIPART FORM
    // ========================================================

    const form = new FormData();


    form.append(
      "file",
      audioBuffer,
      {
        filename,
        contentType: mimeType,
      }
    );


    // ========================================================
    // SARVAM OPTIONS
    // ========================================================

    form.append(
      "model",
      "saaras:v3"
    );


    /*
    transcribe:

    Keep the spoken language as the output language.

    Example:

    Hindi voice:
    "कल सुबह आठ बजे मुझे कॉल करना"

    Output:
    "कल सुबह आठ बजे मुझे कॉल करना"
    */

    form.append(
      "mode",
      "transcribe"
    );


    /*
    unknown tells Sarvam to automatically detect
    the spoken language.
    */

    form.append(
      "language_code",
      languageCode || "unknown"
    );


    // ========================================================
    // CALL SARVAM
    // ========================================================

    const response =
      await axios.post(
        SARVAM_API_URL,
        form,
        {
          headers: {
            ...form.getHeaders(),

            "api-subscription-key":
              process.env.SARVAM_API_KEY,
          },

          maxContentLength:
            Infinity,

          maxBodyLength:
            Infinity,

          timeout:
            30000,
        }
      );


    // ========================================================
    // RESPONSE
    // ========================================================

    console.log(
      "🎙️ Sarvam response:",
      response.data
    );


    const transcript =
      response.data?.transcript;


    if (
      !transcript ||
      !transcript.trim()
    ) {

      throw new Error(
        "Sarvam returned an empty transcript"
      );
    }


    return {
      transcript:
        transcript.trim(),

      languageCode:
        response.data?.language_code ||
        null,

      requestId:
        response.data?.request_id ||
        null,

      languageProbability:
        response.data
          ?.language_probability ||
        null,
    };


  } catch (error) {

    console.error(
      "❌ Sarvam STT error:",
      error.response?.data ||
        error.message
    );


    throw error;
  }
};


// ============================================================
// EXPORT
// ============================================================

module.exports = {
  transcribeAudio,
};