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
  console.log("--------------------------------------------------");
  console.log("🔍 [FB-DEBUG] Mengecek URL:", url);
  
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4000); // 4 detik

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        // Menggunakan User-Agent Crawler Meta agar lebih dipercaya
        'User-Agent': 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7'
      }
    });
    
    console.log("🔍 [FB-DEBUG] HTTP Status:", response.status);
    console.log("🔍 [FB-DEBUG] Final URL:", response.url); // Cek apakah kena redirect ke login.php

    if (response.url.includes('login.php') || response.url.includes('checkpoint')) {
      console.log("⚠️ [FB-DEBUG] GAGAL: Terdeteksi blokir (Redirect ke Login)");
      return "Facebook User (Blocked)";
    }

    const html = await response.text();
    clearTimeout(timeoutId);

    // 1. Ambil og:title
    const ogMatch = html.match(/<meta property="og:title" content="(.*?)"/i);
    // 2. Ambil twitter:title (Seringkali lebih bersih/langsung nama)
    const twMatch = html.match(/<meta name="twitter:title" content="(.*?)"/i);

    console.log("🔍 [FB-DEBUG] OG-Title Raw:", ogMatch ? ogMatch[1] : "KOSONG");
    console.log("🔍 [FB-DEBUG] TW-Title Raw:", twMatch ? twMatch[1] : "KOSONG");

    // Gabungkan kandidat dari kedua tag tersebut
    let rawContent = "";
    if (ogMatch && ogMatch[1]) rawContent = ogMatch[1];
    else if (twMatch && twMatch[1]) rawContent = twMatch[1];

    if (rawContent) {
      // Dekode entitas HTML (&#xa0; dll)
      let cleanText = rawContent.replace(/&#\w+;/g, ' ').replace(/\s+/g, ' ');
      console.log("🔍 [FB-DEBUG] Decoded Content:", cleanText);

      // Pecah berdasarkan pipa "|" atau dash "-"
      const parts = cleanText.split(/[|]| - /).map(p => p.trim());
      console.log("🔍 [FB-DEBUG] Parts Terdeteksi:", JSON.stringify(parts));

      // Filter: Buang yang berbau statistik
      const candidates = parts.filter(p => {
        const isStats = /tayangan|tanggapan|views|reactions|\d+\s?rb|\d+\s?jt/i.test(p);
        const isFB = /facebook|reels|video/i.test(p);
        return !isStats && !isFB && p.length > 2;
      });

      console.log("🔍 [FB-DEBUG] Candidates Setelah Filter:", JSON.stringify(candidates));

      if (candidates.length > 0) {
        // Nama profil biasanya paling belakang atau paling depan
        // Untuk Reels biasanya paling belakang.
        const result = candidates[candidates.length - 1];
        console.log("✅ [FB-DEBUG] BERHASIL AMBIL NAMA:", result);
        return result;
      }
    } else {
      console.log("❌ [FB-DEBUG] GAGAL: Tidak menemukan Meta Tag Title sama sekali.");
      // Cek apakah ada script JSON-LD (Opsional, tapi ini log saja dulu)
      if (html.includes('entry_data')) console.log("🔍 [FB-DEBUG] Info: Ada data JSON di HTML tapi tidak ter-parse.");
    }

  } catch (e) {
    if (e.name === 'AbortError') console.error("❌ [FB-DEBUG] ERROR: Timeout 4 detik tercapai.");
    else console.error("❌ [FB-DEBUG] ERROR:", e.message);
  }

  console.log("⚠️ [FB-DEBUG] Fallback: Mengembalikan 'Facebook User'");
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
