const express = require("express");

const {
  createReminder,
} = require("../controllers/reminder.controller");

const router = express.Router();

router.post("/", createReminder);

module.exports = router;