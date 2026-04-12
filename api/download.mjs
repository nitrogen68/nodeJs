// api/download.mjs
import { snapsave } from "snapsave-media-downloader";
import FormData from "form-data";

// ============================================
// HELPER: Upload Video ke Videy.co
// ============================================
async function uploadToVidey(videoUrl) {
  console.log("📤 [Videy] Upload started:", videoUrl);

  try {
    const video = await fetch(videoUrl);

    if (!video.ok) {
      throw new Error("Video fetch gagal");
    }

    const buffer = Buffer.from(await video.arrayBuffer());

    console.log("📦 Buffer:", buffer.length);

    const form = new FormData();
    form.append("file", buffer, {
      filename: "video.mp4",
      contentType: "video/mp4"
    });

    const up = await fetch("https://videy.co/api/upload", {
      method: "POST",
      body: form,
      headers: {
        ...form.getHeaders(),
        "Origin": "https://videy.co",
        "Referer": "https://videy.co/",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122 Safari/537.36",
        "Accept": "*/*"
      }
    });

    console.log("📤 Status:", up.status);

    const text = await up.text();

    let json;
    try {
      json = JSON.parse(text);
    } catch {
      console.log("❌ HTML RESPONSE:");
      console.log(text.slice(0,300));
      return null;
    }

    console.log("📤 JSON:", json);

    return json?.id
      ? `https://videy.co/v/?id=${json.id}`
      : null;

  } catch (err) {
    console.error("❌ Videy error:", err.message);
    return null;
  }
}

// ============================================
// MAIN HANDLER - FIXED!
// ============================================
export default async function handler(req, res) {
  console.log("🔥 [1] Handler called - Method:", req.method);
  
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { url } = req.body;
    console.log("🔥 [2] URL received:", url);
    
    if (!url) {
      return res.status(400).json({ success: false, error: "URL kosong" });
    }

    // Step 1: Panggil snapsave
    console.log("📥 [3] Calling snapsave...");
    const result = await snapsave(url);
    
    // ✅ PERBAIKAN UTAMA: Cek result.success DULU!
    console.log("✅ [4] Snapsave result:", JSON.stringify(result, null, 2));
    console.log("🔍 [4] result.success:", result?.success);
    
    if (!result?.success) {
      console.log("⚠️ [5] Snapsave returned success: false");
      return res.status(404).json({ 
        success: false, 
        error: result?.error || "Media tidak ditemukan",
        debug: {
          snapsaveSuccess: result?.success,
          snapsaveError: result?.error,
          url: url
        }
      });
    }

    // Step 2: Sekarang aman akses result.data
    console.log("✅ [6] Snapsave success: true");
    console.log("🔍 [6] result.data keys:", Object.keys(result.data || {}));
    
    const mediaArray = result.data?.media;
    
    if (!Array.isArray(mediaArray) || mediaArray.length === 0) {
      console.log("⚠️ [7] No media in result.data.media");
      return res.status(404).json({ 
        success: false, 
        error: "Media tidak ditemukan dalam response",        debug: {
          hasMedia: Array.isArray(mediaArray),
          mediaLength: mediaArray?.length,
          dataKeys: result.data ? Object.keys(result.data) : []
        }
      });
    }

    // Step 3: Ambil URL video pertama
    console.log("✅ [8] Media found! Count:", mediaArray.length);
    console.log("🎬 [8] First media:", JSON.stringify(mediaArray[0], null, 2));
    
    const firstMedia = mediaArray[0];
    const rawUrl = firstMedia?.url;
    
    if (!rawUrl) {
      console.error("❌ [9] No URL in first media item");
      return res.status(500).json({ 
        success: false, 
        error: "URL video tidak ditemukan",
        mediaItem: firstMedia
      });
    }
    
    console.log("🎬 [9] Raw URL:", rawUrl);
    
    // Step 4: Upload ke Videy
    console.log("📤 [10] Uploading to Videy...");
    const videyLink = await uploadToVidey(rawUrl);
    console.log("📤 [10] Videy link:", videyLink);

    if (!videyLink) {
      console.log("⚠️ [11] Videy upload failed");
      return res.status(500).json({ 
        success: false, 
        error: "Gagal upload ke Videy" 
      });
    }

    // Step 5: Return response sukses ✅
    console.log("✅ [12] Success!");
    return res.status(200).json({
      success: true,
      data: {
        title: result.data?.description || "Video Content",
        videyUrl: videyLink,
        quality: firstMedia?.resolution || "unknown"
      }
    });
  } catch (err) {
    console.error("💥 [13] Global error:", err.message);
    return res.status(500).json({ 
      success: false, 
      error: err.message
    });
  }
}
