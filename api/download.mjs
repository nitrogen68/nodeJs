// api/download.mjs
import { snapsave } from "snapsave-media-downloader";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";

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
    
    let cleanPool = ((ogTitle ? ogTitle[1] : "") + " " + (ogDesc ? ogDesc[1] : ""))
                    .replace(/&quot;/g, '"').replace(/&#\w+;/g, ' ').replace(/\s+/g, ' ');

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
 * [FALLBACK] Cobalt Multi-Instance
 * Menghindari 403/Forbidden dan Limitasi Binary di Vercel
 */
async function tryCobalt(url) {
  const instances = [
    "https://api.cobalt.tools/api/json",
    "https://cobalt-api.kwiateusz.xyz/api/json",
    "https://api.vxtok.com/api/json"
  ];

  for (const apiUrl of instances) {
    console.log(`🔄 [Cobalt] Mencoba: ${apiUrl}`);
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);

      const response = await fetch(apiUrl, {
        method: "POST",
        signal: controller.signal,
        headers: { 
          "Content-Type": "application/json", 
          "Accept": "application/json",
          "Origin": "https://cobalt.tools",
          "Referer": "https://cobalt.tools/"
        },
        body: JSON.stringify({ url, videoQuality: "720" })
      });

      const data = await response.json();
      clearTimeout(timeoutId);
      if (data?.url) return data.url;
    } catch (e) { console.warn(`⚠️ Instance gagal: ${apiUrl}`); }
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
    const isFB = url.includes('facebook.com') || url.includes('fb.com');
    const isTT = url.includes('tiktok.com');
    const isX  = url.includes('twitter.com') || url.includes('x.com');
    const isIG = url.includes('instagram.com');

    // 1. Ambil Metadata secara Paralel
    let metadataPromise;
    if (isFB || isIG) metadataPromise = getProfileName(url);
    else if (isTT) metadataPromise = getTikTokMetadata(url);
    else if (isX)  metadataPromise = getXMetadata(url);
    else metadataPromise = Promise.resolve(null);

    let finalVideoUrl = null;
    let methodUsed = "";

    // 2. Step 1: Snapsave
    console.log("📥 [Step 1] Mencoba Snapsave...");
    try {
        const snapResult = await snapsave(url);
        if (snapResult?.success && snapResult.data?.media?.[0]?.url) {
            finalVideoUrl = snapResult.data.media[0].url;
            methodUsed = "Snapsave";
        }
    } catch (e) {}

    // 3. Step 2: Multi-Cobalt (Jika Snapsave gagal)
    if (!finalVideoUrl) {
        console.log("📥 [Step 2] Snapsave gagal, mencoba Cobalt System...");
        finalVideoUrl = await tryCobalt(url);
        if (finalVideoUrl) methodUsed = "Cobalt System";
    }

    // Jika semua gagal
    if (!finalVideoUrl) {
      return res.status(404).json({ 
        success: false, 
        error: "Semua metode ekstraksi gagal",
        detail: "Media tidak dapat dijangkau oleh Snapsave maupun Cobalt." 
      });
    }

    // 4. Upload ke Videy
    const videyLink = await uploadToVidey(finalVideoUrl);
    if (!videyLink) return res.status(500).json({ success: false, error: "Gagal upload ke Videy" });

    // 5. Final Title Construction
    const profileName = await metadataPromise;
    const platformLabel = isFB ? "FB Video" : isTT ? "TikTok" : isX ? "X Video" : isIG ? "Instagram" : "Media";
    const finalTitle = profileName || `${platformLabel} ${url.split('/').filter(p => p.length > 4).pop()?.substring(0, 8)}`;

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
