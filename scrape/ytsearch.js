import axios from 'axios'

const extractVideoId = (value = '') => {
  const text = String(value || '').trim()
  const match = text.match(/(?:youtube\.com\/(?:watch\?.*?v=|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/i)
  return match?.[1] || ''
}

async function search(query, limit = 10) {
  const q = String(query || '').trim()
  if (!q) throw new Error('Query pencarian kosong')

  const { data } = await axios.get('https://api.siputzx.my.id/api/s/youtube', {
    params: { query: q },
    timeout: 30000,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    }
  })

  if (!data || data.status !== true || !Array.isArray(data.data)) {
    throw new Error('Gagal mengambil hasil pencarian YouTube')
  }

  const lim = Math.max(1, Math.min(60, Number(limit) || 10))

  return data.data.map((item) => {
    const id = String(item.videoId || extractVideoId(item.url)).trim()
    if (!id) return null

    return {
      id,
      url: item.url || `https://youtube.com/watch?v=${id}`,
      title: item.title || 'Unknown',
      channel: item.author?.name || '-',
      duration: item.duration?.timestamp || item.timestamp || '-',
      views: item.views != null ? String(item.views) : '-',
      published: item.ago || '-',
      thumbnail: item.image || item.thumbnail || `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
      thumbnailHD: `https://i.ytimg.com/vi/${id}/maxresdefault.jpg`
    }
  }).filter(Boolean).slice(0, lim)
}

export { search }
