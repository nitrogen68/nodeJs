import { put, head } from '@vercel/blob';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Gunakan POST.' });

  const { type, sizeInBytes } = req.body; // 'visit', 'task', atau 'upload'
  const fileName = 'data/stats.json';
  
  // Deteksi IP untuk Unique Visitor
  const forwarded = req.headers['x-forwarded-for'];
  const visitorIP = typeof forwarded === 'string' ? forwarded.split(',')[0] : req.socket.remoteAddress;

  try {
    let stats = { visitorCount: 0, visitorIps: [], totalTasks: 0, totalBytes: 0 };

    // 1. Ambil data lama
    try {
      const fileInfo = await head(fileName);
      if (fileInfo) {
        const response = await fetch(fileInfo.url);
        stats = await response.json();
      }
    } catch (e) { console.log("Inisialisasi file stats baru."); }

    // 2. Update Logika berdasarkan Type
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
      stats.totalBytes += parseInt(sizeInBytes);
    }

    // 3. Simpan ke Blob
    await put(fileName, JSON.stringify(stats), {
      access: 'public',
      addRandomSuffix: false,
      contentType: 'application/json',
      token: process.env.BLOB_READ_WRITE_TOKEN
    });

    return res.status(200).json({ success: true, stats });

  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
}
