/*
import axios from 'axios'
import { MusicalDown, searchTikTok } from '../../scrape/tiktok.js'

const TIKTOK_REGEX = /https?:\/\/(vm\.|vt\.|www\.|m\.)?tiktok\.com\/[^\s]+/i

const fmtNum = (n) => {
    if (!n && n !== 0) return '?'
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
    if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K'
    return String(n)
}

const fmtDur = (s) => {
    if (!s) return '?'
    const m = Math.floor(s / 60)
    const sec = String(s % 60).padStart(2, '0')
    return `${m}:${sec}`
}

const fetchBuffer = async (url) => {
    const { data } = await axios.get(url, {
        responseType: 'arraybuffer',
        timeout: 60000,
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
    })
    return Buffer.from(data)
}

const pickVideoLink = (links = []) => {
    return links.find((l) => l.type === 'mp4_hd')?.url
        || links.find((l) => l.type === 'mp4')?.url
        || links.find((l) => l.type === 'mp4_watermark')?.url
        || null
}

export default {
    name: 'tiktok',
    aliases: ['tt', 'tiktokdl'],
    description: 'Download video/foto TikTok atau cari video TikTok',
    execute: async ({ sock, msg, text, prefix, command, react, useLimit }) => {
        const jid = msg.key.remoteJid
        const client = new MusicalDown()

        if (!text) {
            return sock.sendMessage(jid, {
                text: `❌ Masukkan link tiktok atau kata pencarian.\n\nContoh:\n${prefix + command} https://vt.tiktok.com/xxxx\n${prefix + command} anime`
            }, { quoted: msg })
        }

        const urlMatch = text.match(TIKTOK_REGEX)

        if (urlMatch) {
            const url = urlMatch[0]
            await react('⏳')

            try {
                const result = await client.download(url)

                if (result.type === 'slideshow') {
                    const photos = result.photos || []
                    if (!photos.length) {
                        await react('❌')
                        return sock.sendMessage(jid, {
                            text: '❌ Slideshow ditemukan, tapi daftar foto kosong.'
                        }, { quoted: msg })
                    }

                    const caption =
                        `📸 TIKTOK SLIDESHOW\n\n` +
                        `▦ Foto: ${photos.length} gambar`

                    const mediaBuffers = await Promise.all(
                        photos.map((item) => fetchBuffer(item.downloadUrl))
                    )

                    const albumItems = mediaBuffers.map((buf, i) => ({
                        image: buf,
                        ...(i === 0 ? { caption } : {})
                    }))

                    await sock.sendMessage(jid, { albumMessage: albumItems }, { quoted: msg })

                    if (result.mp3Url) {
                        const audioBuf = await fetchBuffer(result.mp3Url)
                        await sock.sendMessage(jid, {
                            audio: audioBuf,
                            mimetype: 'audio/mp4',
                            ptt: false
                        }, { quoted: msg })
                    }

                    useLimit()
                    await react('✅')
                    return
                }

                const videoUrl = pickVideoLink(result.links)
                if (!videoUrl) {
                    await react('❌')
                    return sock.sendMessage(jid, {
                        text: '❌ Gagal mendapatkan link video dari MusicalDown.'
                    }, { quoted: msg })
                }

                const caption =
                    `> Creator ${result.author || '-'}\n\n` +
                    `${result.description || ' '}\n`

                const videoBuf = await fetchBuffer(videoUrl)
                await sock.sendMessage(jid, {
                    video: videoBuf,
                    caption,
                    mimetype: 'video/mp4'
                }, { quoted: msg })

                useLimit()
                await react('✅')
            } catch (err) {
                await react('❌')
                await sock.sendMessage(jid, {
                    text: `❌ Gagal mengunduh tiktok: ${err.message}`
                }, { quoted: msg })
            }
            return
        }

        await react('⏳')

        try {
            const results = await searchTikTok(text, 20)
            if (!results.length) {
                await react('❌')
                return sock.sendMessage(jid, {
                    text: `❌ Tidak ada hasil untuk: ${text}`
                }, { quoted: msg })
            }

            const valid = results.filter((r) => r.videoUrl)
            if (!valid.length) {
                await react('❌')
                return sock.sendMessage(jid, {
                    text: '❌ Tidak ada video yang bisa diunduh dari hasil pencarian.'
                }, { quoted: msg })
            }

            const item = valid[Math.floor(Math.random() * valid.length)]
            const caption =
                `> Creator: @${item.author?.username || '?'} (${item.author?.nickname || '?'})\n\n` +
                `${(item.title || ' ').slice(0, 80)}\n\n` +

                `👁 ${fmtNum(item.stats?.plays)}  ❤️ ${fmtNum(item.stats?.likes)}  💬 ${fmtNum(item.stats?.comments)}`

            const buf = await fetchBuffer(item.videoUrl)
            await sock.sendMessage(jid, {
                video: buf,
                caption,
                mimetype: 'video/mp4'
            }, { quoted: msg })

            useLimit()
            await react('✅')
        } catch (err) {
            await react('❌')
            await sock.sendMessage(jid, {
                text: `❌ Gagal mencari: ${err.message}`
            }, { quoted: msg })
        }
    }
}
*/