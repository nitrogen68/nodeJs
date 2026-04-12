// api/download.mjs
import { snapsave } from "snapsave-media-downloader";
import FormData from "form-data";

// ============================================
// HELPER: Upload Video ke Videy.co
// ============================================
async function uploadToVidey(videoUrl) {
  console.log("📤 [Videy] Upload started:", videoUrl);
  
  try {
    // Fetch video dari URL asli
    const response = await fetch(videoUrl);
    console.log("📥 [Videy] Fetch status:", response.status);
    
    if (!response.ok) {
      throw new Error(`Failed to fetch video: ${response.status} ${response.statusText}`);
    }
    
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    console.log("📦 [Videy] Buffer size:", buffer.length, "bytes");

    // Prepare FormData untuk upload
    const form = new FormData();
    form.append('file', buffer, {
      filename: 'video.mp4',
      contentType: 'video/mp4',
    });

    // Upload ke Videy API
    const up = await fetch("https://videy.co/api/upload", {
      method: "POST",
      body: form,
      headers: {
        "Origin": "https://videy.co",
        "Referer": "https://videy.co/",
        ...form.getHeaders()
      }
    });

    console.log("📤 [Videy] Upload response status:", up.status);
    const resJson = await up.json();
    console.log("📤 [Videy] Upload response:", JSON.stringify(resJson));
    
    // Return link Videy jika sukses
    return resJson.id ? `https://videy.co/v/?id=${resJson.id}` : null;
    
  } catch (e) {
    console.error("❌ [Videy] Error:", e.message);    console.error("❌ [Videy] Stack:", e.stack);
    return null;
  }
}

// ============================================
// MAIN HANDLER: Vercel Serverless Function
// ============================================
export default async function handler(req, res) {
  console.log("🔥 [1] Handler called");
  console.log("🔥 [1] Method:", req.method);
  
  // Hanya terima method POST
  if (req.method !== 'POST') {
    console.log("⚠️ [2] Wrong method, returning 405");
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Parse request body
    console.log("🔥 [3] Parsing body");
    const { url } = req.body;
    console.log("🔥 [3] URL received:", url);
    
    // Validasi URL tidak kosong
    if (!url) {
      console.log("⚠️ [4] URL is empty, returning 400");
      return res.status(400).json({ success: false, error: "URL kosong" });
    }

    // Step 1: Ekstrak media menggunakan snapsave
    console.log("📥 [5] Calling snapsave...");
    let result;
    try {
      result = await snapsave(url);
      console.log("✅ [6] Snapsave result received");
    } catch (snapsaveError) {
      console.error("❌ [6] Snapsave error:", snapsaveError.message);
      return res.status(500).json({ 
        success: false, 
        error: "Snapsave failed: " + snapsaveError.message 
      });
    }

    // Step 2: Validasi struktur response snapsave
    console.log("🔍 [7] Checking result structure...");
    console.log("🔍 [7] result.data.media.length:", result?.data?.media?.length);
    
    if (!result?.data?.media?.length) {
      console.log("⚠️ [8] No media found! Returning 404");      return res.status(404).json({ 
        success: false, 
        error: "Media tidak ditemukan",
        debug: {
          hasData: !!result?.data,
          hasMedia: !!result?.data?.media,
          mediaLength: result?.data?.media?.length
        }
      });
    }

    // Step 3: Ambil URL video pertama
    console.log("✅ [9] Media found! Count:", result.data.media.length);
    const rawUrl = result.data.media[0].url;
    console.log("🎬 [10] Raw URL:", rawUrl);
    
    // Step 4: Upload ke Videy
    console.log("📤 [11] Uploading to Videy...");
    const videyLink = await uploadToVidey(rawUrl);
    console.log("📤 [11] Videy link:", videyLink);

    if (!videyLink) {
      console.log("⚠️ [12] Videy upload failed");
      return res.status(500).json({ 
        success: false, 
        error: "Gagal upload ke Videy" 
      });
    }

    // Step 5: ✅ Return response sukses (SYNTAX DIPERBAIKI!)
    console.log("✅ [13] Success! Sending response...");
    return res.status(200).json({
      success: true,
      data: {
        title: result.data.description || "Video Content",
        videyUrl: videyLink
      }
    });

  } catch (err) {
    // Global error handler
    console.error("💥 [14] Global error:", err.message);
    return res.status(500).json({ 
      success: false, 
      error: err.message
    });
  }
}
