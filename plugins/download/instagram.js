import axios from 'axios'
import { instagram, isInstagramUrl } from '../../scrape/instagram.js'

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

const buildPreviewText = (result) => {
    const raw = String(result?.caption || result?.postTitle || result?.title || '').trim()
    if (!raw) return ''

    return raw
        .replace(/\s+/g, ' ')
        .split('\n')[0]
        .trim()
        .slice(0, 80)
}

const formatCaption = (result) => {
    const author = result?.author || {}
    const stats = result?.stats || {}
    const type = String(result?.type || 'media').toLowerCase()
    const authorLine = author?.username ? `@${author.username}` : (author?.fullName || '-')
    const verified = author?.isVerified ? 'yes' : 'no'
    const followers = author?.followersCount || '-'
    const likes = stats?.likes || '-'
    const comments = stats?.comments || '-'
    const preview = buildPreviewText(result)

    if (type === 'story') {
        return (
            `\`\`\`✅ INSTAGRAM STORY\n\n` +
            `• Author: ${authorLine}\n` +
            `• Verified: ${verified}\n` +
            `• Followers: ${followers}\`\`\``
        )
    }

    return (
        `\`\`\`✅ INSTAGRAM ${result?.type.toUpperCase()}\n\n` +
        `${preview ? `• Caption: ${preview}\n` : ''}` +
        `• Author: ${authorLine}\n` +
        `• Verified: ${verified}\n` +
        `• Followers: ${followers}\n` +
        `• Likes: ${likes}\n` +
        `• Comments: ${comments}\`\`\``
    )
}

export default {
    name: 'instagram',
    aliases: ['ig', 'igdl', 'instagram', 'igstory', 'igreel', 'igpost'],
    description: 'Download instagram post/reel/story',
    execute: async ({ sock, msg, text, prefix, command, react, useLimit }) => {
        const jid = msg.key.remoteJid
        const q = String(text || '').trim()

        if (!q) {
            return sock.sendMessage(jid, {
                text:
                    `Mana linknya?`
            }, { quoted: msg })
        }

        const isUrl = isInstagramUrl(q)
        const isUsername = !isUrl && /^[A-Za-z0-9._]{1,30}$/.test(q.replace(/^@/, ''))
        if (!isUrl && !isUsername) {
            return sock.sendMessage(jid, {
                text: '❌ Input harus link instagram atau username untuk story.'
            }, { quoted: msg })
        }

        await react('⏳')

        try {
            const result = await instagram(q)
            const media = Array.isArray(result?.media) ? result.media : []
            if (!media.length) {
                await react('❌')
                return sock.sendMessage(jid, {
                    text: '❌ Media tidak ditemukan dari input tersebut.'
                }, { quoted: msg })
            }

            const caption = formatCaption(result)
            const images = media.filter((m) => m?.type === 'image')
            const videos = media.filter((m) => m?.type === 'video')

            if (images.length && !videos.length && images.length > 1) {
                const imageBuffers = []
                for (const item of images) {
                    const src = item.sourceUrl || item.url
                    try {
                        imageBuffers.push(await fetchBuffer(src))
                    } catch {}
                }

                if (!imageBuffers.length) throw new Error('❌ Semua gambar gagal diambil')

                const album = imageBuffers.map((buf, i) => ({
                    image: buf,
                    ...(i === 0 ? { caption } : {})
                }))
                await sock.sendMessage(jid, { albumMessage: album }, { quoted: msg })
            } else {
                let sent = false
                for (const item of media) {
                    const src = item?.sourceUrl || item?.url
                    if (!src) continue
                    if (item.type === 'video') {
                        await sock.sendMessage(jid, {
                            video: { url: src },
                            mimetype: 'video/mp4',
                            ...(sent ? {} : { caption })
                        }, { quoted: msg })
                        sent = true
                    } else {
                        await sock.sendMessage(jid, {
                            image: { url: src },
                            ...(sent ? {} : { caption })
                        }, { quoted: msg })
                        sent = true
                    }
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
