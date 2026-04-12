import { snapsave } from "snapsave-media-downloader";
import FormData from "form-data";

async function uploadToVidey(videoUrl) {
  console.log("📤 Upload to Videy started:", videoUrl);
  try {
    const response = await fetch(videoUrl);
    console.log("📥 Videy fetch status:", response.status);
    
    if (!response.ok) {
      throw new Error(`Failed to fetch video: ${response.status} ${response.statusText}`);
    }
    
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    console.log("📦 Buffer size:", buffer.length, "bytes");

    const form = new FormData();
    form.append('file', buffer, {
      filename: 'video.mp4',
      contentType: 'video/mp4',
    });

    const up = await fetch("https://videy.co/api/upload", {
      method: "POST",
      body: form,
      headers: {
        "Origin": "https://videy.co",
        "Referer": "https://videy.co/",
        ...form.getHeaders()
      }
    });

    console.log("📤 Videy upload response status:", up.status);
    const resJson = await up.json();
    console.log("📤 Videy upload response:", JSON.stringify(resJson));
    
    return resJson.id ? `https://videy.co/v/?id=${resJson.id}` : null;
  } catch (e) {
    console.error("❌ Videy Error:", e.message);
    console.error("❌ Videy Error stack:", e.stack);
    return null;
  }
}

export default async function handler(req, res) {
  console.log("🔥 [1] Handler called");
  console.log("🔥 [1] Method:", req.method);
  console.log("🔥 [1] Headers:", JSON.stringify(req.headers));
    if (req.method !== 'POST') {
    console.log("⚠️ [2] Wrong method, returning 405");
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    console.log("🔥 [3] Parsing body");
    const { url } = req.body;
    console.log("🔥 [3] URL received:", url);
    
    if (!url) {
      console.log("⚠️ [4] URL is empty, returning 400");
      return res.status(400).json({ success: false, error: "URL kosong" });
    }

    console.log("📥 [5] Calling snapsave...");
    let result;
    try {
      result = await snapsave(url);
      console.log("✅ [6] Snapsave result:", JSON.stringify(result, null, 2));
    } catch (snapsaveError) {
      console.error("❌ [6] Snapsave error:", snapsaveError.message);
      console.error("❌ [6] Snapsave error stack:", snapsaveError.stack);
      return res.status(500).json({ 
        success: false, 
        error: "Snapsave failed: " + snapsaveError.message 
      });
    }

    // Check result structure
    console.log("🔍 [7] Checking result structure...");
    console.log("🔍 [7] result:", typeof result);
    console.log("🔍 [7] result.data:", result?.data ? "exists" : "undefined");
    console.log("🔍 [7] result.data.media:", result?.data?.media ? "exists" : "undefined");
    console.log("🔍 [7] result.data.media.length:", result?.data?.media?.length);
    
    if (!result?.data?.media?.length) {
      console.log("⚠️ [8] No media found! Returning 404");
      console.log("⚠️ [8] Full result:", JSON.stringify(result, null, 2));
      return res.status(404).json({ 
        success: false, 
        error: "Media tidak ditemukan",
        debug: {
          resultType: typeof result,
          hasData: !!result?.data,
          hasMedia: !!result?.data?.media,
          mediaLength: result?.data?.media?.length,
          fullResult: result
        }
      });    }

    console.log("✅ [9] Media found! Count:", result.data.media.length);
    const rawUrl = result.data.media[0].url;
    console.log("🎬 [10] Raw URL:", rawUrl);
    
    console.log("📤 [11] Uploading to Videy...");
    const videyLink = await uploadToVidey(rawUrl);
    console.log("📤 [11] Videy link result:", videyLink);

    if (!videyLink) {
      console.log("⚠️ [12] Videy upload failed, returning 500");
      return res.status(500).json({ 
        success: false, 
        error: "Gagal upload ke Videy" 
      });
    }

    console.log("✅ [13] Success! Sending response...");
    const responseData = {
      success: true,
       {
        title: result.data.description || "Video Content",
        videyUrl: videyLink
      }
    };
    
    console.log("✅ [13] Response:", JSON.stringify(responseData, null, 2));
    return res.status(200).json(responseData);

  } catch (err) {
    console.error("💥 [14] Global error handler:");
    console.error("💥 [14] Error message:", err.message);
    console.error("💥 [14] Error stack:", err.stack);
    console.error("💥 [14] Error object:", JSON.stringify(err, Object.getOwnPropertyNames(err)));
    
    return res.status(500).json({ 
      success: false, 
      error: err.message,
      stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
  }
}
