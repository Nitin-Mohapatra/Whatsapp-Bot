const express = require("express");

const {
  createReminder,
  testTwilioCall,
} = require("../controllers/reminder.controller");

const router = express.Router();

router.post("/", createReminder);

// Temporary Twilio test endpoint
router.post("/test-call", testTwilioCall);

module.exports = router;