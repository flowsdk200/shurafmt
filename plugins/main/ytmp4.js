import { yt1sdl } from '../../scrape/yt1s.js'
import { search } from '../../scrape/ytsearch.js'
import { getBuffer, toVideo } from '../../src/utils/converter.js'
import axios from 'axios'

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
        return `${String(out).replace(/\.0$/, '')}${suffix} views`
    }

    if (n >= 1_000_000_000) return fmt(n / 1_000_000_000, 'B')
    if (n >= 1_000_000) return fmt(n / 1_000_000, 'M')
    if (n >= 1_000) return fmt(n / 1_000, 'K')
    return `${n} views`
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
    description: 'Download YouTube MP4 dari link',
    execute: async ({ sock, msg, text, prefix, command, react, useLimit }) => {
        const jid = msg.key.remoteJid
        const q = String(text || '').trim()

        if (!q) {
            return sock.sendMessage(jid, {
                text: `Contoh penggunaan\n- ${prefix + command} https://youtu.be/jpFZe_ashHc`
            }, { quoted: msg })
        }

        if (!/https?:\/\/(www\.)?(youtube\.com|youtu\.be)\//i.test(q)) {
            return sock.sendMessage(jid, {
                text: '❌ Masukkan link youtube yang valid.'
            }, { quoted: msg })
        }

        await react('⏳')

        try {
            const res = await yt1sdl(q, { type: 'video', quality: '360' })
            const videoInfo = Array.isArray(res?.video) ? res.video.find((x) => x?.url) : null

            if (!videoInfo?.url) {
                await react('❌')
                return sock.sendMessage(jid, { text: '❌ Video tidak tersedia untuk link ini.' }, { quoted: msg })
            }

            const raw = await getBuffer(videoInfo.url, { timeout: 120000, maxRedirects: 5 })
            const ext = String(videoInfo.format || 'mp4').toLowerCase()
            const converted = await toVideo(raw, ext)
            const video = converted?.data || converted

            let title = String(res?.title || 'YouTube Video').trim()
            let channelName = String(res?.channel?.name || '-').trim()
            let durasi = String(res?.durationLabel || '-').trim()
            let thumbUrl = String(res?.thumbnail || '').trim()
            let views = '-'
            let published = '-'

            if (!thumbUrl || channelName === '-' || durasi === '-') {
                try {
                    const results = await search(title, 1)
                    const first = results?.[0]
                    if (first) {
                        title = first.title || title
                        channelName = first.channel || channelName
                        durasi = first.duration || durasi
                        thumbUrl = first.thumbnail || thumbUrl
                        views = first.views || views
                        published = first.published || published
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

            await sock.sendMessage(jid, {
                video,
                mimetype: 'video/mp4',
                caption:
                    `\`\`\`× Title: ${title}\n` +
                    `× Channel: ${channelName}\n` +
                    `× Duration: ${durasi}\n` +
                    `× Views: ${viewsLabel}\n` +
                    `× Upload: ${uploadLabel}\`\`\``
            }, { quoted: msg })

            useLimit()
            await react('✅')
        } catch (err) {
            await react('❌')
            await sock.sendMessage(jid, {
                text: `❌ Gagal: ${err?.message || 'Coba lagi nanti.'}`
            }, { quoted: msg })
        }
    }
}
