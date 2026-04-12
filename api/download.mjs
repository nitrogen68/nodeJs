// api/download.mjs
import { snapsave } from "snapsave-media-downloader";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";

/**
 * [SISTEM DETEKTIF PROFIL]
 * Mengambil nama profil dari og:title, og:description, dan twitter:title
 */
async function getProfileName(url) {
  console.log("--------------------------------------------------");
  console.log("🔍 [FB-DEBUG] Investigasi URL:", url);
  
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4000); // Batas waktu 4 detik

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
        'Accept-Language': 'id-ID,id;q=0.9'
      }
    });
    
    console.log("🔍 [FB-DEBUG] HTTP Status:", response.status);
    
    // Proteksi jika kena redirect ke halaman login
    if (response.url.includes('login.php') || response.url.includes('checkpoint')) {
      console.log("⚠️ [FB-DEBUG] GAGAL: Terdeteksi blokir/Redirect ke Login");
      return null;
    }

    const html = await response.text();
    clearTimeout(timeoutId);

    // Ambil semua kemungkinan sumber nama dari meta tags
    const ogTitle = html.match(/<meta property="og:title" content="(.*?)"/i);
    const ogDesc = html.match(/<meta property="og:description" content="(.*?)"/i);
    const twTitle = html.match(/<meta name="twitter:title" content="(.*?)"/i);

    console.log("🔍 [FB-DEBUG] OG-Title:", ogTitle ? ogTitle[1] : "KOSONG");
    console.log("🔍 [FB-DEBUG] OG-Desc:", ogDesc ? ogDesc[1] : "KOSONG");

    // Gabungkan semua teks untuk dianalisis
    let rawPool = [
      ogTitle ? ogTitle[1] : "",
      twTitle ? twTitle[1] : "",
      ogDesc ? ogDesc[1] : ""
    ].join(' | ');

    // 1. Dekode entitas HTML (&#xa0; dll) dan bersihkan spasi ganda
    let cleanPool = rawPool.replace(/&#\w+;/g, ' ').replace(/\s+/g, ' ');
    console.log("🔍 [FB-DEBUG] Decoded Pool:", cleanPool);

    // 2. Pecah berdasarkan pemisah umum Facebook (pipa, dash, dot)
    const parts = cleanPool.split(/[|]|\s-\s|\s·\s/).map(p => p.trim());

    // 3. FILTER: Buang potongan teks yang merupakan statistik atau info generic
    const candidates = parts.filter(p => {
      const isStats = /tayangan|tanggapan|views|reactions|\d+\s?rb|\d+\s?jt|\d+\s?K|\d+\s?M/i.test(p);
      const isGeneric = /facebook|video|reels|watch|shared/i.test(p);
      const isShort = p.length < 3; // Nama orang jarang cuma 2 huruf
      return !isStats && !isGeneric && !isShort;
    });

    console.log("🔍 [FB-DEBUG] Kandidat Akhir:", JSON.stringify(candidates));

    if (candidates.length > 0) {
      // Ambil kandidat paling belakang (biasanya letak nama profil di Reels)
      const result = candidates[candidates.length - 1];
      console.log("✅ [FB-DEBUG] BERHASIL AMBIL NAMA:", result);
      return result;
    }
  } catch (e) {
    if (e.name === 'AbortError') console.error("❌ [FB-DEBUG] ERROR: Timeout tercapai.");
    else console.error("❌ [FB-DEBUG] ERROR:", e.message);
  }

  console.log("⚠️ [FB-DEBUG] Gagal mendapatkan nama dari metadata.");
  return null; 
}

/**
 * Fungsi untuk mengunggah ke Videy dengan cara mengunduh ke lokal sementara
 */
async function uploadToVidey(remoteUrl) {
  const tempFilePath = path.join(os.tmpdir(), `video_${Date.now()}.mp4`);

  try {
    console.log("⏳ [Step 10.1] Mengunduh video ke /tmp...");
    const response = await fetch(remoteUrl);
    if (!response.ok) throw new Error(`Gagal download: ${response.statusText}`);
    
    const buffer = Buffer.from(await response.arrayBuffer());
    fs.writeFileSync(tempFilePath, buffer);

    console.log("⏳ [Step 10.2] Mengunggah ke Videy API...");
    const cmd = `
    curl -s -X POST https://videy.co/api/upload \
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
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const { url } = req.body;
    if (!url) return res.status(400).json({ success: false, error: "URL kosong" });

    // Step 1: Jalankan SnapSave & Scraping Nama secara PARALEL
    console.log("📥 [1] Memulai ekstraksi paralel...");
    const isFB = url.includes('facebook.com') || url.includes('fb.com');

    const [snapResult, profileName] = await Promise.all([
        snapsave(url),
        isFB ? getProfileName(url) : Promise.resolve(null)
    ]);

    if (!snapResult?.success) {
      return res.status(404).json({ success: false, error: "SnapSave gagal mengambil video" });
    }

    const firstMedia = snapResult.data?.media?.[0];
    const rawUrl = firstMedia?.url;
    
    if (!rawUrl) return res.status(500).json({ success: false, error: "URL video tidak ditemukan" });
    
    // Step 2: Upload ke Videy
    const videyLink = await uploadToVidey(rawUrl);
    if (!videyLink) return res.status(500).json({ success: false, error: "Gagal upload ke Videy" });

    // Step 3: Penentuan Judul (Karena SnapSave tidak mengembalikan metadata)
    let finalTitle = "Facebook Media";

    if (profileName) {
      finalTitle = profileName;
    } else {
      // FALLBACK: Jika scraping nama profil gagal, ambil ID dari URL 
      // agar tidak semua history bernama "Facebook User"
      const urlParts = url.split('/');
      const lastId = urlParts.filter(p => p.length > 5).pop() || "Video";
      finalTitle = `FB Video ${lastId.substring(0, 8)}`;
    }

    return res.status(200).json({
      success: true,
      data: {
        title: finalTitle,
        videyUrl: videyLink,
        quality: firstMedia?.resolution || "HD"
      }
    });

  } catch (err) {
    console.error("💥 Global error:", err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
}
