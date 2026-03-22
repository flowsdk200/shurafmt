import { downloadContentFromMessage } from 'baileys'
import { createRequire } from 'module'
import { upscale } from '../../scrape/upscale.js'

const require = createRequire(import.meta.url)
const { Jimp } = require('jimp')

const streamToBuffer = async (stream) => {
    const chunks = []
    for await (const chunk of stream) chunks.push(chunk)
    return Buffer.concat(chunks)
}

const MAX_UPSCALE_DIMENSION = 4096

const normalizeImageBuffer = async (buffer) => {
    try {
        const image = await Jimp.fromBuffer(buffer)
        const width = Number(image?.bitmap?.width || 0)
        const height = Number(image?.bitmap?.height || 0)
        const longestSide = Math.max(width, height)

        if (longestSide > MAX_UPSCALE_DIMENSION && width > 0 && height > 0) {
            const ratio = MAX_UPSCALE_DIMENSION / longestSide
            image.resize({
                w: Math.max(1, Math.floor(width * ratio)),
                h: Math.max(1, Math.floor(height * ratio))
            })
        }

        if (typeof image.quality === 'function') {
            image.quality(90)
        }

        return await image.getBuffer('image/jpeg')
    } catch {
        return buffer
    }
}

const makeUserErrorMessage = (error) => {
    if (['FAILED', 'FAILURE', 'ERROR', 'CANCELLED'].includes(String(error?.status || '').toUpperCase())) {
        return 'Upscale provider gagal memproses gambar itu setelah dinormalisasi. Kirim ulang gambar lain atau coba crop dulu gambarnya.'
    }

    return error?.message || 'Upscale gagal.'
}

export default {
    name: 'uhd',
    aliases: ['upscaler'],
    description: 'Upscale gambar pakai Upscale.media',
    execute: async ({ sock, msg, isQuoted, quotedMsg, quotedType, react, useLimit, prefix, command }) => {
        const jid = msg.key.remoteJid
        const scale = '2X'

        let image = null
        if (isQuoted && quotedType === 'imageMessage' && quotedMsg?.imageMessage) {
            image = quotedMsg.imageMessage
        } else if (msg.message?.imageMessage) {
            image = msg.message.imageMessage
        }

        if (!image) {
            return sock.sendMessage(jid, {
                text: `❌ Kirim/reply gambar dengan caption ${prefix + command}`
            }, { quoted: msg })
        }

        await react('⏳')

        try {
            const stream = await downloadContentFromMessage(image, 'image')
            const input = await streamToBuffer(stream)
            const normalized = await normalizeImageBuffer(input)
            const result = await upscale(normalized, {
                type: scale,
                filename: 'upscale-input.jpg',
                contentType: 'image/jpeg',
                maxPoll: 40,
                intervalMs: 2000
            })

            await sock.sendMessage(jid, {
                image: { url: result.url },
                caption: `\`\`\`${command.toUpperCase()} (${scale})\`\`\``
            }, { quoted: msg })

            useLimit()
            await react('✅')
        } catch (err) {
            console.error('[uhd] upscale failed', {
                message: err?.message,
                status: err?.status,
                predictionId: err?.predictionId,
                details: err?.details,
                inputMimetype: image?.mimetype,
                normalizedAs: 'image/jpeg',
                maxDimension: MAX_UPSCALE_DIMENSION,
                stack: err?.stack
            })
            await react('❌')
            await sock.sendMessage(jid, {
                text: `❌ Error: ${makeUserErrorMessage(err)}`
            }, { quoted: msg })
        }
    }
}
