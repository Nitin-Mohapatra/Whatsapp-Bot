const axios = require("axios");


// ============================================================
// SEND WHATSAPP TEXT MESSAGE
// ============================================================

const sendWhatsAppMessage = async (
  to,
  message
) => {

  const phoneNumberId =
    process.env.WHATSAPP_PHONE_NUMBER_ID;

  const accessToken =
    process.env.WHATSAPP_ACCESS_TOKEN;


  const url =
    `https://graph.facebook.com/v26.0/${phoneNumberId}/messages`;


  const response =
    await axios.post(
      url,
      {
        messaging_product:
          "whatsapp",

        recipient_type:
          "individual",

        to,

        type:
          "text",

        text: {
          body:
            message,
        },
      },
      {
        headers: {
          Authorization:
            `Bearer ${accessToken}`,

          "Content-Type":
            "application/json",
        },
      }
    );


  return response.data;
};


// ============================================================
// GET WHATSAPP MEDIA URL
// ============================================================

const getWhatsAppMediaUrl = async (
  mediaId
) => {

  const accessToken =
    process.env.WHATSAPP_ACCESS_TOKEN;


  if (!mediaId) {
    throw new Error(
      "WhatsApp media ID is required"
    );
  }


  const url =
    `https://graph.facebook.com/v26.0/${mediaId}`;


  console.log(
    "📥 Getting WhatsApp media URL:",
    mediaId
  );


  const response =
    await axios.get(
      url,
      {
        headers: {
          Authorization:
            `Bearer ${accessToken}`,
        },
      }
    );


  console.log(
    "📥 WhatsApp media information:",
    response.data
  );


  if (!response.data?.url) {
    throw new Error(
      "WhatsApp did not return a media URL"
    );
  }


  return {
    url:
      response.data.url,

    mimeType:
      response.data.mime_type ||
      "audio/ogg",

    sha256:
      response.data.sha256 ||
      null,

    fileSize:
      response.data.file_size ||
      null,
  };
};


// ============================================================
// DOWNLOAD WHATSAPP MEDIA
// ============================================================

const downloadWhatsAppMedia = async (
  mediaUrl
) => {

  const accessToken =
    process.env.WHATSAPP_ACCESS_TOKEN;


  if (!mediaUrl) {
    throw new Error(
      "WhatsApp media URL is required"
    );
  }


  console.log(
    "📥 Downloading WhatsApp media..."
  );


  const response =
    await axios.get(
      mediaUrl,
      {
        headers: {
          Authorization:
            `Bearer ${accessToken}`,
        },

        responseType:
          "arraybuffer",

        maxContentLength:
          Infinity,

        maxBodyLength:
          Infinity,

        timeout:
          30000,
      }
    );


  const audioBuffer =
    Buffer.from(
      response.data
    );


  console.log(
    "📥 WhatsApp audio downloaded:",
    audioBuffer.length,
    "bytes"
  );


  return {
    buffer:
      audioBuffer,

    contentType:
      response.headers[
        "content-type"
      ] ||
      "audio/ogg",
  };
};


// ============================================================
// EXPORT
// ============================================================

module.exports = {

  sendWhatsAppMessage,

  getWhatsAppMediaUrl,

  downloadWhatsAppMedia,
};