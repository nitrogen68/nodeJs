// api/download.mjs
import { snapsave } from "snapsave-media-downloader";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";

/**
 * [UTILITY] URL Expander
 * Menangani link pendek (share/r/, vt.tiktok, bit.ly) agar scraper mendapatkan URL asli.
 */
async function expandUrl(url) {
  try {
    const response = await fetch(url, { method: 'HEAD', redirect: 'follow' });
    return response.url;
  } catch (e) {
    return url;
  }
}

/**
 * [METADATA] X/Twitter OEmbed
 */
async function getXMetadata(url) {
  try {
    const res = await fetch(`https://publish.twitter.com/oembed?url=${encodeURIComponent(url)}`);
    const data = await res.json();
    return data?.author_name || null;
  } catch (e) { return null; }
}

/**
 * [METADATA] TikTok via TikWM
 */
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

/**
 * [METADATA] FB & Instagram Scraper (Improved Regex)
 */
async function getProfileName(url) {
  try {
    const isIG = url.includes('instagram.com');
    const response = await fetch(url, { headers: { 'User-Agent': 'facebookexternalhit/1.1' } });
    const html = await response.text();
    const ogTitle = html.match(/<meta property="og:title" content="(.*?)"/i);
    const ogDesc = html.match(/<meta property="og:description" content="(.*?)"/i);
    
    let cleanPool = ((ogTitle ? ogTitle[1] : "") + " " + (ogDesc ? ogDesc[1] : ""))
                    .replace(/&quot;/g, '"').replace(/&#\w+;/g, ' ').replace(/\s+/g, ' ');

    // Split berdasarkan pemisah umum dan kata hubung "pada/on/di"
    const parts = cleanPool.split(/\s*\|\s*|\s*-\s*|\s*·\s*|\s+pada\s+|\s+on\s+|\s+di\s+/i).map(p => p.trim());
    const candidates = parts.filter(p => !(/\d{4}|Jan|Feb|Mar|Apr|Mei|Jun|Jul|Agu|Sep|Okt|Nov|Des/i.test(p)) && p.length > 2);
    
    if (candidates.length > 0) {
        let res = isIG ? candidates[0] : candidates[candidates.length - 1];
        res = res.replace(/[":].*$/, '').replace(/[^\w\d._ ]/g, '').trim();
        return isIG ? `@${res.replace(/\s+/g, '')}` : res;
    }
  } catch (e) { return null; }
  return null;
}

/**
 * [DOWNLOADER] TikTok Special via TikWM
 */
async function tryTikWMVideo(url) {
  try {
    const res = await fetch(`https://www.tikwm.com/api/?url=${encodeURIComponent(url)}`);
    const json = await res.json();
    return json?.data?.play || null; 
  } catch (e) { return null; }
}

/**
 * [DOWNLOADER] Cobalt Multi-Instance (FIXED - 2026)
 */
/**
 * [X-SPECIAL] Extraction via VxTwitter API
 * Ini adalah porting dari logika PHP kamu yang berhasil.
 */
async function tryVxTwitter(url) {
  console.log("🔍 [X-DEBUG] Mencoba Jalur Belakang VxTwitter...");
  try {
    // 1. Ambil ID Tweet dari URL
    const tweetIdMatch = url.match(/status\/(\d+)/);
    if (!tweetIdMatch) return null;
    const tweetId = tweetIdMatch[1];

    // 2. Panggil API VxTwitter
    const apiUrl = `https://api.vxtwitter.com/Twitter/status/${tweetId}`;
    const response = await fetch(apiUrl, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
        }
    });

    if (!response.ok) return null;
    const json = await response.json();

    // 3. Cari URL yang berakhiran .mp4 di dalam mediaURLs
    if (json.mediaURLs && json.mediaURLs.length > 0) {
        const videoUrl = json.mediaURLs.find(link => link.includes('.mp4'));
        
        if (videoUrl) {
            console.log("✅ [X-DEBUG] Video ditemukan via VxTwitter!");
            return {
                url: videoUrl,
                title: `@${json.user_screen_name} - ${json.text.substring(0, 30)}...`
            };
        }
    }
  } catch (e) {
    console.error("❌ [X-DEBUG] Gagal via VxTwitter:", e.message);
  }
  return null;
}


/**
 * [CORE] Upload ke Videy
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
    // 0. Perluas URL (Handle Shortlinks)
    console.log("🔍 [0] Memperluas URL...");
    const expandedUrl = await expandUrl(url);

    const isFB = expandedUrl.includes('facebook.com') || expandedUrl.includes('fb.com');
    const isTT = expandedUrl.includes('tiktok.com');
    const isX  = expandedUrl.includes('twitter.com') || expandedUrl.includes('x.com');
    const isIG = expandedUrl.includes('instagram.com');

    // 1. Ambil Metadata secara Paralel
    let metadataPromise;
    if (isFB || isIG) metadataPromise = getProfileName(expandedUrl);
    else if (isTT) metadataPromise = getTikTokMetadata(expandedUrl);
    else if (isX)  metadataPromise = getXMetadata(expandedUrl);
    else metadataPromise = Promise.resolve(null);

    let finalVideoUrl = null;
    let methodUsed = "";

    // 2. Step 1: Snapsave (Utama)
    console.log("📥 [Step 1] Mencoba Snapsave...");
    try {
        const snapResult = await snapsave(expandedUrl);
        if (snapResult?.success && snapResult.data?.media?.[0]?.url) {
            finalVideoUrl = snapResult.data.media[0].url;
            methodUsed = "Snapsave";
        }
    } catch (e) {}

    // 3. Step 2: TikWM (Khusus TikTok)
    if (!finalVideoUrl && isTT) {
        console.log("📥 [Step 2] Mencoba TikWM Engine...");
        finalVideoUrl = await tryTikWMVideo(expandedUrl);
        if (finalVideoUrl) methodUsed = "TikWM Engine";
    }

    // 4. Step 3: Multi-Cobalt (Fallback Terakhir)
    if (!finalVideoUrl) {
        console.log("📥 [Step 3] Mencoba Cobalt System...");
        finalVideoUrl = await tryVxTwitter(expandedUrl);
        if (finalVideoUrl) methodUsed = "tryVxTwitter System";
    }

    // Gagal Total
    if (!finalVideoUrl) {
      return res.status(404).json({ 
        success: false, 
        error: "Semua metode gagal",
        detail: "Link tidak dapat dijangkau oleh Snapsave maupun Cobalt." 
      });
    }

    // 5. Upload ke Videy
    const videyLink = await uploadToVidey(finalVideoUrl);
    if (!videyLink) return res.status(500).json({ success: false, error: "Gagal upload ke Videy" });

    // 6. Penentuan Judul
    const profileName = await metadataPromise;
    const platformLabel = isFB ? "FB Video" : isTT ? "TikTok" : isX ? "X Video" : isIG ? "Instagram" : "Media";
    const finalTitle = profileName || `${platformLabel} ${expandedUrl.split('/').filter(p => p.length > 4).pop()?.substring(0, 8)}`;

    return res.status(200).json({
      success: true,
      data: {
        title: finalTitle,
        videyUrl: videyLink,
        method: methodUsed
      }
    });

  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}
