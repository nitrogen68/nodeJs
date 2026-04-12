import { snapsave } from "snapsave-media-downloader";
import FormData from "form-data";

// Helper upload ke Videy
async function uploadToVidey(videoUrl) {
  try {
    const response = await fetch(videoUrl);
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

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

    const resJson = await up.json();
    return resJson.id ? `https://videy.co/v/?id=${resJson.id}` : null;
  } catch (e) {
    console.error("❌ Videy Error:", e.message);
    return null;
  }
}

// ✅ Vercel Serverless Function Handler
export default async function handler(req, res) {
  // Hanya terima POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { url } = req.body;
    
    if (!url) {
      return res.status(400).json({ success: false, error: "URL kosong" });
    }

    console.log("📥 Processing:", url);
    
    // Ekstrak media
    const result = await snapsave(url);
    
    if (!result?.data?.media?.length) {
      return res.status(404).json({ success: false, error: "Media tidak ditemukan" });
    }

    const rawUrl = result.data.media[0].url;
    console.log("🎬 Raw URL:", rawUrl);
    
    // Upload ke Videy
    const videyLink = await uploadToVidey(rawUrl);
    if (!videyLink) {
      return res.status(500).json({ success: false, error: "Gagal upload ke Videy" });
    }

    // ✅ Response sukses
    return res.status(200).json({
      success: true,
      data: {
        title: result.data.description || "Video Content",
        videyUrl: videyLink
      }
    });

  } catch (err) {
    console.error("❌ Error:", err.message);
    return res.status(500).json({ 
      success: false, 
      error: err.message 
    });
  }
}
