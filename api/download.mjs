// api/download.mjs
import { snapsave } from "snapsave-media-downloader";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";

/**
 * [UTILITY] URL Expander
 */
async function expandUrl(url) {
  try {
    const response = await fetch(url, { method: 'HEAD', redirect: 'follow' });
    return response.url;
  } catch (e) { return url; }
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
 * [METADATA] FB & Instagram Scraper
 */
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
 * [DOWNLOADER] X/Twitter via VxTwitter (Jalan Belakang)
 */
async function tryVxTwitter(url) {
  try {
    const tweetIdMatch = url.match(/status\/(\d+)/);
    if (!tweetIdMatch) return null;
    const apiUrl = `https://api.vxtwitter.com/Twitter/status/${tweetIdMatch[1]}`;
    const response = await fetch(apiUrl);
    const json = await response.json();
    if (json.mediaURLs) {
        const video = json.mediaURLs.find(link => link.includes('.mp4'));
        return video ? { url: video, title: `@${json.user_screen_name}` } : null;
    }
  } catch (e) { return null; }
}

/**
 * [DOWNLOADER] TikTok via TikWM
 */
async function tryTikWMVideo(url) {
  try {
    const res = await fetch(`https://www.tikwm.com/api/?url=${encodeURIComponent(url)}`);
    const json = await res.json();
    return json?.data?.play || null; 
  } catch (e) { return null; }
}

/**
 * [DOWNLOADER] Multi-Instance Cobalt
 */
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

/**
 * [CORE] Upload ke Videy (FIXED HEADERS)
 */
async function uploadToVidey(remoteUrl) {
  const tempFilePath = path.join(os.tmpdir(), `vid_${Date.now()}.mp4`);
  try {
    console.log("⏳ [Videy] Downloading from source...");
    // Tambahkan User-Agent agar tidak kena 403 Forbidden oleh CDNs (FB/X/IG)
    const response = await fetch(remoteUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
    });
    
    if (!response.ok) throw new Error(`Source status: ${response.status}`);

    const buffer = Buffer.from(await response.arrayBuffer());
    fs.writeFileSync(tempFilePath, buffer);

    console.log("⏳ [Videy] Uploading to Videy...");
    // Gunakan curl dengan penyamaran yang lebih baik
    const cmd = `curl -s -X POST https://videy.co/api/upload \
      -H "Origin: https://videy.co" \
      -H "Referer: https://videy.co/" \
      -F "file=@${tempFilePath};type=video/mp4"`;

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

    let finalVideoUrl = null;
    let methodUsed = "";
    let forceTitle = null;

    // STEP 1: Snapsave
    try {
        const snap = await snapsave(expandedUrl);
        if (snap?.success && snap.data?.media?.[0]?.url) {
            finalVideoUrl = snap.data.media[0].url;
            methodUsed = "Snapsave";
        }
    } catch (e) {}

    // STEP 2: TikWM (TikTok)
    if (!finalVideoUrl && isTT) {
        finalVideoUrl = await tryTikWMVideo(expandedUrl);
        if (finalVideoUrl) methodUsed = "TikWM Engine";
    }

    // STEP 3: VxTwitter (X)
    if (!finalVideoUrl && isX) {
        const vx = await tryVxTwitter(expandedUrl);
        if (vx) {
            finalVideoUrl = vx.url;
            forceTitle = vx.title;
            methodUsed = "VxTwitter Bypass";
        }
    }

    // STEP 4: Cobalt (Fallback Universal)
    if (!finalVideoUrl) {
        finalVideoUrl = await tryCobalt(expandedUrl);
        if (finalVideoUrl) methodUsed = "Cobalt System";
    }

    if (!finalVideoUrl) {
      return res.status(404).json({ success: false, error: "Gagal mengekstrak video dari semua metode." });
    }

    // UPLOAD PROSES
    const videyLink = await uploadToVidey(finalVideoUrl);
    if (!videyLink) {
        return res.status(500).json({ 
            success: false, 
            error: "Gagal upload ke Videy",
            debug: { method: methodUsed, source: finalVideoUrl.substring(0, 50) + "..." }
        });
    }

    const profileName = await metadataPromise;
    const platformLabel = isFB ? "FB" : isTT ? "TikTok" : isX ? "X" : isIG ? "IG" : "Media";
    const finalTitle = forceTitle || profileName || `${platformLabel} Video ${expandedUrl.split('/').filter(p => p.length > 4).pop()?.substring(0, 8)}`;

    return res.status(200).json({
      success: true,
      data: { title: finalTitle, videyUrl: videyLink, method: methodUsed }
    });

  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}
