// api/download.mjs
import { snapsave } from "snapsave-media-downloader";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";

/**
 * Fungsi untuk mengunggah ke Videy dengan cara mengunduh ke lokal sementara
 */
async function uploadToVidey(remoteUrl) {
  // Membuat path file sementara di folder /tmp (standar untuk serverless/Vercel)
  const tempFilePath = path.join(os.tmpdir(), `video_${Date.now()}.mp4`);

  try {
    console.log("⏳ [Step 10.1] Mengunduh video ke penyimpanan sementara...");
    
    // 1. Download file dari remote URL ke local temp file
    const response = await fetch(remoteUrl);
    if (!response.ok) throw new Error(`Gagal mengunduh video dari source: ${response.statusText}`);
    
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    fs.writeFileSync(tempFilePath, buffer);

    console.log("⏳ [Step 10.2] Mengunggah file lokal ke Videy...");

    // 2. Jalankan curl menggunakan path file LOKAL (@tempFilePath)
    const cmd = `
    curl -X POST https://videy.co/api/upload \
    -H "Origin: https://videy.co" \
    -H "Referer: https://videy.co/" \
    -A "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" \
    -F "file=@${tempFilePath};type=video/mp4"
    `;

    const result = execSync(cmd).toString();
    const json = JSON.parse(result);

    // 3. Hapus file sementara agar tidak memenuhi disk
    if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);

    return json?.id ? `https://videy.co/v/?id=${json.id}` : null;

  } catch (error) {
    console.error("❌ Error di uploadToVidey:", error.message);
    // Pastikan file temp dihapus jika terjadi error
    if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
    return null;
  }
}

// ============================================
// MAIN HANDLER
// ============================================
export default async function handler(req, res) {
  console.log("🔥 [1] Handler called - Method:", req.method);
  
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { url } = req.body;
    
    if (!url) {
      return res.status(400).json({ success: false, error: "URL kosong" });
    }

    // Step 1: Panggil snapsave
    console.log("📥 [3] Calling snapsave...");
    const result = await snapsave(url);
    
    if (!result?.success) {
      return res.status(404).json({ 
        success: false, 
        error: result?.error || "Media tidak ditemukan"
      });
    }

    const mediaArray = result.data?.media;
    if (!Array.isArray(mediaArray) || mediaArray.length === 0) {
      return res.status(404).json({ 
        success: false, 
        error: "Media tidak ditemukan dalam response"
      });
    }

    const firstMedia = mediaArray[0];
    const rawUrl = firstMedia?.url;
    
    if (!rawUrl) {
      return res.status(500).json({ success: false, error: "URL video tidak ditemukan" });
    }
    
    // Step 4: Upload ke Videy (Sekarang menggunakan fungsi yang sudah diperbaiki)
    console.log("📤 [10] Processing Upload...");
    const videyLink = await uploadToVidey(rawUrl);

    if (!videyLink) {
      return res.status(500).json({ 
        success: false, 
        error: "Gagal upload ke Videy (Cek log server)" 
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        title: result.data?.description || "Video Content",
        videyUrl: videyLink,
        quality: firstMedia?.resolution || "unknown"
      }
    });
  } catch (err) {
    console.error("💥 Global error:", err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
}
