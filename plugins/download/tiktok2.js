import axios from 'axios'
import { tiktok2, searchTikTok } from '../../scrape/tiktok.js'

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

export default {
    name: 'tiktok',
    aliases: ['tt', 'tiktokdl', 'ttslide', 'tiktokslide', 'tiktoksearch', 'ttsearch'],
    description: 'Download/search tiktok via endpoint tiktok',
    execute: async ({ sock, msg, text, prefix, command, react, useLimit }) => {
        const jid = msg.key.remoteJid
        const isSearchCommand = ['tiktoksearch', 'ttsearch'].includes(String(command || '').toLowerCase())

        if (!text) {
            if (isSearchCommand) {
                return sock.sendMessage(jid, {
                    text: `❌ Masukkan kata pencarian tiktok.`
                }, { quoted: msg })
            }

            return sock.sendMessage(jid, {
                text: `❌ Masukkan link tiktok\n\nContoh:\n${prefix + command} https://vm.tiktok.com/xxx`
            }, { quoted: msg })
        }

        const urlMatch = text.match(TIKTOK_REGEX)

        if (isSearchCommand && urlMatch) {
            return sock.sendMessage(jid, {
                text: `❌ Command ${prefix + command} khusus pencarian kata, bukan link.\n\nContoh:\n${prefix + command} anime`
            }, { quoted: msg })
        }

        if (urlMatch && !isSearchCommand) {
            const url = urlMatch[0]
            await react('⏳')

            try {
                const result = await tiktok2(url)

                if (result.type === 'photo') {
                    const { images, author, description, music, stats } = result

                    const caption =
                        `> Creator: @${author?.username || '?'} (${author?.nickname || '?'})\n\n` +
                        `${description || '-'}\n\n` +
                        `👁 ${fmtNum(stats?.plays)}  ❤️ ${fmtNum(stats?.likes)}  💬 ${fmtNum(stats?.comments)}`

                    const mediaBuffers = await Promise.all(images.map((img) => fetchBuffer(img.url)))
                    const albumItems = mediaBuffers.map((buf, i) => ({
                        image: buf,
                        ...(i === 0 ? { caption } : {})
                    }))

                    await sock.sendMessage(jid, { albumMessage: albumItems }, { quoted: msg })

                    if (music?.url) {
                        const audioBuf = await fetchBuffer(music.url)
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

                const { video, author, description, music, stats } = result
                const caption =
                    `> Creator: @${author?.username || '?'} (${author?.nickname || '?'})\n\n` +
                    `${description || ' '}\n\n` +
                    `👁 ${fmtNum(stats?.plays)}  ❤️ ${fmtNum(stats?.likes)}  💬 ${fmtNum(stats?.comments)}`

                const videoBuf = await fetchBuffer(video.url)
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
                    text: `❌ Gagal mengunduh TikTok: ${err.message}`
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
                    text: `❌ Tidak ada hasil untuk: *${text}*`
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
