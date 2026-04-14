import { put } from '@vercel/blob';

export default async function handler(req, res) {
  // 1. Hanya izinkan metode POST untuk keamanan
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed. Gunakan POST.' });
  }

  try {
    // 2. Ambil data dari Body Request
    const { text, fileName } = req.body;

    const content = text || 'Hello World dari MediaGraph!';
    const path = fileName || `visitors/log-${Date.now()}.txt`;

    // 3. Proses upload ke Vercel Blob
    const blob = await put(path, content, { 
      access: 'public',
      // Jika di langkah sebelumnya Anda menggunakan prefix "MediaGraph99", 
      // hapus tanda komentar pada baris 'token' di bawah ini:
      token: process.env.BLOB_READ_WRITE_TOKEN 
    });
    
    // 4. Respon sukses
    return res.status(200).json({ 
      success: true, 
      url: blob.url,
      pathname: blob.pathname 
    });

  } catch (error) {
    // Tangani error jika token tidak ditemukan atau masalah koneksi
    return res.status(500).json({ 
      success: false,
      error: error.message 
    });
  }
}
