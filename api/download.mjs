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
  console.log("🔍 [FB-DEBUG] Memulai fetch ke:", url);
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000); // Naikkan ke 5 detik untuk debug

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        // Coba gunakan User-Agent bot agar dianggap sebagai crawler
        'User-Agent': 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
        'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7'
      }
    });
    
    console.log("🔍 [FB-DEBUG] HTTP Status:", response.status, response.statusText);
    
    // Cek apakah di-redirect ke halaman login
    if (response.url.includes('login.php') || response.url.includes('checkpoint')) {
      console.log("⚠️ [FB-DEBUG] Terdeteksi REDIRECT ke halaman login/checkpoint!");
      return "Facebook User (Protected)";
    }

    const html = await response.text();
    clearTimeout(timeoutId);

    // Log 500 karakter pertama HTML untuk melihat apakah isinya benar atau cuma script kosong
    console.log("🔍 [FB-DEBUG] Cuplikan HTML (500 char):", html.substring(0, 500).replace(/\n/g, ' '));

    // Regex yang lebih fleksibel (mendukung kutipan tunggal atau ganda)
    const match = html.match(/<meta\s+property=["']og:title["']\s+content=["'](.*?)["']/i);
    
    if (match && match[1]) {
      console.log("✅ [FB-DEBUG] Match found:", match[1]);
      const cleanName = match[1].split(' - ')[0].split(' | ')[0].split(' was ')[0].trim();
      return cleanName;
    } else {
      console.log("❌ [FB-DEBUG] Meta og:title TIDAK ditemukan di HTML.");
      
      // Coba cari alternatif: tag <title>
      const titleTag = html.match(/<title>(.*?)<\/title>/i);
      if (titleTag && titleTag[1]) {
        console.log("🔍 [FB-DEBUG] Alternatif ditemukan di tag <title>:", titleTag[1]);
        return titleTag[1].split(' | ')[0].trim();
      }
    }
  } catch (e) {
    if (e.name === 'AbortError') {
      console.error("❌ [FB-DEBUG] Error: Request Timeout (FB terlalu lama merespon)");
    } else {
      console.error("❌ [FB-DEBUG] Error Detail:", e.message);
    }
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
