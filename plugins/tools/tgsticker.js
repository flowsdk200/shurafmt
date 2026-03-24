import axios from 'axios'
import { generateWAMessageFromContent, proto } from 'baileys'

const BOT_TOKEN = '7807412168:AAE1k2gN9nt3LqcePkXsvk9JJMqYjmORufI'
const API = `https://api.telegram.org/bot${BOT_TOKEN}`

const REQUEST_TIMEOUT = 30000

const cleanText = (value) => String(value || '').replace(/\s+/g, ' ').trim()
const buildStickerPackId = (value) => `telegram-${cleanText(value).replace(/[^a-zA-Z0-9_-]/g, '').toLowerCase() || 'pack'}`
const detectStickerMime = (sticker) =>
    sticker?.is_video ? 'video/webm'
        : sticker?.is_animated ? 'application/x-tgsticker'
            : 'image/webp'

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

const sendStickerPack = async ({ sock, jid, msg, botJid, packName, packLabel, set, stickers }) => {
    const uniqueStickers = []
    const seen = new Set()

    for (const sticker of stickers) {
        const uniqueKey = cleanText(sticker?.file_unique_id || sticker?.file_id)
        if (!uniqueKey || seen.has(uniqueKey)) continue
        seen.add(uniqueKey)

        uniqueStickers.push({
            fileName: `sticker_${uniqueStickers.length + 1}.${sticker?.is_video ? 'webm' : sticker?.is_animated ? 'tgs' : 'webp'}`,
            isAnimated: Boolean(sticker?.is_animated || sticker?.is_video),
            emojis: cleanText(sticker?.emoji) ? [cleanText(sticker.emoji)] : [],
            mimetype: detectStickerMime(sticker)
        })
    }

    const stickerPackMessage = proto.Message.StickerPackMessage.fromObject({
        stickerPackId: buildStickerPackId(set?.name || packName),
        name: packLabel,
        publisher: 'Telegram',
        stickers: uniqueStickers,
        caption: `${uniqueStickers.length} stiker`,
        packDescription: cleanText(set?.sticker_type || 'regular'),
        stickerPackSize: uniqueStickers.length,
        stickerPackOrigin: 'THIRD_PARTY'
    })

    const waMsg = generateWAMessageFromContent(
        jid,
        { stickerPackMessage },
        { userJid: botJid || sock?.user?.id, quoted: msg }
    )

    await sock.relayMessage(jid, waMsg.message, { messageId: waMsg.key.id })
}

export default {
    name: 'tgsticker',
    aliases: ['tgs', 'stickerpack', 'telesticker'],
    description: 'Lihat metadata sticker pack Telegram sebagai pack',
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
            await sendStickerPack({
                sock,
                jid,
                msg,
                botJid,
                packName,
                packLabel,
                set,
                stickers
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
