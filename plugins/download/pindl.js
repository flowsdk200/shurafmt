import axios from 'axios'
import { getPinterestData } from '../../scrape/pinterest.js'

const PIN_URL_REGEX = /https?:\/\/(?:www\.)?(?:id\.)?pinterest\.[^\s]+|https?:\/\/pin\.it\/[^"]+/i

const fetchBuffer = async (url) => {
    const { data } = await axios.get(url, {
        responseType: 'arraybuffer',
        timeout: 60000,
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
    })
    return Buffer.from(data)
}

export default {
    name: 'pindl',
    aliases: ['pinterestdl', 'pindownload'],
    description: 'Download media dari link pinterest',
    execute: async ({ sock, msg, text, prefix, command, react, useLimit }) => {
        const jid = msg.key.remoteJid
        const q = String(text || '').trim()

        if (!q) {
            return sock.sendMessage(jid, {
                text: `Contoh penggunaan:\n- ${prefix + command} https://pin.it/2jP9MFHeV`
            }, { quoted: msg })
        }

        const url = q.match(PIN_URL_REGEX)?.[0]
        if (!url) {
            return sock.sendMessage(jid, {
                text: '❌ Link tidak valid. pastikan link dari pinterest'
            }, { quoted: msg })
        }

        await react('⏳')

        try {
            const data = await getPinterestData(url)
            const title = data?.post?.title || '(no title)'
            const author = data?.user?.username ? `@${data.user.username}` : data?.user?.fullName || '-'
            const caption =
                `\`\`\`> Author: ${author}\n\n\`\`\`` +
                `\`\`\`${title}\`\`\``

            const videoUrl = data?.content?.videos?.[0] || ''
            if (videoUrl) {
                await sock.sendMessage(jid, {
                    video: { url: videoUrl },
                    caption,
                    mimetype: 'video/mp4'
                }, { quoted: msg })

                useLimit()
                await react('✅')
                return
            }

            const imageUrls = [...new Set((data?.content?.images || []).map((x) => x?.url).filter(Boolean))]
            if (!imageUrls.length) {
                await react('❌')
                return sock.sendMessage(jid, {
                    text: '❌ Media pinterest tidak ditemukan.'
                }, { quoted: msg })
            }

            const buffers = await Promise.all(imageUrls.map((u) => fetchBuffer(u).catch(() => null)))
            const valid = buffers.filter((b) => b && b.length)
            if (!valid.length) {
                await react('❌')
                return sock.sendMessage(jid, {
                    text: '❌ Semua gambar gagal diambil.'
                }, { quoted: msg })
            }

            const albumItems = valid.map((buf, i) => ({
                image: buf,
                ...(i === 0 ? { caption } : {})
            }))

            await sock.sendMessage(jid, { albumMessage: albumItems }, { quoted: msg })

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
