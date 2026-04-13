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
 * [DOWNLOADER KHUSUS META] Ferdev API Bypass
 */
async function tryMetaBypass(url, platform) {
  console.log(`🔍 [${platform}] Mencoba Ferdev API Bypass...`);
  
  const apiKey = process.env.FERDEV_API_KEY;

  if (!apiKey) {
      console.error("❌ [Keamanan] FERDEV_API_KEY belum disetting di Vercel!");
      return null;
  }
  
  const endpoint = platform === 'IG' 
    ? `https://api.ferdev.my.id/downloader/instagram?link=${encodeURIComponent(url)}&apikey=${apiKey}`
    : `https://api.ferdev.my.id/downloader/facebook?link=${encodeURIComponent(url)}&apikey=${apiKey}`;

  try {
    const res = await fetch(endpoint, { headers: { 'Accept': 'application/json' } });
    const json = await res.json();
    
    if (json.success && json.data) {
        let videos = [];
        let fetchedTitle = null;

        if (platform === 'IG') {
            if (json.data.dlink) videos.push(json.data.dlink);
            if (json.data.metadata && json.data.metadata.title) {
                fetchedTitle = json.data.metadata.username 
                    ? `@${json.data.metadata.username} - ${json.data.metadata.title.substring(0, 45)}...`
                    : json.data.metadata.title.substring(0, 45) + "...";
            }
        } 
        else if (platform === 'FB') {
            const vidUrl = json.data.hd || json.data.sd;
            if (vidUrl) videos.push(vidUrl);
            
            if (json.data.title && json.data.title.toLowerCase() !== "unknown") {
                fetchedTitle = json.data.title.substring(0, 45) + "...";
            }
        }

        if (videos.length > 0) {
            console.log(`✅ [${platform}] Berhasil via Ferdev API!`);
            if (fetchedTitle) fetchedTitle = fetchedTitle.replace(/[\r\n]+/g, ' ');
            return { urls: videos, title: fetchedTitle };
        }
    }
  } catch (e) { 
      console.warn(`⚠️ Gagal di Ferdev API: ${e.message}`); 
  }
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
            let rawText = json.text || "Video";
            let cleanText = rawText.replace(/https?:\/\/\S+/g, '').trim();
            if (cleanText.length > 45) cleanText = cleanText.substring(0, 45) + "...";
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

/**
 * [FIXED 403 FORBIDDEN] Upload ke Videy dengan Bypass Headers & cURL
 */
async function uploadToVidey(remoteUrl) {
  const tempFilePath = path.join(os.tmpdir(), `vid_${Date.now()}_${Math.floor(Math.random() * 1000)}.mp4`);
  try {
    console.log("⏳ [Videy] Downloading from source...");
    
    // 1. Coba download dengan Fetch (Penyamaran Browser Lengkap)
    let response = await fetch(remoteUrl, {
        headers: { 
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            'Accept': '*/*',
            'Connection': 'keep-alive',
            'Referer': remoteUrl.includes('instagram') ? 'https://www.instagram.com/' : 'https://www.facebook.com/'
        }
    });
    
    // 2. Jika Fetch ditolak (403 Forbidden), gunakan Kekerasan via cURL
    if (!response.ok) {
        console.warn(`⚠️ Fetch ditolak (${response.status}), mencoba Bypass cURL...`);
        const dlCmd = `curl -s -L -A "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124.0.0.0" -e "https://google.com" -o "${tempFilePath}" "${remoteUrl}"`;
        execSync(dlCmd);
        
        if (!fs.existsSync(tempFilePath) || fs.statSync(tempFilePath).size === 0) {
             throw new Error(`Source status: ${response.status} & cURL Failed`);
        }
    } else {
        const buffer = Buffer.from(await response.arrayBuffer());
        fs.writeFileSync(tempFilePath, buffer);
    }

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
    const isFB = url.includes('facebook.com') || url.includes('fb.com') || url.includes('fb.watch');
    const isTT = url.includes('tiktok.com') || url.includes('vt.tiktok');
    const isX  = url.includes('twitter.com') || url.includes('x.com');
    const isIG = url.includes('instagram.com');

    // [PENTING] Jangan lakukan expandUrl pada Meta (FB/IG) karena memicu block Login.
    let targetUrl = url;
    if (isTT || url.includes('bit.ly') || url.includes('t.co')) {
        targetUrl = await expandUrl(url);
    }

    let metadataPromise;
    if (isFB || isIG) metadataPromise = getProfileName(targetUrl);
    else if (isTT) metadataPromise = getTikTokMetadata(targetUrl);
    else if (isX)  metadataPromise = getXMetadata(targetUrl);
    else metadataPromise = Promise.resolve(null);

    let finalVideoUrls = [];
    let methodUsed = "";
    let forceTitle = null;

    // STEP 1: FERDEV API BYPASS (Prioritas Utama Khusus FB & IG)
    // Diutamakan agar kita dapat Metadata Nama Profil dengan akurat.
    if (isFB || isIG) {
        const platformCode = isIG ? 'IG' : 'FB';
        const metaBypass = await tryMetaBypass(targetUrl, platformCode);
        
        if (metaBypass && metaBypass.urls && metaBypass.urls.length > 0) {
            finalVideoUrls = metaBypass.urls;
            if (metaBypass.title) forceTitle = metaBypass.title;
            methodUsed = "Ferdev API";
        }
    }

    // STEP 2: Snapsave (Prioritas untuk TikTok / Platform Lain / Jika Ferdev Error)
    if (finalVideoUrls.length === 0) {
        try {
            const snap = await snapsave(targetUrl);
            if (snap?.success && snap.data?.media?.length > 0) {
                finalVideoUrls = [snap.data.media[0].url]; // Hanya ambil index ke-0
                methodUsed = "Snapsave";
            }
        } catch (e) {}
    }

    // STEP 3: TikWM (Khusus TikTok Fallback)
    if (finalVideoUrls.length === 0 && isTT) {
        const ttUrl = await tryTikWMVideo(targetUrl);
        if (ttUrl) { finalVideoUrls = [ttUrl]; methodUsed = "TikWM Engine"; }
    }

    // STEP 4: VxTwitter (Khusus X Fallback)
    if (finalVideoUrls.length === 0 && isX) {
        const vx = await tryVxTwitter(targetUrl);
        if (vx && vx.urls && vx.urls.length > 0) {
            finalVideoUrls = vx.urls;
            forceTitle = vx.title;
            methodUsed = "VxTwitter Bypass";
        }
    }

    // STEP 5: Cobalt (Fallback Terakhir)
    if (finalVideoUrls.length === 0) {
        const cobUrl = await tryCobalt(targetUrl);
        if (cobUrl) { finalVideoUrls = [cobUrl]; methodUsed = "Cobalt System"; }
    }

    if (finalVideoUrls.length === 0) {
      return res.status(404).json({ success: false, error: "Gagal mengekstrak video dari semua metode." });
    }

    // UPLOAD PROSES
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
    
    // Penentuan Judul Terakhir
    let finalTitle = forceTitle || profileName;
    
    // Jika profil kosong atau judul cuma bertuliskan "reels" / "unknown", pakai fallback rapi
    if (!finalTitle || finalTitle.toLowerCase() === "reels" || finalTitle.toLowerCase() === "unknown") {
        finalTitle = `${platformLabel} Video ${targetUrl.split('/').filter(p => p.length > 4).pop()?.substring(0, 8)}`;
    }

    return res.status(200).json({
      success: true,
      data: { 
        title: finalTitle, 
        videyUrls: videyLinks,
        method: methodUsed 
      }
    });

  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}
