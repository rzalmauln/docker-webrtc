const http = require('http');
const axios = require('axios');
const { parseStringPromise } = require('xml2js');

const CAMERA_URL = "http://admin:Hiksds12@192.168.3.64/ISAPI/Event/notification/alertStream";


function startListener(){
    http.get(CAMERA_URL, (res) => {
        let buffer = "";

        res.on("data", async chunk => {
            buffer += chunk.toString();

            const startTag = "<EventNotificationAlert";
            const endTag = "</EventNotificationAlert>";

            // selama ada XML lengkap di buffer
            while (buffer.includes(startTag) && buffer.includes(endTag)) {
                const start = buffer.indexOf(startTag);
                const end = buffer.indexOf(endTag) + endTag.length;

                // Ambil hanya XML clean (buang boundary)
                const xml = buffer.substring(start, end);

                // Sisanya masih menunggu event berikutnya
                buffer = buffer.slice(end);

                try {
                    const json = await parseStringPromise(xml);
                    const eventType = json.EventNotificationAlert.eventType?.[0] ?? "";

                    // Skip video loss
                    if (eventType.toLowerCase() === "videoloss") {
                        console.log("Video Loss detected → skipped");
                        continue;  // lanjut ke XML berikutnya
                    }
                    // Skip duration
                    if (eventType.toLowerCase() === "duration") {
                        console.log("Duration detected → skipped");
                        continue;  // lanjut ke XML berikutnya
                    }

                    console.log("=== EVENT RECEIVED ===");
                    console.log(eventType);

                    // Kirim ke Laravel API
                    await axios.post("http://100.73.50.49:8000/api/cctv-event", {
                        event: json,
                        raw_xml: xml
                    }, {
                        timeout: 5000 // 3 detik
                    }).catch(apiErr => {
                        console.error("Laravel API Error:", apiErr.response?.data || apiErr.message);
                    });


                } catch (err) {
                    console.error("Error parsing XML:", err.message);
                }
            }
        });

        res.on("end", () => {
        console.log("Connection error:", err.message);
        setTimeout(() => startListener(), 3000);
        });
    });
}

startListener();
