import { put, list } from '@vercel/blob';

export default async function handler(req, res) {
  // 1. Validasi Method
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Gunakan POST.' });
  }

  // 2. Ambil payload dengan fallback kosong (|| {}) agar tidak error jika body kosong
  const { type, sizeInBytes } = req.body || {}; 
  const fileName = 'data/stats.json';
  
  // 3. Deteksi IP dengan fallback aman
  const forwarded = req.headers['x-forwarded-for'];
  const visitorIP = typeof forwarded === 'string' 
    ? forwarded.split(',')[0] 
    : (req.socket?.remoteAddress || 'unknown');

  try {
    // Format default
    let stats = { visitorCount: 0, visitorIps: [], totalTasks: 0, totalBytes: 0 };

    // 4. Ambil data lama menggunakan list() (Lebih aman dari head)
    try {
      const { blobs } = await list({ prefix: fileName });
      
      // Pastikan menemukan file yang namanya persis
      const fileInfo = blobs.find(b => b.pathname === fileName);
      
      if (fileInfo) {
        const response = await fetch(fileInfo.url);
        if (response.ok) {
            stats = await response.json();
        }
      }
    } catch (e) { 
      console.log("File stats belum ada atau gagal dibaca, inisialisasi baru."); 
    }

    // 5. Update Logika berdasarkan Type
    if (type === 'visit') {
      if (!stats.visitorIps.includes(visitorIP)) {
        stats.visitorCount += 1;
        stats.visitorIps.push(visitorIP);
      }
    } 
    else if (type === 'task') {
      stats.totalTasks += 1;
    } 
    else if (type === 'upload' && sizeInBytes) {
      // Pastikan parse int tidak menghasilkan NaN
      const bytes = parseInt(sizeInBytes);
      if (!isNaN(bytes)) {
        stats.totalBytes += bytes;
      }
    }

    // 6. Simpan kembali ke Blob (Overwrite data lama)
    await put(fileName, JSON.stringify(stats), {
      access: 'public',
      addRandomSuffix: false, // Penting agar URL/nama file tidak berubah
      contentType: 'application/json',
      token: process.env.BLOB_READ_WRITE_TOKEN
    });

    return res.status(200).json({ success: true, stats });

  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
}
