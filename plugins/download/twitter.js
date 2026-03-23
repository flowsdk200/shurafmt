import axios from 'axios'
import { twitter, isTwitterUrl } from '../../scrape/twitter.js'

const fetchBuffer = async (url) => {
    const { data } = await axios.get(url, {
        responseType: 'arraybuffer',
        timeout: 120000,
        maxRedirects: 5,
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
    })
    return Buffer.from(data)
}

const buildCaption = (data = {}) => {
    const author = data.author || {}
    const name = String(author.name || '').trim()
    const username = String(author.username || '').trim()
    const text = String(data.text || '').replace(/(?:\s+https:\/\/t\.co\/\w+)+\s*$/i, '').trim()
    const authorLine = name || (username ? `@${username}` : '-')

    return `\`Author: ${authorLine}\`\n\n${text || '-'}`
}

export default {
    name: 'twitter',
    aliases: ['x', 'xdl', 'tw', 'twdl'],
    description: 'Download media dari link twitter/x',
    execute: async ({ sock, msg, text, prefix, command, react, useLimit }) => {
        const jid = msg.key.remoteJid
        const q = String(text || '').trim()

        if (!q) {
            return sock.sendMessage(jid, {
                text: `Contoh penggunaan:\n- ${prefix + command} https://x.com/ai_uncovered/status/2012661278066770236`
            }, { quoted: msg })
        }

        if (!isTwitterUrl(q)) {
            return sock.sendMessage(jid, {
                text: '❌ Link tidak valid. pastikan link dari twitter/x'
            }, { quoted: msg })
        }

        await react('⏳')

        try {
            const result = await twitter(q)
            const media = Array.isArray(result?.media) ? result.media : []
            if (!media.length) {
                await react('❌')
                return sock.sendMessage(jid, {
                    text: '❌ Media tidak ditemukan pada tweet tersebut.'
                }, { quoted: msg })
            }

            const caption = buildCaption(result)
            const images = media.filter((m) => m?.type === 'image' && m?.url)
            const videos = media.filter((m) => (m?.type === 'video' || m?.type === 'gif') && m?.url)

            if (images.length > 1 && !videos.length) {
                const buffers = await Promise.all(images.map((m) => fetchBuffer(m.url).catch(() => null)))
                const valid = buffers.filter((b) => b && b.length)

                if (!valid.length) throw new Error('❌ Semua gambar gagal diambil')

                const album = valid.map((buf, i) => ({
                    image: buf,
                    ...(i === 0 ? { caption } : {})
                }))

                await sock.sendMessage(jid, { albumMessage: album }, { quoted: msg })
            } else {
                let sent = false
                for (const item of media) {
                    if (!item?.url) continue

                    if (item.type === 'video' || item.type === 'gif') {
                        await sock.sendMessage(jid, {
                            video: { url: item.url },
                            mimetype: 'video/mp4',
                            ...(sent ? {} : { caption })
                        }, { quoted: msg })
                        sent = true
                        continue
                    }

                    await sock.sendMessage(jid, {
                        image: { url: item.url },
                        ...(sent ? {} : { caption })
                    }, { quoted: msg })
                    sent = true
                }

                if (!sent) throw new Error('❌ Tidak ada media yang berhasil dikirim')
            }

            useLimit()
            await react('✅')
        } catch (err) {
            await react('❌')
            await sock.sendMessage(jid, {
                text: `❌ Error: ${err.message}`
            }, { quoted: msg })
        }
    }
}
