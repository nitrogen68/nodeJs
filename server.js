import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { snapsave } from "snapsave-media-downloader";
import FormData from "form-data"; // Pastikan ini ada di package.json
import { exec } from "child_process";
import os from "os";

const app = express();
app.use(express.json());

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Sajikan file statis
app.use(express.static(__dirname));

// --- HELPER: UPLOAD KE VIDEY ---
async function uploadToVidey(videoUrl) {
    try {
        const response = await fetch(videoUrl);
        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        const form = new FormData();
        form.append('file', buffer, {
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
        console.error("❌ Videy Error:", e.message);
        return null;
    }
}

// --- ENDPOINT ---
app.post("/api/download", async (req, res) => {
    try {
        const { url } = req.body;
        if (!url) return res.status(400).json({ success: false, error: "URL kosong" });

        const result = await snapsave(url);
        if (!result?.data?.media?.length) return res.status(404).json({ success: false, error: "Media tidak ditemukan" });

        const rawUrl = result.data.media[0].url;
        const videyLink = await uploadToVidey(rawUrl);

        if (!videyLink) throw new Error("Gagal upload ke Videy");

        res.json({
            success: true,
            data: {
                title: result.data.description || "Video Content",
                videyUrl: videyLink
            }
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Root route
app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "index.html"));
});

// --- VERCEL EXPORT (PENTING!) ---
export default app;

// --- LOCAL RUN (Hanya jalan jika bukan di Vercel) ---
if (process.env.NODE_ENV !== 'production') {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => {
        console.log(`✅ Local server: http://localhost:${PORT}`);
        if (os.platform() === "android") exec("termux-open-url http://localhost:3000/");
    });
}
