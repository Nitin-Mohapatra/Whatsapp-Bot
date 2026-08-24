const fs = require("fs");

const {
  transcribeAudio,
} = require("../services/sarvam.service");


// ============================================================
// TEST SARVAM
// ============================================================

const testSarvam = async (req, res) => {

  try {

    const audioPath =
      req.body?.audioPath;


    if (!audioPath) {

      return res.status(400).json({
        success: false,

        message:
          "audioPath is required",
      });

    }


    if (
      !fs.existsSync(audioPath)
    ) {

      return res.status(404).json({
        success: false,

        message:
          "Audio file not found",
      });

    }


    const audioBuffer =
      fs.readFileSync(
        audioPath
      );


    const result =
      await transcribeAudio({
        audioBuffer,

        filename:
          audioPath
            .split("/")
            .pop(),

        mimeType:
          "audio/ogg",

        languageCode:
          "unknown",
      });


    return res.json({
      success: true,

      message:
        "Audio transcribed successfully",

      data:
        result,
    });


  } catch (error) {

    console.error(
      "❌ Sarvam test error:",
      error.response?.data ||
        error.message
    );


    return res.status(500).json({
      success: false,

      message:
        "Speech-to-text failed",

      error:
        error.response?.data ||
        error.message,
    });
  }
};


module.exports = {
  testSarvam,
};