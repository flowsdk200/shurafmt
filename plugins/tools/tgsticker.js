import axios from 'axios'
import { makeSticker } from '../../src/utils/exif.js'

const BOT_TOKEN = '7807412168:AAE1k2gN9nt3LqcePkXsvk9JJMqYjmORufI'
const API = `https://api.telegram.org/bot${BOT_TOKEN}`
const FILE_API = `https://api.telegram.org/file/bot${BOT_TOKEN}`

const REQUEST_TIMEOUT = 30000
const DOWNLOAD_TIMEOUT = 60000
const SEND_DELAY_MS = 3000

const cleanText = (value) => String(value || '').replace(/\s+/g, ' ').trim()
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

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

const downloadSticker = async (fileId) => {
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

export default {
    name: 'tgsticker',
    aliases: ['tgs', 'stickerpack', 'telesticker'],
    description: 'Ambil sticker pack Telegram dan kirim semua jadi sticker',
    execute: async ({ sock, msg, text, prefix, command, react, useLimit }) => {
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

            const sentSet = new Set()
            const packLabel = cleanText(set?.title || set?.name || packName)

            let sent = 0
            let failed = 0
            let duplicate = 0

            for (const st of stickers) {
                const uniqueKey = cleanText(st?.file_unique_id || st?.file_id)
                if (!uniqueKey) continue

                if (sentSet.has(uniqueKey)) {
                    duplicate += 1
                    continue
                }
                sentSet.add(uniqueKey)

                const fileId = cleanText(st?.file_id)
                if (!fileId) {
                    failed += 1
                    await sleep(SEND_DELAY_MS)
                    continue
                }

                try {
                    const buffer = await downloadSticker(fileId)
                    await makeSticker(sock, jid, buffer, {
                        packname: packLabel,
                        quoted: msg
                    })
                    sent += 1
                } catch {
                    failed += 1
                }

                await sleep(SEND_DELAY_MS)
            }

            if (sent > 0) useLimit()
            await react(sent > 0 ? '✅' : '❌')

            await sock.sendMessage(jid, {
                text:
                    '```✅ TELEGRAM STICKER DONE\n\n' +
                    `• Pack: ${packLabel}\n` +
                    `• Name: ${cleanText(set?.name || packName)}\n` +
                    `• Type: ${cleanText(set?.sticker_type || '-')}\n` +
                    `• Total: ${stickers.length}\n` +
                    `• Sent: ${sent}\n` +
                    `• Failed: ${failed}` +
                    '```'
            }, { quoted: msg })
        } catch (err) {
            await react('❌')
            await sock.sendMessage(jid, {
                text: `❌ Gagal tgsticker: ${err?.message}`
            }, { quoted: msg })
        }
    }
}
