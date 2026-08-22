const express = require("express");

const {
  testAI,
  testTimeParser,
} = require("../controllers/ai.controller");

const {
  processReminderMessage,
} = require("../services/reminder.pipeline.service");

const router = express.Router();

router.post("/test", testAI);
router.post("/test-time", testTimeParser);

router.post("/test-reminder", async (req, res) => {
  try {
    const { phoneNumber, message } = req.body;

    if (!phoneNumber || !message) {
      return res.status(400).json({
        success: false,
        message: "phoneNumber and message are required",
      });
    }

    const result = await processReminderMessage({
      phoneNumber,
      message,
    });

    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

module.exports = router;