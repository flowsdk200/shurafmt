import { yt1sdl } from '../../scrape/yt1s.js'
import { search } from '../../scrape/ytsearch.js'
import { getBuffer, toVideo } from '../../src/utils/converter.js'
import axios from 'axios'

const DOCUMENT_THRESHOLD = 100 * 1024 * 1024

const extractVideoId = (value = '') => {
    const text = String(value || '').trim()
    const match = text.match(/(?:youtube\.com\/(?:watch\?.*?v=|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/i)
    return match?.[1] || ''
}

const formatDuration = (seconds) => {
    const total = Number(seconds)
    if (!Number.isFinite(total) || total <= 0) return '-'
    const hours = Math.floor(total / 3600)
    const minutes = Math.floor((total % 3600) / 60)
    const secs = total % 60
    if (hours > 0) {
        return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
    }
    return `${minutes}:${String(secs).padStart(2, '0')}`
}

const fetchWatchMetadata = async (url) => {
    try {
        const videoId = extractVideoId(url)
        if (!videoId) return null

        const { data } = await axios.get(`https://www.youtube.com/watch?v=${videoId}&hl=en`, {
            timeout: 20000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept-Language': 'en-US,en;q=0.9,id;q=0.8'
            }
        })

        const html = String(data || '')
        const playerResponseMatch = html.match(/var ytInitialPlayerResponse\s*=\s*(\{.+?\});/)
        let title = ''
        let author = ''
        let viewCount = ''
        let lengthSeconds = ''
        let thumbnail = ''

        if (playerResponseMatch?.[1]) {
            try {
                const playerResponse = JSON.parse(playerResponseMatch[1])
                const videoDetails = playerResponse?.videoDetails || {}
                const microformat = playerResponse?.microformat?.playerMicroformatRenderer || {}
                title = String(videoDetails.title || '')
                author = String(videoDetails.author || microformat.ownerChannelName || '')
                viewCount = String(videoDetails.viewCount || '')
                lengthSeconds = String(videoDetails.lengthSeconds || '')
                thumbnail =
                    String(microformat?.thumbnail?.thumbnails?.at?.(-1)?.url || '') ||
                    String(videoDetails?.thumbnail?.thumbnails?.at?.(-1)?.url || '')
            } catch {}
        }

        if (!title) {
            title =
                html.match(/<meta name="title" content="([^"]+)"/i)?.[1] ||
                html.match(/"title":"([^"]+)"/)?.[1] ||
                ''
        }

        if (!author) {
            author =
                html.match(/"ownerChannelName":"([^"]+)"/)?.[1] ||
                html.match(/"author":"([^"]+)"/)?.[1] ||
                ''
        }

        if (!viewCount) {
            viewCount =
                html.match(/itemprop="interactionCount"\s+content="(\d+)"/i)?.[1] ||
                html.match(/"viewCount":"(\d+)"/)?.[1] ||
                ''
        }

        if (!lengthSeconds) {
            lengthSeconds = html.match(/"lengthSeconds":"(\d+)"/)?.[1] || ''
        }

        if (!thumbnail) {
            thumbnail =
                html.match(/<meta property="og:image" content="([^"]+)"/i)?.[1] ||
                html.match(/"thumbnailUrl":"([^"]+)"/)?.[1] ||
                ''
        }

        return {
            title: title.replace(/\u0026/g, '&'),
            channel: author.replace(/\u0026/g, '&'),
            views: viewCount,
            duration: formatDuration(lengthSeconds),
            thumbnail: thumbnail.replace(/\\u0026/g, '&')
        }
    } catch {
        return null
    }
}

const fetchYouTubeExtra = async (url) => {
    try {
        const { data } = await axios.get(url, {
            timeout: 20000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept-Language': 'en-US,en;q=0.9,id;q=0.8'
            }
        })

        const html = String(data || '')
        const viewsMatch =
            html.match(/"viewCount":"(\d+)"/) ||
            html.match(/itemprop="interactionCount"\s+content="(\d+)"/i)
        const uploadMatch =
            html.match(/"publishDate":"([^"]+)"/) ||
            html.match(/itemprop="datePublished"\s+content="([^"]+)"/i)

        return {
            views: viewsMatch?.[1] || '',
            published: uploadMatch?.[1] || ''
        }
    } catch {
        return { views: '', published: '' }
    }
}

