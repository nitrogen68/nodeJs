import { put, list } from '@vercel/blob';

export default async function handler(req, res) {
  // 1. Validasi Method
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Gunakan POST.' });
  }

  const { type, sizeInBytes } = req.body || {}; 
  const fileName = 'data/stats.json';
  
  // 2. Deteksi IP
  const forwarded = req.headers['x-forwarded-for'];
  const visitorIP = typeof forwarded === 'string' 
    ? forwarded.split(',')[0] 
    : (req.socket?.remoteAddress || 'unknown');

  try {
    let stats = { visitorCount: 0, visitorIps: [], totalTasks: 0, totalBytes: 0 };

    // 3. Tahap Membaca Data Lama
    try {
      const { blobs } = await list({ prefix: fileName });
      const fileInfo = blobs.find(b => b.pathname === fileName);
      
      if (fileInfo) {
        console.log(`[INFO] File ${fileName} ditemukan. Mengambil data...`);
        const response = await fetch(fileInfo.url);
        if (response.ok) {
            stats = await response.json();
        } else {
            console.error(`[ERROR] Gagal fetch konten file: ${response.statusText}`);
        }
      } else {
        // Log spesifik jika file benar-benar tidak ada di storage
        console.warn(`[WARN] File ${fileName} tidak ditemukan di storage. Membuat data baru.`);
      }
    } catch (readError) {
      console.error(`[ERROR READ] Gagal mengakses Vercel Blob: ${readError.message}`);
    }

    // 4. Update Logika berdasarkan Type
    if (type === 'visit') {
      if (!stats.visitorIps.includes(visitorIP)) {
        stats.visitorCount += 1;
        stats.visitorIps.push(visitorIP);
        console.log(`[LOG] Visitor Baru: ${visitorIP}`);
      }
    } 
    else if (type === 'task') {
      stats.totalTasks += 1;
      console.log(`[LOG] Task Bertambah: ${stats.totalTasks}`);
    } 
    else if (type === 'upload' && sizeInBytes) {
      const bytes = parseInt(sizeInBytes);
      if (!isNaN(bytes)) {
        stats.totalBytes += bytes;
        console.log(`[LOG] Upload Size Bertambah: ${bytes} bytes`);
      }
    }

    // 5. Tahap Menyimpan ke Blob (Try/Catch Khusus)
    try {
      const blobResult = await put(fileName, JSON.stringify(stats), {
        access: 'public',
        addRandomSuffix: false,
        contentType: 'application/json',
        token: process.env.MediaGraph_BLOB // Pastikan Env Variable ini SUDAH di-set di Vercel
      });

      console.log(`[SUCCESS] Stats berhasil disimpan. URL: ${blobResult.url}`);
      return res.status(200).json({ success: true, stats });

    } catch (putError) {
      // Log spesifik jika gagal simpan (Biasanya masalah TOKEN)
      console.error(`[CRITICAL ERROR] Gagal PUT ke Vercel Blob: ${putError.message}`);
      return res.status(500).json({ 
        success: false, 
        error: "Gagal menyimpan data ke storage.",
        detail: putError.message 
      });
    }

  } catch (error) {
    // Log fatal error lainnya
    console.error(`[FATAL ERROR]: ${error.message}`);
    return res.status(500).json({ success: false, error: error.message });
  }
}
