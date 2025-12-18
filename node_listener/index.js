const http = require('http');
const axios = require('axios');
const { parseStringPromise } = require('xml2js');
const FormData = require('form-data');

/* ===============================
   CONFIG
=============================== */
const CAMERA_URL =
  "http://admin:Hiksds12@192.168.3.64/ISAPI/Event/notification/alertStream";

/* ===============================
   STATE
=============================== */
let xmlBuffer = "";
let imageMode = false;
let imageChunks = [];
let pendingImageBuffer = null;
let currentEventId = null;

/* ===============================
   MAIN LISTENER
=============================== */
function startListener() {
  console.log("🎥 Connecting to CCTV...");

  http.get(CAMERA_URL, (res) => {

    res.on("data", async (chunk) => {

      /* ===============================
         IMAGE MODE (JPEG BINARY)
      =============================== */
      if (imageMode) {
        imageChunks.push(chunk);
        const buffer = Buffer.concat(imageChunks);

        // JPEG END MARKER
        const endIdx = buffer.indexOf(Buffer.from([0xFF, 0xD9]));

        if (endIdx !== -1) {
          const imageBuffer = buffer.slice(0, endIdx + 2);

          pendingImageBuffer = imageBuffer;
          console.log("🕒 Image buffered, waiting for event validation");

          // sisa data setelah image
          const remaining = buffer.slice(endIdx + 2);
          xmlBuffer += remaining.toString('utf8');

          // reset image mode
          imageMode = false;
          imageChunks = [];
        }
        return;
      }

      /* ===============================
         NORMAL MODE (XML / STREAM)
      =============================== */

      // JPEG START MARKER
      const jpegStart = chunk.indexOf(Buffer.from([0xFF, 0xD8]));

      if (jpegStart !== -1) {
        console.log("🧠 JPEG START DETECTED");

        imageMode = true;
        imageChunks = [chunk.slice(jpegStart)];

        // XML sebelum image
        xmlBuffer += chunk.slice(0, jpegStart).toString('utf8');
        return;
      }

      // normal XML
      xmlBuffer += chunk.toString('utf8');

      /* ===============================
         XML PARSING
      =============================== */
      const startTag = "<EventNotificationAlert";
      const endTag = "</EventNotificationAlert>";

      while (xmlBuffer.includes(startTag) && xmlBuffer.includes(endTag)) {
        const start = xmlBuffer.indexOf(startTag);
        const end = xmlBuffer.indexOf(endTag) + endTag.length;

        const xml = xmlBuffer.substring(start, end);
        xmlBuffer = xmlBuffer.slice(end);

        try {
          const json = await parseStringPromise(xml);
          const alert = json.EventNotificationAlert;

          const eventType =
            alert.eventType?.[0]?.toLowerCase() ?? "";

          currentEventId =
            alert.targetID?.[0] ?? Date.now();

          /* ===============================
             SKIP INVALID EVENTS
          =============================== */
          if (eventType === "videoloss" || eventType === "duration") {
            console.log("⛔ Event skipped:", eventType);
            pendingImageBuffer = null;
            continue;
          }
          const eventState =
            alert.eventState?.[0]?.toLowerCase() ?? "";

          if (eventState === "inactive") {
            console.log("⛔ Event skipped:", eventState);
            pendingImageBuffer = null;
            continue;
          }
          console.log("=== EVENT RECEIVED ===");
          console.log("📌 Event Type:", eventType);

          /* ===============================
             SEND EVENT + IMAGE TO LARAVEL
          =============================== */
          const form = new FormData();
          form.append('event', JSON.stringify(json));
          form.append('raw_xml', xml);

          if (pendingImageBuffer) {
            form.append('snapshot', pendingImageBuffer, {
              filename: `event_${currentEventId}.jpg`,
              contentType: 'image/jpeg'
            });
            pendingImageBuffer = null;
          }

            await axios.post(
            "http://100.73.50.49:8000/api/cctv-event",
            form,
            { headers: form.getHeaders(), timeout: 5000 }
            ).catch(err => {
            console.error("⚠️ Failed to send event to backend:", err.message);
            });
        } catch (err) {
          console.error("❌ XML parse error:", err.message);
        }
      }
    });

    res.on("end", () => {
      console.log("🔄 Connection closed, retrying...");
      setTimeout(() => startListener(), 3000);
    });

  }).on("error", err => {
    console.error("❌ Connection error:", err.message);
    setTimeout(() => startListener(), 5000);
  });
}

/* ===============================
   START
=============================== */
startListener();
