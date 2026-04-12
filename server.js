import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { snapsave } from "snapsave-media-downloader";
import fetch from "node-fetch";
import FormData from "form-data";
import { exec } from "child_process";
import os from "os";

const app = express();
app.use(express.json());

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = process.env.PORT || 3000;

app.use(express.static(__dirname));

// --- HELPER: UPLOAD KE VIDEY ---
async function uploadToVidey(videoUrl) {
    try {
        const response = await fetch(videoUrl);
        const buffer = await response.arrayBuffer();

        const form = new FormData();
        form.append('file', Buffer.from(buffer), {
            filename: 'video.mp4',
            contentType: 'video/mp4',
        });

        const up = await fetch("https://videy.co/api/upload", {
            method: "POST",
            body: form,
            headers: {
                "Origin": "https://videy.co",
                "Referer": "https://videy.co/",
                ...form.getHeaders()
            }
        });

        const resJson = await up.json();
        return resJson.id ? `https://videy.co/v/?id=${resJson.id}` : null;
    } catch (e) {
        console.error("❌ Videy Upload Error:", e.message);
        return null;
    }
}

// --- ENDPOINT DOWNLOAD & AUTO UPLOAD ---
app.post("/api/download", async (req, res) => {
    try {
        const { url } = req.body;
        if (!url) return res.status(400).json({ success: false, error: "URL wajib diisi" });

        // 1. Scrape via SnapSave
        const result = await snapsave(url);
        const data = result?.data;

        if (!data?.media?.length) {
            return res.status(404).json({ success: false, error: "Media tidak ditemukan." });
        }

        // Ambil media terbaik (biasanya index 0)
        const rawMediaUrl = data.media[0].url;
        
        // 2. Upload ke Videy (Backend Process)
        const videyLink = await uploadToVidey(rawMediaUrl);

        if (!videyLink) {
            return res.status(500).json({ success: false, error: "Gagal memproses ke Videy." });
        }

        // 3. Kirim ke FrontEnd
        res.json({
            success: true,
            data: {
                title: data.description || "Video Content",
                videyUrl: videyLink,
                source: url
            }
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "index.html"));
});

app.listen(PORT, () => {
    console.log(`✅ Server aktif di http://localhost:${PORT}`);
    if (os.platform() === "android") {
        exec("termux-open-url http://localhost:3000/");
    }
});
