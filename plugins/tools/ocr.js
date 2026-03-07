import axios from 'axios'
import FormData from 'form-data'
import { downloadContentFromMessage } from 'baileys'

const OCR_API = 'https://api.ocr.space/parse/image'
const OCR_API_KEY = 'K84541928888957'
const REQUEST_TIMEOUT = 30000

const cleanText = (value) => String(value || '').replace(/\s+/g, ' ').trim()

const streamToBuffer = async (stream) => {
    const chunks = []
    for await (const chunk of stream) chunks.push(chunk)
    return Buffer.concat(chunks)
}

const pickImageSource = ({ msg, isQuoted, quotedMsg, quotedType }) => {
    if (isQuoted && quotedMsg && quotedType === 'imageMessage') {
        return {
            media: quotedMsg.imageMessage,
            mime: cleanText(quotedMsg.imageMessage?.mimetype)
        }
    }

    if (msg?.message?.imageMessage) {
        return {
            media: msg.message.imageMessage,
            mime: cleanText(msg.message.imageMessage?.mimetype)
        }
    }

    return null
}

const normalizeExt = (mime) => {
    const raw = cleanText(mime).toLowerCase()
    if (raw.includes('jpeg') || raw.includes('jpg')) return 'jpg'
    if (raw.includes('png')) return 'png'
    if (raw.includes('webp')) return 'webp'
    return ''
}

const uploadForOcr = async (buffer, ext) => {
    const fileExt = ext === 'webp' ? 'jpg' : ext
    const form = new FormData()
    form.append('file', buffer, { filename: `ocr.${fileExt}` })
    form.append('language', 'eng')
    form.append('isOverlayRequired', 'false')
    form.append('filetype', (ext === 'webp' ? 'JPG' : ext).toUpperCase())
    form.append('detectOrientation', 'true')
    form.append('scale', 'true')

    const { data, status } = await axios.post(OCR_API, form, {
        headers: {
            ...form.getHeaders(),
            apikey: OCR_API_KEY
        },
        timeout: REQUEST_TIMEOUT,
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
        validateStatus: () => true
    })

    if (status !== 200) throw new Error(`OCR HTTP ${status}`)
    return data
}

export default {
    name: 'ocr',
    aliases: ['extracttext', 'totext'],
    description: 'Extract text dari gambar (OCR)',
    execute: async ({ sock, msg, isQuoted, quotedMsg, quotedType, prefix, command, react, useLimit }) => {
        const jid = msg.key.remoteJid
        const source = pickImageSource({ msg, isQuoted, quotedMsg, quotedType })

        if (!source?.media) {
            return sock.sendMessage(jid, {
                text: `Kirim/reply gambar dengan caption ${prefix + command}`
            }, { quoted: msg })
        }

        const ext = normalizeExt(source.mime)
        if (!ext) {
            return sock.sendMessage(jid, {
                text: `Kirim/reply gambar dengan caption ${prefix + command}`
            }, { quoted: msg })
        }

        await react('⏳')

        try {
            const stream = await downloadContentFromMessage(source.media, 'image')
            const buffer = await streamToBuffer(stream)
            if (!buffer.length) throw new Error('Gagal membaca gambar')

            const data = await uploadForOcr(buffer, ext)
            if (data?.IsErroredOnProcessing) {
                const errMsg = Array.isArray(data?.ErrorMessage)
                    ? cleanText(data.ErrorMessage.join(', '))
                    : cleanText(data?.ErrorMessage)
                throw new Error(errMsg || 'OCR gagal diproses')
            }

            const text = cleanText(data?.ParsedResults?.[0]?.ParsedText)
            if (!text) {
                return sock.sendMessage(jid, {
                    text: '❌ Tidak ada text yang terdeteksi di gambar.'
                }, { quoted: msg })
            }

            await sock.sendMessage(jid, { text: `${text}\n` }, { quoted: msg })
            useLimit()
            await react('✅')
        } catch (err) {
            await react('❌')
            await sock.sendMessage(jid, {
                text: `❌ Gagal extract text: ${cleanText(err?.message) || 'Coba lagi nanti.'}`
            }, { quoted: msg })
        }
    }
}
