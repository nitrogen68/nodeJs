// api/download.mjs
import { snapsave } from "snapsave-media-downloader";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";

/**
 * [TAMBAHAN] Fungsi untuk mengambil nama profil Facebook via Scraping Meta Tag
 */
async function getProfileName(url) {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'facebookexternalhit/1.1'
      }
    });
    
    const html = await response.text();
    clearTimeout(timeoutId);

    const match = html.match(/<meta property="og:title" content="(.*?)"/);
    
    if (match && match[1]) {
      const fullTitle = match[1];
      console.log("🔍 [FB-DEBUG] Raw OG Title:", fullTitle);

      // 1. Pecah berdasarkan karakter pipa "|"
      const parts = fullTitle.split('|');

      if (parts.length > 0) {
        // 2. Ambil bagian paling terakhir (biasanya Nama Profil di FB Reels/Video)
        let lastPart = parts[parts.length - 1].trim();

        // 3. Bersihkan entitas HTML jika masih ada (seperti &#xa0; atau &amp;)
        // Kita gunakan regex sederhana untuk membersihkan kode-kode unik tersebut
        let cleanName = lastPart
          .replace(/&#\w+;/g, ' ') // Hilangkan entitas seperti &#xa0;
          .replace(/\s+/g, ' ')    // Rapikan spasi ganda
          .split(' - ')[0]         // Jaga-jaga jika ada " - Reels"
          .trim();

        // 4. Validasi: Jika hasil "cleanName" malah berisi statistik, ambil bagian sebelumnya
        if (/tayangan|tanggapan|views|reactions/i.test(cleanName) && parts.length > 1) {
             cleanName = parts[parts.length - 2].trim();
        }

        console.log("✅ [FB-DEBUG] Nama Berhasil Diambil:", cleanName);
        return cleanName;
      }
    }
  } catch (e) {
    console.error("⚠️ Gagal ambil nama profil:", e.message);
  }
  return "Facebook User";
}


/**
 * Fungsi untuk mengunggah ke Videy dengan cara mengunduh ke lokal sementara
 */
async function uploadToVidey(remoteUrl) {
  const tempFilePath = path.join(os.tmpdir(), `video_${Date.now()}.mp4`);

  try {
    console.log("⏳ [Step 10.1] Mengunduh video ke penyimpanan sementara...");
    const response = await fetch(remoteUrl);
    if (!response.ok) throw new Error(`Gagal mengunduh video: ${response.statusText}`);
    
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    fs.writeFileSync(tempFilePath, buffer);

    console.log("⏳ [Step 10.2] Mengunggah file lokal ke Videy...");
    const cmd = `
    curl -X POST https://videy.co/api/upload \
    -H "Origin: https://videy.co" \
    -H "Referer: https://videy.co/" \
    -A "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" \
    -F "file=@${tempFilePath};type=video/mp4"
    `;

    const result = execSync(cmd).toString();
    const json = JSON.parse(result);

    if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
    return json?.id ? `https://videy.co/v/?id=${json.id}` : null;

  } catch (error) {
    console.error("❌ Error di uploadToVidey:", error.message);
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
    if (!url) return res.status(400).json({ success: false, error: "URL kosong" });

    // --- PERUBAHAN UTAMA DISINI ---
    // Menjalankan SnapSave dan Ambil Nama Profil secara bersamaan
    console.log("📥 [3] Memulai ekstraksi paralel...");
    const isFB = url.includes('facebook.com') || url.includes('fb.com');

    const [snapResult, profileName] = await Promise.all([
        snapsave(url),
        isFB ? getProfileName(url) : Promise.resolve(null)
    ]);
    // ------------------------------

    if (!snapResult?.success) {
      return res.status(404).json({ 
        success: false, 
        error: snapResult?.error || "Media tidak ditemukan"
      });
    }

    const firstMedia = snapResult.data?.media?.[0];
    const rawUrl = firstMedia?.url;
    
    if (!rawUrl) {
      return res.status(500).json({ success: false, error: "URL video tidak ditemukan" });
    }
    
    console.log("📤 [10] Processing Upload...");
    const videyLink = await uploadToVidey(rawUrl);

    if (!videyLink) {
      return res.status(500).json({ success: false, error: "Gagal upload ke Videy" });
    }

    // Mengirim respon dengan Judul yang diprioritaskan dari Nama Profil
    return res.status(200).json({
      success: true,
      data: {
        // Fallback: Nama Profil > Deskripsi SnapSave > Default
        title: profileName || snapResult.data?.description || "Facebook Video",
        videyUrl: videyLink,
        quality: firstMedia?.resolution || "unknown"
      }
    });

  } catch (err) {
    console.error("💥 Global error:", err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
}
