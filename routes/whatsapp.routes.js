const express = require("express");

const {
  testMessage,
} = require("../controllers/whatsapp.controller");

const router = express.Router();

router.post("/test-message", testMessage);

module.exports = router;