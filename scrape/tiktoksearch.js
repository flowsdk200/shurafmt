import axios from 'axios'

const searchApi = axios.create({
    timeout: 30000,
    headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36'
    }
})

async function searchTikTok(query, limit = 10) {
    const q = String(query || '').trim()
    if (!q) throw new Error('Query pencarian kosong')

    const { data } = await searchApi.get('https://api.baguss.xyz/api/search/tiktok', {
        params: { q }
    })

    if (!data || data.status !== true || !Array.isArray(data.results)) {
        throw new Error(data?.message || data?.msg || 'Gagal mengambil hasil pencarian TikTok')
    }

    const normalized = data.results.map((item) => {
        const username = item?.author?.unique_id || item?.author?.username || ''
        const videoId = String(item?.video_id || '').trim()
        const permalink = (username && videoId)
            ? `https://www.tiktok.com/@${username}/video/${videoId}`
            : ''

        return {
            id: videoId,
            title: String(item?.title || '').trim(),
            duration: Number(item?.duration || 0),
            url: permalink,
            videoUrl: String(item?.play_url || item?.wmplay_url || '').trim(),
            cover: String(item?.cover || item?.origin_cover || item?.music_info?.cover || '').trim(),
            author: {
                id: item?.author?.id,
                username,
                nickname: String(item?.author?.nickname || '').trim()
            },
            stats: {
                plays: item?.play_count,
                likes: item?.digg_count,
                comments: item?.comment_count,
                shares: item?.share_count
            }
        }
    }).filter((item) => item.url || item.videoUrl)

    const lim = Math.max(1, Math.min(60, Number(limit) || 10))
    return normalized.slice(0, lim)
}

export { searchTikTok }
