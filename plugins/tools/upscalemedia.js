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

const SCALE_DIMENSION_LIMITS = {
    '1X': 10000,
    '2X': 5000,
    '4X': 2500,
    '8X': 1250
}

const MIME_EXTENSION_MAP = {
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp'
}

const NORMALIZABLE_MIMES = new Set(Object.keys(MIME_EXTENSION_MAP))

const normalizeImageBuffer = async (buffer, options = {}) => {
    const inputContentType = String(options.contentType || '').toLowerCase() || 'image/jpeg'
    const outputLimit = Number(SCALE_DIMENSION_LIMITS[String(options.scale || '').toUpperCase()] || 2500)

    try {
        const image = await Jimp.fromBuffer(buffer)
        const width = Number(image?.bitmap?.width || 0)
        const height = Number(image?.bitmap?.height || 0)
        const needsResize = width > outputLimit || height > outputLimit
        const canKeepOriginal = NORMALIZABLE_MIMES.has(inputContentType)

        if (!needsResize && canKeepOriginal) {
            return {
                buffer,
                contentType: inputContentType,
                filename: `upscale-input.${MIME_EXTENSION_MAP[inputContentType]}`,
                normalizedAs: inputContentType,
                maxDimension: outputLimit
            }
        }

        if (needsResize && width > 0 && height > 0) {
            const ratio = Math.min(outputLimit / width, outputLimit / height)
            image.resize({
                w: Math.max(1, Math.floor(width * ratio)),
                h: Math.max(1, Math.floor(height * ratio))
            })
        }

        if (inputContentType === 'image/png' || inputContentType === 'image/webp') {
            return {
                buffer: await image.getBuffer('image/png'),
                contentType: 'image/png',
                filename: 'upscale-input.png',
                normalizedAs: 'image/png',
                maxDimension: outputLimit
            }
        }

        if (typeof image.quality === 'function') image.quality(95)

        return {
            buffer: await image.getBuffer('image/jpeg'),
            contentType: 'image/jpeg',
            filename: 'upscale-input.jpg',
            normalizedAs: 'image/jpeg',
            maxDimension: outputLimit
        }
    } catch {
        return {
            buffer,
            contentType: inputContentType || 'image/jpeg',
            filename: `upscale-input.${MIME_EXTENSION_MAP[inputContentType] || 'jpg'}`,
            normalizedAs: inputContentType || 'image/jpeg',
            maxDimension: outputLimit
        }
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
    aliases: ['hdr'],
    description: 'Upscale gambar pakai Upscale.media',
    execute: async ({ sock, msg, isQuoted, quotedMsg, quotedType, react, useLimit, prefix, command }) => {
        const jid = msg.key.remoteJid
        const scale = '4X'

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

        let prepared = null

        try {
            const stream = await downloadContentFromMessage(image, 'image')
            const input = await streamToBuffer(stream)
            prepared = await normalizeImageBuffer(input, {
                scale,
                contentType: image?.mimetype || 'image/jpeg'
            })
            const result = await upscale(prepared.buffer, {
                type: scale,
                filename: prepared.filename,
                contentType: prepared.contentType,
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
                normalizedAs: prepared?.normalizedAs,
                preparedContentType: prepared?.contentType,
                preparedFilename: prepared?.filename,
                maxDimension: prepared?.maxDimension,
                stack: err?.stack
            })
            await react('❌')
            await sock.sendMessage(jid, {
                text: `❌ Error: ${makeUserErrorMessage(err)}`
            }, { quoted: msg })
        }
    }
}
