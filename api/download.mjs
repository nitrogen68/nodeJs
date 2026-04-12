// api/download.mjs
import { snapsave } from "snapsave-media-downloader";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";

/**
 * [SISTEM DETEKTIF X/TWITTER]
 * Menggunakan OEmbed resmi Twitter (Gratis & Tanpa API Key)
 */
async function getXMetadata(url) {
  console.log("🔍 [X-DEBUG] Mengambil metadata X...");
  try {
    const res = await fetch(`https://publish.twitter.com/oembed?url=${encodeURIComponent(url)}`);
    const data = await res.json();
    if (data && data.author_name) {
      console.log("✅ [X-DEBUG] Berhasil:", data.author_name);
      return data.author_name; 
    }
  } catch (e) {
    console.error("⚠️ [X-DEBUG] Gagal:", e.message);
  }
  return null;
}

/**
 * [SISTEM DETEKTIF TIKTOK]
 * Menggunakan TikWM API (Menghindari 403 Forbidden di Vercel)
 */
async function getTikTokMetadata(url) {
  console.log("--------------------------------------------------");
  console.log("🔍 [TT-DEBUG] Mengambil Metadata via TikWM API...");
  try {
    const apiUrl = `https://www.tikwm.com/api/?url=${encodeURIComponent(url)}`;
    const response = await fetch(apiUrl, {
      headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' }
    });
    const result = await response.json();

    if (result?.data) {
      const author = result.data.author.nickname || result.data.author.unique_id;
      console.log("✅ [TT-DEBUG] Berhasil:", author);
      return `${author} (@${result.data.author.unique_id})`;
    }
  } catch (e) {
    console.error("❌ [TT-DEBUG] Error API TikTok:", e.message);
  }
  return null;
}

/**
 * [SISTEM DETEKTIF FACEBOOK & INSTAGRAM]
 * Mengambil nama profil dari Meta Tags (og:title, og:description)
 */
async function getProfileName(url) {
  console.log("--------------------------------------------------");
  const platform = url.includes('instagram.com') ? 'IG' : 'FB';
  console.log(`🔍 [${platform}-DEBUG] Investigasi URL:`, url);
  
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4000);

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
        'Accept-Language': 'id-ID,id;q=0.9'
      }
    });
    
    if (response.url.includes('login.php') || response.url.includes('checkpoint')) {
      console.log(`⚠️ [${platform}-DEBUG] GAGAL: Terdeteksi blokir/Redirect ke Login`);
      return null;
    }

    const html = await response.text();
    clearTimeout(timeoutId);

    const ogTitle = html.match(/<meta property="og:title" content="(.*?)"/i);
    const ogDesc = html.match(/<meta property="og:description" content="(.*?)"/i);
    const twTitle = html.match(/<meta name="twitter:title" content="(.*?)"/i);

    let rawPool = [
      ogTitle ? ogTitle[1] : "",
      twTitle ? twTitle[1] : "",
      ogDesc ? ogDesc[1] : ""
    ].join(' | ');

    let cleanPool = rawPool.replace(/&#\w+;/g, ' ').replace(/\s+/g, ' ');
    const parts = cleanPool.split(/[|]|\s-\s|\s·\s/).map(p => p.trim());

    const candidates = parts.filter(p => {
      const isStats = /tayangan|tanggapan|views|reactions|\d+\s?rb|\d+\s?jt|\d+\s?K|\d+\s?M/i.test(p);
      const isGeneric = /facebook|instagram|video|reels|watch|shared|post|photo/i.test(p);
      const isShort = p.length < 3;
      return !isStats && !isGeneric && !isShort;
    });

    if (candidates.length > 0) {
      const result = candidates[candidates.length - 1];
      console.log(`✅ [${platform}-DEBUG] BERHASIL AMBIL NAMA:`, result);
      return result;
    }
  } catch (e) {
    console.error(`❌ [${platform}-DEBUG] ERROR:`, e.message);
  }
  return null; 
}

/**
 * Fungsi untuk mengunggah ke Videy melalui file lokal sementara
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
    const cmd = `curl -s -X POST https://videy.co/api/upload -H "Origin: https://videy.co" -H "Referer: https://videy.co/" -A "Mozilla/5.0" -F "file=@${tempFilePath};type=video/mp4"`;

    const result = JSON.parse(execSync(cmd).toString());
    if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
    return result?.id ? `https://videy.co/v/?id=${result.id}` : null;
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

    // Step 1: Deteksi Platform
    const isFB = url.includes('facebook.com') || url.includes('fb.com');
    const isTT = url.includes('tiktok.com');
    const isX = url.includes('twitter.com') || url.includes('x.com');
    const isIG = url.includes('instagram.com');

    console.log("📥 [1] Memulai ekstraksi paralel...");
    
    // Pilih fungsi metadata sesuai platform
    let metadataPromise;
    if (isFB || isIG) metadataPromise = getProfileName(url);
    else if (isTT) metadataPromise = getTikTokMetadata(url);
    else if (isX) metadataPromise = getXMetadata(url);
    else metadataPromise = Promise.resolve(null);

    const [snapResult, profileName] = await Promise.all([
        snapsave(url),
        metadataPromise
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

    // Step 3: Penentuan Judul & Fallback Label
    let platformLabel = "Media";
    if (isFB) platformLabel = "FB Video";
    else if (isTT) platformLabel = "TikTok";
    else if (isX) platformLabel = "X Video";
    else if (isIG) platformLabel = "Instagram";

    let finalTitle = profileName;

    if (!finalTitle) {
      const urlParts = url.split('?')[0].split('/');
      const lastId = urlParts.filter(p => p.length > 4).pop() || "Content";
      finalTitle = `${platformLabel} ${lastId.substring(0, 8)}`;
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
