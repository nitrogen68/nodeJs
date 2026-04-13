// api/download.mjs
import { snapsave } from "snapsave-media-downloader";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";

// --- FUNGSI METADATA (Tetap seperti sebelumnya) ---

async function getXMetadata(url) {
  try {
    const res = await fetch(`https://publish.twitter.com/oembed?url=${encodeURIComponent(url)}`);
    const data = await res.json();
    return data?.author_name || null;
  } catch (e) { return null; }
}

async function getTikTokMetadata(url) {
  try {
    const apiUrl = `https://www.tikwm.com/api/?url=${encodeURIComponent(url)}`;
    const response = await fetch(apiUrl);
    const result = await response.json();
    if (result?.data) {
      const author = result.data.author.nickname || result.data.author.unique_id;
      return `${author} (@${result.data.author.unique_id})`;
    }
  } catch (e) { return null; }
  return null;
}

async function getProfileName(url) {
  try {
    const response = await fetch(url, { headers: { 'User-Agent': 'facebookexternalhit/1.1' } });
    const html = await response.text();
    const ogTitle = html.match(/<meta property="og:title" content="(.*?)"/i);
    const ogDesc = html.match(/<meta property="og:description" content="(.*?)"/i);
    let cleanPool = ((ogTitle ? ogTitle[1] : "") + " " + (ogDesc ? ogDesc[1] : "")).replace(/&quot;/g, '"').replace(/&#\w+;/g, ' ');
    const parts = cleanPool.split(/[|]|\s-\s|\s·\s|\spada\s|\son\s/i).map(p => p.trim());
    const candidates = parts.filter(p => !(/\d{4}|Jan|Feb|Mar|Apr|Mei|Jun|Jul|Agu|Sep|Okt|Nov|Des/i.test(p)) && p.length > 2);
    return candidates.length > 0 ? candidates[url.includes('instagram.com') ? 0 : candidates.length - 1].replace(/[":].*$/, '') : null;
  } catch (e) { return null; }
}

// --- FUNGSI DOWNLOADER (FALLBACK STRATEGY) ---

/**
 * Fallback 2: yt-dlp (Eksekusi Binary)
 */
async function tryYtDlp(url) {
  console.log("🔄 [Fallback-2] Mencoba yt-dlp...");
  try {
    // -g untuk get URL, -f untuk format terbaik
    const cmd = `yt-dlp -g --format "best" --no-check-certificates "${url}"`;
    const videoUrl = execSync(cmd).toString().trim();
    return videoUrl || null;
  } catch (e) {
    console.error("❌ [yt-dlp] Gagal:", e.message);
    return null;
  }
}

/**
 * Fallback 3: Cobalt (API Request)
 */
async function tryCobalt(url) {
  console.log("🔄 [Fallback-3] Mencoba Cobalt API...");
  try {
    const response = await fetch("https://api.cobalt.tools/api/json", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({ url: url, videoQuality: "720" })
    });
    const data = await response.json();
    return data?.url || null; // Cobalt mengembalikan direct link di property 'url'
  } catch (e) {
    console.error("❌ [Cobalt] Gagal:", e.message);
    return null;
  }
}

/**
 * Fungsi Upload ke Videy
 */
async function uploadToVidey(remoteUrl) {
  const tempFilePath = path.join(os.tmpdir(), `video_${Date.now()}.mp4`);
  try {
    const response = await fetch(remoteUrl);
    const buffer = Buffer.from(await response.arrayBuffer());
    fs.writeFileSync(tempFilePath, buffer);
    const cmd = `curl -s -X POST https://videy.co/api/upload -F "file=@${tempFilePath};type=video/mp4"`;
    const result = JSON.parse(execSync(cmd).toString());
    if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
    return result?.id ? `https://videy.co/v/?id=${result.id}` : null;
  } catch (error) {
    if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
    return null;
  }
}

// ============================================
// MAIN HANDLER
// ============================================
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { url } = req.body;
  if (!url) return res.status(400).json({ success: false, error: "URL kosong" });

  try {
    const isFB = url.includes('facebook.com') || url.includes('fb.com');
    const isTT = url.includes('tiktok.com');
    const isX = url.includes('twitter.com') || url.includes('x.com');
    const isIG = url.includes('instagram.com');

    // JALANKAN SCRAPING NAMA (Paralel dengan Downloader pertama)
    let metadataPromise;
    if (isFB || isIG) metadataPromise = getProfileName(url);
    else if (isTT) metadataPromise = getTikTokMetadata(url);
    else if (isX) metadataPromise = getXMetadata(url);
    else metadataPromise = Promise.resolve(null);

    let finalVideoUrl = null;
    let methodUsed = "";

    // --- STRATEGI FALLBACK BERLAPIS ---

    // 1. Coba Snapsave
    console.log("📥 [Step 1] Mencoba Snapsave...");
    const snapResult = await snapsave(url);
    if (snapResult?.success && snapResult.data?.media?.[0]?.url) {
      finalVideoUrl = snapResult.data.media[0].url;
      methodUsed = "Snapsave";
    } 

    // 2. Jika Snapsave Gagal, Coba yt-dlp
    if (!finalVideoUrl) {
      finalVideoUrl = await tryYtDlp(url);
      if (finalVideoUrl) methodUsed = "yt-dlp";
    }

    // 3. Jika yt-dlp Gagal, Coba Cobalt
    if (!finalVideoUrl) {
      finalVideoUrl = await tryCobalt(url);
      if (finalVideoUrl) methodUsed = "Cobalt";
    }

    // FINAL CHECK: Jika semua metode gagal
    if (!finalVideoUrl) {
      return res.status(404).json({ 
        success: false, 
        error: "Semua metode ekstraksi gagal",
        detail: "Snapsave, yt-dlp, dan Cobalt tidak dapat menjangkau media ini." 
      });
    }

    console.log(`✅ Berhasil menggunakan: ${methodUsed}`);

    // UPLOAD KE VIDEY
    const videyLink = await uploadToVidey(finalVideoUrl);
    if (!videyLink) return res.status(500).json({ success: false, error: "Gagal upload ke Videy" });

    // AMBIL HASIL METADATA
    const profileName = await metadataPromise;
    let platformLabel = isFB ? "FB Video" : isTT ? "TikTok" : isX ? "X Video" : isIG ? "Instagram" : "Media";

    let finalTitle = profileName || `${platformLabel} ${url.split('/').pop().substring(0, 8)}`;

    return res.status(200).json({
      success: true,
      data: {
        title: finalTitle,
        videyUrl: videyLink,
        method: methodUsed
      }
    });

  } catch (err) {
    console.error("💥 Global error:", err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
}
