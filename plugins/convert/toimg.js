import { downloadContentFromMessage } from 'baileys'
import { ffmpeg } from '../../src/utils/converter.js'
import webp from 'node-webpmux'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const { Jimp } = require('jimp')

const streamToBuffer = async (stream) => {
    const chunks = []
    for await (const chunk of stream) chunks.push(chunk)
    return Buffer.concat(chunks)
}

const getExt = (type, mimetype = '') => {
    if (type === 'stickerMessage') return 'webp'
    if (type === 'videoMessage') return 'mp4'
    if (type === 'imageMessage') {
        if (String(mimetype).includes('png')) return 'png'
        return 'jpg'
    }
    return 'bin'
}

const animatedWebpToJpg = async (buffer) => {
    await webp.Image.initLib()
    const img = new webp.Image()
    await img.load(buffer)

    const frame = img.frames?.[0]
    if (!frame) throw new Error('Frame animasi tidak ditemukan')

    const raw = await img.getFrameData(0)
    const bitmap = Jimp.fromBitmap({
        data: Buffer.from(raw),
        width: frame.width,
        height: frame.height
    })

    return bitmap.getBuffer('image/jpeg')
}

export default {
    name: 'toimg',
    aliases: ['toimage', 'img'],
    description: 'Convert sticker ke gambar',
    execute: async ({ sock, msg, isQuoted, quotedMsg, quotedType, react, useLimit, prefix, command }) => {
        const jid = msg.key.remoteJid

        if (!isQuoted || !quotedMsg || !quotedType) {
            return sock.sendMessage(jid, {
                text: `❌ Kirim/reply sticker dengan caption ${prefix + command}`
            }, { quoted: msg })
        }

        if (quotedType !== 'stickerMessage') {
            return sock.sendMessage(jid, {
                text: '❌ Command ini khusus reply sticker.'
            }, { quoted: msg })
        }

        await react('⏳')

        try {
            const media = quotedMsg[quotedType]
            const mediaType = quotedType.replace('Message', '')
            const stream = await downloadContentFromMessage(media, mediaType)
            const buffer = await streamToBuffer(stream)

            if (media?.isAnimated) {
                const jpg = await animatedWebpToJpg(buffer)
                await sock.sendMessage(jid, { image: jpg }, { quoted: msg })
            } else {
                let converted = null
                try {
                    converted = await ffmpeg(buffer, ['-vframes', '1'], 'webp', 'png')
                } catch {
                    converted = await ffmpeg(buffer, ['-vframes', '1'], getExt(quotedType, media?.mimetype), 'jpg')
                }
                if (!converted?.data) throw new Error('Gagal convert sticker ke image')
                await sock.sendMessage(jid, { image: converted.data }, { quoted: msg })
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
