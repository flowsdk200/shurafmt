import axios from 'axios'
import { createRequire } from 'module'
import { threads, isThreadsUrl } from '../../scrape/threads.js'

const require = createRequire(import.meta.url)
const { Jimp } = require('jimp')

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

const toJpegBuffer = async (buffer) => {
    const image = await Jimp.fromBuffer(buffer)
    return image.getBuffer('image/jpeg')
}

const formatCaption = (result = {}) => {
    const author = String(result.author || '-').trim() || '-'
    const captionText = String(result.caption || '').trim()
    return captionText
        ? `\`Author: ${author}\`\n\n${captionText}`
        : `\`Author: ${author}\``
}

export default {
    name: 'threads',
    aliases: ['thread', 'threadsdl'],
    description: 'Download media dari Threads via ThreadsMate',
    execute: async ({ sock, msg, text, prefix, command, react, useLimit }) => {
        const jid = msg.key.remoteJid
        const q = String(text || '').trim()

        if (!q) {
            return sock.sendMessage(jid, {
                text: `Contoh penggunaan:\n- ${prefix + command} https://www.threads.com/@zlfnap/post/DWPxxY6kxYG`
            }, { quoted: msg })
        }

        if (!isThreadsUrl(q)) {
            return sock.sendMessage(jid, {
                text: '❌ Link tidak valid. pastikan link dari Threads.'
            }, { quoted: msg })
        }

        await react('⏳')

        try {
            const result = await threads(q)
            const media = Array.isArray(result?.media) ? result.media : []
            if (!media.length) {
                await react('❌')
                return sock.sendMessage(jid, {
                    text: '❌ Media tidak ditemukan pada post threads tersebut.'
                }, { quoted: msg })
            }

            const caption = formatCaption(result)
            const allImages = media.length > 1 && media.every((item) => item?.type === 'image' && item?.url)
            const allVideos = media.length > 1 && media.every((item) => item?.type === 'video' && item?.url)

            if (allImages) {
                const buffers = []
                for (const item of media) {
                    try {
                        const buffer = await fetchBuffer(item.url)
                        buffers.push(await toJpegBuffer(buffer))
                    } catch {}
                }

                if (!buffers.length) throw new Error('❌ Semua gambar threads gagal diambil')

                const albumMessage = buffers.map((buffer, index) => ({
                    image: buffer,
                    ...(index === 0 ? { caption } : {})
                }))
                await sock.sendMessage(jid, { albumMessage }, { quoted: msg })

                useLimit()
                await react('✅')
                return
            }

            if (allVideos) {
                const buffers = []
                for (const item of media) {
                    try {
                        buffers.push(await fetchBuffer(item.url))
                    } catch {}
                }

                if (!buffers.length) throw new Error('❌ Semua video threads gagal diambil')

                const albumMessage = buffers.map((buffer, index) => ({
                    video: buffer,
                    mimetype: 'video/mp4',
                    ...(index === 0 ? { caption } : {})
                }))
                await sock.sendMessage(jid, { albumMessage }, { quoted: msg })

                useLimit()
                await react('✅')
                return
            }

            let sent = false
            for (const item of media) {
                if (!item?.url) continue

                if (item.type === 'video') {
                    const video = await fetchBuffer(item.url)
                    await sock.sendMessage(jid, {
                        video,
                        mimetype: 'video/mp4',
                        ...(sent ? {} : { caption })
                    }, { quoted: msg })
                    sent = true
                    continue
                }

                const image = await toJpegBuffer(await fetchBuffer(item.url))
                await sock.sendMessage(jid, {
                    image,
                    ...(sent ? {} : { caption })
                }, { quoted: msg })
                sent = true
            }

            if (!sent) throw new Error('❌ Tidak ada media threads yang berhasil dikirim')

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
