// api/download.mjs
import { snapsave } from "snapsave-media-downloader";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";

async function expandUrl(url) {
  try {
    const response = await fetch(url, { method: 'HEAD', redirect: 'follow' });
    return response.url;
  } catch (e) { return url; }
}

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
    const isIG = url.includes('instagram.com');
    const response = await fetch(url, { headers: { 'User-Agent': 'facebookexternalhit/1.1' } });
    const html = await response.text();
    const ogTitle = html.match(/<meta property="og:title" content="(.*?)"/i);
    const ogDesc = html.match(/<meta property="og:description" content="(.*?)"/i);
    let cleanPool = ((ogTitle ? ogTitle[1] : "") + " " + (ogDesc ? ogDesc[1] : "")).replace(/&quot;/g, '"').replace(/&#\w+;/g, ' ').replace(/\s+/g, ' ');
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
 * [FIXED] Extraction via VxTwitter API + Clean Text Caption
 */
async function tryVxTwitter(url) {
  try {
    const tweetIdMatch = url.match(/status\/(\d+)/);
    if (!tweetIdMatch) return null;
    
    const apiUrl = `https://api.vxtwitter.com/Twitter/status/${tweetIdMatch[1]}`;
    const response = await fetch(apiUrl);
    const json = await response.json();
    
    if (json.mediaURLs) {
        const videos = json.mediaURLs.filter(link => link.includes('.mp4'));
        
        if (videos.length > 0) {
            // 1. Ambil teks asli tweet
            let rawText = json.text || "Video";
            
            // 2. Bersihkan teks dari link bawaan Twitter (https://t.co/...)
            let cleanText = rawText.replace(/https?:\/\/\S+/g, '').trim();
            
            // 3. Batasi panjang karakter agar tidak merusak UI Card (misal: 45 karakter)
            if (cleanText.length > 45) {
                cleanText = cleanText.substring(0, 45) + "...";
            }
            
            // Jika tweet hanya berisi link tanpa teks sama sekali
            if (!cleanText) cleanText = "Video";

            return { 
                urls: videos, 
                title: `@${json.user_screen_name} - ${cleanText}` 
            };
        }
    }
  } catch (e) { return null; }
  return null;
}


async function tryTikWMVideo(url) {
  try {
    const res = await fetch(`https://www.tikwm.com/api/?url=${encodeURIComponent(url)}`);
    const json = await res.json();
    return json?.data?.play || null; 
  } catch (e) { return null; }
}

async function tryCobalt(url) {
  const instances = ["https://api.vxtok.com/api/json", "https://cobalt.hyonsu.com/api/json", "https://api.cobalt.tools/api/json"];
  for (const apiUrl of instances) {
    try {
      const res = await fetch(apiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify({ url, videoQuality: "720" })
      });
      const data = await res.json();
      if (data?.url) return data.url;
    } catch (e) { continue; }
  }
  return null;
}

async function uploadToVidey(remoteUrl) {
  const tempFilePath = path.join(os.tmpdir(), `vid_${Date.now()}_${Math.floor(Math.random() * 1000)}.mp4`);
  try {
    console.log("⏳ [Videy] Downloading from source...");
    const response = await fetch(remoteUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
    });
    
    if (!response.ok) throw new Error(`Source status: ${response.status}`);

    const buffer = Buffer.from(await response.arrayBuffer());
    fs.writeFileSync(tempFilePath, buffer);

    console.log("⏳ [Videy] Uploading to Videy...");
    const cmd = `curl -s -X POST https://videy.co/api/upload -H "Origin: https://videy.co" -H "Referer: https://videy.co/" -F "file=@${tempFilePath};type=video/mp4"`;

    const result = JSON.parse(execSync(cmd).toString());
    if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
    
    return result?.id ? `https://videy.co/v/?id=${result.id}` : null;
  } catch (error) {
    console.error("❌ [Videy Error]", error.message);
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
    const expandedUrl = await expandUrl(url);
    const isFB = expandedUrl.includes('facebook.com') || expandedUrl.includes('fb.com');
    const isTT = expandedUrl.includes('tiktok.com');
    const isX  = expandedUrl.includes('twitter.com') || expandedUrl.includes('x.com');
    const isIG = expandedUrl.includes('instagram.com');

    let metadataPromise;
    if (isFB || isIG) metadataPromise = getProfileName(expandedUrl);
    else if (isTT) metadataPromise = getTikTokMetadata(expandedUrl);
    else if (isX)  metadataPromise = getXMetadata(expandedUrl);
    else metadataPromise = Promise.resolve(null);

    let finalVideoUrls = []; // SEKARANG ARRAY
    let methodUsed = "";
    let forceTitle = null;

    // STEP 1: Snapsave
    try {
        const snap = await snapsave(expandedUrl);
        if (snap?.success && snap.data?.media?.length > 0) {
            // Ambil semua URL dari Snapsave
            finalVideoUrls = snap.data.media.map(m => m.url).filter(u => u);
            methodUsed = "Snapsave";
        }
    } catch (e) {}

    // STEP 2: TikWM (TikTok)
    if (finalVideoUrls.length === 0 && isTT) {
        const ttUrl = await tryTikWMVideo(expandedUrl);
        if (ttUrl) { finalVideoUrls = [ttUrl]; methodUsed = "TikWM Engine"; }
    }

    // STEP 3: VxTwitter (X)
    if (finalVideoUrls.length === 0 && isX) {
        const vx = await tryVxTwitter(expandedUrl);
        if (vx && vx.urls && vx.urls.length > 0) {
            finalVideoUrls = vx.urls; // Ambil semua array URLs
            forceTitle = vx.title;
            methodUsed = "VxTwitter Bypass";
        }
    }

    // STEP 4: Cobalt (Fallback Universal)
    if (finalVideoUrls.length === 0) {
        const cobUrl = await tryCobalt(expandedUrl);
        if (cobUrl) { finalVideoUrls = [cobUrl]; methodUsed = "Cobalt System"; }
    }

    if (finalVideoUrls.length === 0) {
      return res.status(404).json({ success: false, error: "Gagal mengekstrak video dari semua metode." });
    }

    // UPLOAD PROSES (Mendukung Multi-Video)
    const videyLinks = [];
    for (const vUrl of finalVideoUrls) {
        const uploadedLink = await uploadToVidey(vUrl);
        if (uploadedLink) videyLinks.push(uploadedLink);
    }

    if (videyLinks.length === 0) {
        return res.status(500).json({ 
            success: false, 
            error: "Gagal upload ke Videy",
            debug: { method: methodUsed }
        });
    }

    const profileName = await metadataPromise;
    const platformLabel = isFB ? "FB" : isTT ? "TikTok" : isX ? "X" : isIG ? "IG" : "Media";
    const finalTitle = forceTitle || profileName || `${platformLabel} Video ${expandedUrl.split('/').filter(p => p.length > 4).pop()?.substring(0, 8)}`;

    return res.status(200).json({
      success: true,
      data: { 
        title: finalTitle, 
        videyUrls: videyLinks, // DIKIRIM SEBAGAI ARRAY
        method: methodUsed 
      }
    });

  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}
