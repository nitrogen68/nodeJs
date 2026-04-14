import { put } from '@vercel/blob';

export default async function handler(req, res) {
  // Hanya izinkan metode POST (opsional, agar lebih aman)
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Mengambil data dari body request (misal: isi pesan)
    // Jika tidak ada, default ke 'Hello World!'
    const content = req.body.text || 'Hello World!';
    const fileName = req.body.fileName || 'articles/blob.txt';

    const blob = await put(fileName, content, { 
      access: 'public',
      // Jika Anda menggunakan prefix custom, tambahkan baris di bawah ini:
      // token: process.env.BLOB_READ_WRITE_TOKEN 
    });
    
    return res.status(200).json({ 
      success: true, 
      url: blob.url,
      pathname: blob.pathname 
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
