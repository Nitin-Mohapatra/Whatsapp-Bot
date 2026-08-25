const express = require("express");

const {
  googleCalendarCallback,
} = require("../controllers/google.calendar.controller");

const router = express.Router();

router.get(
  "/callback",
  googleCalendarCallback
);

module.exports = router;