const formatViewsEnglish = (value) => {
    const raw = String(value || '').replace(/[^0-9]/g, '')
    const n = Number(raw)
    if (!Number.isFinite(n) || n <= 0) return '-'

    const fmt = (num, suffix) => {
        const out = num >= 100 ? Math.round(num) : Number(num.toFixed(1))
        return `${String(out).replace(/\.0$/, '')}${suffix}`
    }

    if (n >= 1_000_000_000) return fmt(n / 1_000_000_000, 'B')
    if (n >= 1_000_000) return fmt(n / 1_000_000, 'M')
    if (n >= 1_000) return fmt(n / 1_000, 'K')
    return `${n}`
}

const formatUploadDate = (value) => {
    const d = new Date(value)
    if (Number.isNaN(d.getTime())) return '-'
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    const day = String(d.getDate()).padStart(2, '0')
    return `${day} ${months[d.getMonth()]} ${d.getFullYear()}`
}

export default {
    name: 'ytmp4',
    aliases: ['ytv'],
    description: 'Download youtube mp4 dari link',
    execute: async ({ sock, msg, text, prefix, command, react, useLimit }) => {
        const jid = msg.key.remoteJid
        const q = String(text || '').trim()

        if (!q) {
            return sock.sendMessage(jid, {
                text: `Contoh penggunaan:\n- ${prefix + command} https://youtu.be/jpFZe_ashHc`
            }, { quoted: msg })
        }

        if (!/https?:\/\/(www\.)?(youtube\.com|youtu\.be)\//i.test(q)) {
            return sock.sendMessage(jid, {
                text: '❌ Link tidak valid. pastikan link dari youtube'
            }, { quoted: msg })
        }

        await react('⏳')

        try {
            const res = await yt1sdl(q, { type: 'video', quality: '480' })
            const videoInfo = Array.isArray(res?.video) ? res.video.find((x) => x?.url) : null

            if (!videoInfo?.url) {
                await react('❌')
                return sock.sendMessage(jid, { text: '❌ Video tidak tersedia untuk link ini.' }, { quoted: msg })
            }

            const raw = await getBuffer(videoInfo.url, { timeout: 120000, maxRedirects: 5 })
            const ext = String(videoInfo.format || 'mp4').toLowerCase()
            const converted = await toVideo(raw, ext)
            const video = converted?.data || converted

            let title = String(res?.title || 'Youtube video').trim()
            let channelName = String(res?.channel?.name || '-').trim()
            let durasi = String(res?.durationLabel || '-').trim()
            let thumbUrl = String(res?.thumbnail || '').trim()
            let views = '-'
            let published = '-'

            const watchMeta = await fetchWatchMetadata(q)
            if (watchMeta) {
                title = watchMeta.title || title
                channelName = watchMeta.channel || channelName
                durasi = watchMeta.duration || durasi
                thumbUrl = watchMeta.thumbnail || thumbUrl
                views = watchMeta.views || views
            }

            if ((!thumbUrl || channelName === '-' || durasi === '-') && title) {
                try {
                    const results = await search(title, 1)
                    const first = results?.[0]
                    if (first) {
                        thumbUrl = first.thumbnail || thumbUrl
                        if (views === '-') views = first.views || views
                        if (published === '-') published = first.published || published
                    }
                } catch {}
            }

            if (views === '-' || published === '-') {
                const extra = await fetchYouTubeExtra(q)
                if (extra.views) views = extra.views
                if (extra.published) published = extra.published
            }

            const viewsLabel = formatViewsEnglish(views)
            const uploadLabel = formatUploadDate(published)

            const caption =
                `\`\`\`• Title: ${title}\n` +
                `• Channel: ${channelName}\n` +
                `• Duration: ${durasi}\n` +
                `• Views: ${viewsLabel}\`\`\``

            if (Buffer.isBuffer(video) && video.length > DOCUMENT_THRESHOLD) {
                await sock.sendMessage(jid, {
                    document: video,
                    mimetype: 'video/mp4',
                    fileName: `${String(title || 'youtube-video').replace(/[\\/:*?"<>|]/g, '-').trim() || 'youtube-video'}.mp4`,
                    caption
                }, { quoted: msg })
            } else {
                await sock.sendMessage(jid, {
                    video,
                    mimetype: 'video/mp4',
                    caption
                }, { quoted: msg })
            }

            useLimit()
            await react('✅')
        } catch (err) {
            await react('❌')
            await sock.sendMessage(jid, {
                text: `❌ Error: ${err?.message}`
            }, { quoted: msg })
        }
    }
}
