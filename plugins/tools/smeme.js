import FormData from 'form-data'
import { downloadContentFromMessage } from 'baileys'
import { getBuffer } from '../../src/utils/converter.js'
import { makeSticker } from '../../src/utils/exif.js'
import axios from 'axios'
import mime from 'mime-types'

const cleanText = (value) => String(value || '').replace(/\s+/g, ' ').trim()

const streamToBuffer = async (stream) => {
    const chunks = []
    for await (const chunk of stream) chunks.push(chunk)
    return Buffer.concat(chunks)
}

const uploadToUgu = async (buffer, filename = 'meme-input.jpg') => {
    const form = new FormData()
    form.append('files[]', buffer, filename)

    const { data, status } = await axios.post('https://uguu.se/upload.php', form, {
        headers: {
            ...form.getHeaders(),
            'User-Agent': 'Mozilla/5.0'
        },
        timeout: 120000,
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
        validateStatus: () => true
    })

    const url = cleanText(data?.files?.[0]?.url || '')
    if (!/^https?:\/\//i.test(url)) {
        const err = cleanText(data?.message || data?.error || '')
        throw new Error(err || `Upload Ugu gagal (HTTP ${status})`)
    }
    return url
}

const parseMemeText = (raw) => {
    const q = cleanText(raw)
    const [topRaw, bottomRaw] = q.split('|')
    const top = cleanText(topRaw || '-') || '-'
    const bottom = cleanText(bottomRaw || '-') || '-'
    return { top, bottom }
}

export default {
    name: 'smeme',
    aliases: ['stickmeme', 'stikmeme'],
    description: 'Buat meme dari gambar reply lalu kirim sebagai sticker',
    execute: async ({ sock, msg, text, isQuoted, quotedMsg, quotedType, react, useLimit, prefix, command, pushName }) => {
        const jid = msg.key.remoteJid
        const q = cleanText(text)

        if (!q) {
            return sock.sendMessage(jid, {
                text:
                    `Cara penggunaan:\n` +
                    `- ${prefix + command} teks atas|teks bawah + reply gambar`
            }, { quoted: msg })
        }

        if (!isQuoted || !quotedMsg || quotedType !== 'imageMessage') {
            return sock.sendMessage(jid, {
                text: '⚠️ Reply gambar yang ingin dijadikan meme'
            }, { quoted: msg })
        }

        await react('⏳')

        try {
            const stream = await downloadContentFromMessage(quotedMsg.imageMessage, 'image')
            const imageBuffer = await streamToBuffer(stream)
            if (!imageBuffer.length) throw new Error('Gagal membaca gambar reply')

            const mimeType = cleanText(quotedMsg?.imageMessage?.mimetype) || 'image/jpeg'
            const ext = mime.extension(mimeType) || 'jpg'
            const uploadName = `meme-input.${ext}`

            const uploadedUrl = await uploadToUgu(imageBuffer, uploadName)
            const { top, bottom } = parseMemeText(q)

            const memeUrl =
                `https://api.memegen.link/images/custom/${encodeURIComponent(top)}/${encodeURIComponent(bottom)}.png` +
                `?background=${encodeURIComponent(uploadedUrl)}`

            const memeBuffer = await getBuffer(memeUrl, { timeout: 60000 })

            await makeSticker(sock, jid, memeBuffer, {
                packname: cleanText(pushName) || 'smeme',
                quoted: msg
            })

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
