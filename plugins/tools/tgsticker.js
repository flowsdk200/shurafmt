import axios from 'axios'
import fs from 'fs'
import path from 'path'
import { tmpdir } from 'os'
import Crypto from 'crypto'
import { spawn } from 'child_process'
import { generateWAMessageFromContent, proto } from 'baileys'
import { fileTypeFromBuffer } from 'file-type'
import ffmpegPath from 'ffmpeg-static'

const BOT_TOKEN = '7807412168:AAE1k2gN9nt3LqcePkXsvk9JJMqYjmORufI'
const API = `https://api.telegram.org/bot${BOT_TOKEN}`
const FILE_API = `https://api.telegram.org/file/bot${BOT_TOKEN}`

const REQUEST_TIMEOUT = 30000
const DOWNLOAD_TIMEOUT = 60000

const cleanText = (value) => String(value || '').replace(/\s+/g, ' ').trim()
const buildPackSlug = (value) => cleanText(value).replace(/[^a-zA-Z0-9_]/g, '').toLowerCase() || 'telegrampack'
const buildPackLink = (value) => `https://wa.me/stickerpack/${buildPackSlug(value)}`
const tryUnlink = (filePath) => {
    try { fs.unlinkSync(filePath) } catch {}
}

const extractPackName = (url) => {
    const raw = cleanText(url)
    const match = raw.match(/(?:t\.me\/addstickers\/|stickers\/)([a-zA-Z0-9_]+)/i)
    return match ? match[1] : raw
}

const getStickerSet = async (name) => {
    const res = await axios.get(`${API}/getStickerSet`, {
        params: { name },
        timeout: REQUEST_TIMEOUT,
        validateStatus: () => true
    })

    if (!res.data?.ok) {
        throw new Error(cleanText(res.data?.description) || `Telegram HTTP ${res.status}`)
    }

    return res.data.result || {}
}

const getFileUrl = async (fileId) => {
    const res = await axios.get(`${API}/getFile`, {
        params: { file_id: fileId },
        timeout: REQUEST_TIMEOUT,
        validateStatus: () => true
    })

    if (!res.data?.ok || !res.data?.result?.file_path) {
        throw new Error(cleanText(res.data?.description) || `Telegram HTTP ${res.status}`)
    }

    return `${FILE_API}/${res.data.result.file_path}`
}

const downloadBuffer = async (fileId) => {
    const fileUrl = await getFileUrl(fileId)
    const res = await axios.get(fileUrl, {
        responseType: 'arraybuffer',
        timeout: DOWNLOAD_TIMEOUT,
        validateStatus: () => true
    })

    if (res.status !== 200) {
        throw new Error(`Download HTTP ${res.status}`)
    }

    const buffer = Buffer.from(res.data || [])
    if (!buffer.length) throw new Error('File kosong')
    return buffer
}

const createJpegThumbnail = async (buffer) => {
    if (!Buffer.isBuffer(buffer) || !buffer.length) return null

    const fileType = await fileTypeFromBuffer(buffer).catch(() => null)
    const tmpIn = path.join(tmpdir(), `${Crypto.randomBytes(6).readUIntLE(0, 6).toString(36)}.${cleanText(fileType?.ext || 'bin')}`)
    const tmpOut = path.join(tmpdir(), `${Crypto.randomBytes(6).readUIntLE(0, 6).toString(36)}.jpg`)

    fs.writeFileSync(tmpIn, buffer)

    try {
        await new Promise((resolve, reject) => {
            spawn(ffmpegPath, [
                '-y',
                '-i', tmpIn,
                '-frames:v', '1',
                '-vf', 'scale=256:256:force_original_aspect_ratio=increase,crop=256:256',
                tmpOut
            ])
                .on('error', reject)
                .on('close', (code) => code === 0 ? resolve(true) : reject(new Error(`ffmpeg exited with code ${code}`)))
        })

        const jpegThumbnail = fs.readFileSync(tmpOut)
        return jpegThumbnail.length ? jpegThumbnail : null
    } catch {
        return null
    } finally {
        tryUnlink(tmpIn)
        tryUnlink(tmpOut)
    }
}

const pickThumbnailFileId = (set, stickers) =>
    cleanText(
        set?.thumb?.file_id ||
        stickers.find((item) => cleanText(item?.thumbnail?.file_id))?.thumbnail?.file_id ||
        stickers.find((item) => cleanText(item?.thumb?.file_id))?.thumb?.file_id ||
        stickers.find((item) => !item?.is_animated && !item?.is_video && cleanText(item?.file_id))?.file_id
    )

const sendStickerPackPreview = async ({ sock, jid, msg, botJid, packName, packLabel, stickers, set }) => {
    let jpegThumbnail = null
    const thumbFileId = pickThumbnailFileId(set, stickers)

    if (thumbFileId) {
        try {
            jpegThumbnail = await createJpegThumbnail(await downloadBuffer(thumbFileId))
        } catch {}
    }

    const link = buildPackLink(set?.name || packName)
    const extendedTextMessage = proto.Message.ExtendedTextMessage.fromObject({
        text: link,
        matchedText: link,
        description: cleanText(set?.title || `${stickers.length} stiker Telegram`) || `${stickers.length} stiker Telegram`,
        title: `Paket Stiker ${packLabel} di WhatsApp`,
        previewType: 'NONE',
        jpegThumbnail: jpegThumbnail || undefined,
        inviteLinkGroupTypeV2: 'DEFAULT'
    })

    const waMsg = generateWAMessageFromContent(
        jid,
        { extendedTextMessage },
        { userJid: botJid || sock?.user?.id, quoted: msg }
    )

    await sock.relayMessage(jid, waMsg.message, { messageId: waMsg.key.id })
}

export default {
    name: 'tgsticker',
    aliases: ['tgs', 'stickerpack', 'telesticker'],
    description: 'Lihat preview sticker pack Telegram sebagai pack',
    execute: async ({ sock, msg, text, prefix, command, react, useLimit, botJid }) => {
        const jid = msg.key.remoteJid
        const input = cleanText(text)

        if (!input) {
            return sock.sendMessage(jid, {
                text:
                    `Contoh penggunaan:\n` +
                    `- ${prefix + command} https://t.me/addstickers/OldschoolError\n` +
                    `- ${prefix + command} OldschoolError`
            }, { quoted: msg })
        }

        const packName = extractPackName(input)
        if (!packName) {
            return sock.sendMessage(jid, {
                text: '❌ Nama pack tidak valid.'
            }, { quoted: msg })
        }

        await react('⏳')

        try {
            const set = await getStickerSet(packName)
            const stickers = Array.isArray(set?.stickers) ? set.stickers : []

            if (!stickers.length) {
                throw new Error('Sticker pack kosong atau tidak ditemukan')
            }

            const packLabel = cleanText(set?.title || set?.name || packName)
            await sendStickerPackPreview({
                sock,
                jid,
                msg,
                botJid,
                packName,
                packLabel,
                stickers,
                set
            })
            useLimit()
            await react('✅')
        } catch (err) {
            await react('❌')
            await sock.sendMessage(jid, {
                text: `❌ Gagal tgsticker: ${err?.message}`
            }, { quoted: msg })
        }
    }
}
