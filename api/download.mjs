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

/**
 * [FALLBACK KHUSUS FB] Crawler Penyamaran FacebookExternalHit
 * Digunakan jika metadata profil gagal didapatkan dari metode lain.
 */
async function getFacebookDetails(url) {
    try {
        const response = await fetch(url, {
            headers: {
                'User-Agent': 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
                'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7'
            }
        });
        const html = await response.text();
        const titleMatch = html.match(/<meta property="og:title" content="(.*?)"/i);
        
        if (titleMatch) {
            // 1. Decode HTML Entities dasar dulu
            let rawTitle = titleMatch[1]
                .replace(/&#x27;/g, "'")
                .replace(/&quot;/g, '"')
                .replace(/&amp;/g, '&');

            // 2. Pisahkan berdasarkan simbol pemisah umum Meta: # (hashtag), | (pipe), atau - (strip)
            // Contoh: "Lexi #fypviral" -> ["Lexi ", "fypviral"]
            let cleanName = rawTitle.split(/[#|\-·]/)[0].trim();

            // 3. Jika setelah dipisahkan hasilnya terlalu pendek, 
            // kemungkinan nama aslinya memang mengandung simbol tersebut.
            // Kita gunakan filter cadangan untuk hanya membuang hashtag.
            if (cleanName.length < 2) {
                cleanName = rawTitle.replace(/#\w+/g, '').trim();
            }

            // 4. Baru bersihkan karakter aneh yang tersisa (estetika)
            // Tetap izinkan spasi, titik, dan tanda petik agar nama seperti "O'Connor" tidak rusak.
            cleanName = cleanName.replace(/[^\w\d\s'.]/g, '').trim();

            // 5. Validasi akhir: Jangan kembalikan jika judulnya cuma "Facebook" atau "Login"
            const blacklist = ["facebook", "log in", "masuk", "reels"];
            if (blacklist.some(word => cleanName.toLowerCase() === word)) {
                return null;
            }

            return cleanName.length > 2 ? cleanName : null;
        }
    } catch (e) { return null; }
    return null;
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

async function tryMetaBypass(url, platform) {
  console.log(`🔍 [${platform}] Mencoba Ferdev API Bypass...`);
  const apiKey = process.env.FERDEV_API_KEY;
  if (!apiKey) return null;
  
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
            let vidUrl = json.data.hd || json.data.sd;
            if (vidUrl) {
                vidUrl = vidUrl.replace(/&amp;/g, '&');
                videos.push(vidUrl);
            }
            if (json.data.title && json.data.title.toLowerCase() !== "unknown") {
                fetchedTitle = json.data.title.substring(0, 45) + "...";
            }
        }
        if (videos.length > 0) {
            if (fetchedTitle) fetchedTitle = fetchedTitle.replace(/[\r\n]+/g, ' ');
            return { urls: videos, title: fetchedTitle };
        }
    }
  } catch (e) { return null; }
  return null;
}

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
            return { urls: videos, title: `@${json.user_screen_name} - ${cleanText || "Video"}` };
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
    let headers = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 'Accept': '*/*', 'Connection': 'keep-alive' };
    let safeReferer = null;
    if (remoteUrl.includes('facebook') || remoteUrl.includes('fbcdn')) safeReferer = 'https://www.facebook.com/';
    else if (remoteUrl.includes('instagram') || remoteUrl.includes('cdninstagram')) safeReferer = 'https://www.instagram.com/';
    else if (remoteUrl.includes('snapcdn')) safeReferer = 'https://snapcdn.app/';
    if (safeReferer) headers['Referer'] = safeReferer;

    let response = await fetch(remoteUrl, { headers });
    const contentType = response.headers.get('content-type') || '';
    if (!response.ok || contentType.includes('text/html')) {
        let dlCmd = `curl -s -L -A "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124.0.0.0" `;
        if (safeReferer) dlCmd += `-e "${safeReferer}" `;
        dlCmd += `-o "${tempFilePath}" "${remoteUrl}"`;
        execSync(dlCmd);
    } else {
        const buffer = Buffer.from(await response.arrayBuffer());
        fs.writeFileSync(tempFilePath, buffer);
    }
    const stats = fs.statSync(tempFilePath);
    if (stats.size < 10240) throw new Error("File corrupt.");
    const fd = fs.openSync(tempFilePath, 'r');
    const bufferHead = Buffer.alloc(100);
    fs.readSync(fd, bufferHead, 0, 100, 0);
    fs.closeSync(fd);
    if (bufferHead.toString('utf8').toLowerCase().includes('<html')) throw new Error("HTML detected.");

    const cmd = `curl -s -X POST https://videy.co/api/upload -H "Origin: https://videy.co" -H "Referer: https://videy.co/" -F "file=@${tempFilePath};type=video/mp4"`;
    const result = JSON.parse(execSync(cmd).toString());
    if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
    return result?.id ? `https://videy.co/v/?id=${result.id}` : null;
  } catch (error) {
    if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
    return null;
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const { url } = req.body;
  if (!url) return res.status(400).json({ success: false, error: "URL kosong" });

  try {
    const isFB = url.includes('facebook.com') || url.includes('fb.com') || url.includes('fb.watch');
    const isTT = url.includes('tiktok.com') || url.includes('vt.tiktok');
    const isX  = url.includes('twitter.com') || url.includes('x.com');
    const isIG = url.includes('instagram.com');

    let targetUrl = url;
    if (isTT || url.includes('bit.ly') || url.includes('t.co')) targetUrl = await expandUrl(url);

    let metadataPromise;
    if (isFB || isIG) metadataPromise = getProfileName(targetUrl);
    else if (isTT) metadataPromise = getTikTokMetadata(targetUrl);
    else if (isX)  metadataPromise = getXMetadata(targetUrl);
    else metadataPromise = Promise.resolve(null);

    let finalVideoUrls = [];
    let methodUsed = "";
    let forceTitle = null;

    if (isFB || isIG) {
        const platformCode = isIG ? 'IG' : 'FB';
        const metaBypass = await tryMetaBypass(targetUrl, platformCode);
        if (metaBypass && metaBypass.urls.length > 0) {
            finalVideoUrls = metaBypass.urls;
            if (metaBypass.title) forceTitle = metaBypass.title;
            methodUsed = "Ferdev API";
        }
    }

    if (finalVideoUrls.length === 0) {
        try {
            const snap = await snapsave(targetUrl);
            if (snap?.success && snap.data?.media?.length > 0) {
                finalVideoUrls = [snap.data.media[0].url];
                methodUsed = "Snapsave";
            }
        } catch (e) {}
    }

    if (finalVideoUrls.length === 0 && isTT) {
        const ttUrl = await tryTikWMVideo(targetUrl);
        if (ttUrl) { finalVideoUrls = [ttUrl]; methodUsed = "TikWM Engine"; }
    }

    if (finalVideoUrls.length === 0 && isX) {
        const vx = await tryVxTwitter(targetUrl);
        if (vx && vx.urls.length > 0) {
            finalVideoUrls = vx.urls;
            forceTitle = vx.title;
            methodUsed = "VxTwitter Bypass";
        }
    }

    if (finalVideoUrls.length === 0) {
        const cobUrl = await tryCobalt(targetUrl);
        if (cobUrl) { finalVideoUrls = [cobUrl]; methodUsed = "Cobalt System"; }
    }

    if (finalVideoUrls.length === 0) return res.status(404).json({ success: false, error: "Gagal ekstrak." });

    const videyLinks = [];
    for (const vUrl of finalVideoUrls) {
        const uploadedLink = await uploadToVidey(vUrl);
        if (uploadedLink) videyLinks.push(uploadedLink);
    }

    if (videyLinks.length === 0) return res.status(500).json({ success: false, error: "Upload gagal." });

    let profileName = await metadataPromise;

    // --- FALLBACK LOGIC UNTUK FACEBOOK PROFILE NAME ---
    if (isFB && (!profileName || profileName.toLowerCase().includes('facebook'))) {
        const fbCrawlerDetail = await getFacebookDetails(targetUrl);
        if (fbCrawlerDetail) profileName = fbCrawlerDetail;
    }

    const platformLabel = isFB ? "FB" : isTT ? "TikTok" : isX ? "X" : isIG ? "IG" : "Media";
    let finalTitle = forceTitle || profileName;
    
    if (!finalTitle || finalTitle.toLowerCase() === "reels" || finalTitle.toLowerCase() === "unknown") {
        finalTitle = `${platformLabel} Video ${targetUrl.split('/').filter(p => p.length > 4).pop()?.substring(0, 8)}`;
    }

    return res.status(200).json({
      success: true,
      data: { title: finalTitle, videyUrls: videyLinks, method: methodUsed }
    });

  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}
