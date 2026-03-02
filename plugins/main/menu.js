import { createRequire } from 'module'
import os from 'os'
const require = createRequire(import.meta.url)
const { Jimp } = require('jimp')

/*
const MENU = {
    General: ['ai', 'ping', 'play', 'rvo', 'sticker', 'hd', 'idch', 'script', 'tocjs', 'toesm', 'toptv', 'tovn', 'toaudio'],
    Download: ['mediafire', 'tiktok', 'tiktoksearch'],
    Group: ['add', 'antibot', 'antispam', 'close', 'demote', 'goodbye', 'kick', 'open', 'promote', 'welcome'],
    Owner: ['addlimit', 'addowner', 'addprem', 'autoread', 'ceklimit', 'dellimit', 'delowner', 'delprem', 'listgc', 'listowner', 'listprem', 'public', 'self'],
}
*/

const MENU = {
    General: ['ai', 'ping', 'play', 'rvo', 'sticker', 'brat', 'hd', 'mediafire', 'idch', 'script', 'tocjs', 'toesm', 'toptv', 'tovn', 'toaudio', 'tiktok'],
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const resizePP = async (buf, size = 200) => {
    const img = await Jimp.fromBuffer(buf)
    img.resize({ w: size, h: size })
    return img.getBuffer('image/jpeg')
}

const styles = (text) => `\`\`\`${text}\`\`\``

const getPP = async (thumb) => {
    try {
        return await resizePP(thumb, 200)
    } catch {
        return thumb
    }
}

const getUptime = (uptimeSeconds) => {
    const total = Math.max(0, Math.floor(Number(uptimeSeconds) || 0))
    if (total < 60) return `${total} seconds`
    if (total < 3600) return `${Math.floor(total / 60)} minutes`
    if (total < 86400) return `${Math.floor(total / 3600)} hours`
    return `${Math.floor(total / 86400)} days`
}

export default {
    name: 'menu',
    aliases: ['help', 'm'],
    description: 'Tampilkan daftar semua perintah bot',
    execute: async ({ sock, msg, config, usersDb, pushName, sender, isOwner, isPremium, react }) => {
        try {
            await react('⏳')

            const jid = msg.key.remoteJid
            const p = config.prefixes[0]
            const owner = config.ownerNumbers[0] || '?'
            const ownerJid = config.ownerNumbers[0] ? `${config.ownerNumbers[0]}@s.whatsapp.net` : null
            const status = isOwner ? 'owner' : usersDb.isPremium(sender) ? 'premium' : 'free'
            const senderNum = sender.split('@')[0]
            const limitLeft = usersDb.getLimit(sender)
            const limitMax = usersDb.getMaxLimit(isOwner, isPremium)
            const totalUsers = usersDb.count()

            const ppBuffer = await getPP(config.thumb)

            const menuText = Object.entries(MENU)
                .map(([kategori, cmds]) => `${kategori} (${cmds.length})\n${cmds.map((c) => `× ${p}${c}`).join('\n')}`)
                .join('\n\n')

            const caption =
                styles(
                    `Users\n` +
                    `× Name: ${String(pushName || 'user')}\n` +
                    `× ID: @${senderNum}\n` +
                    `× Status: ${status}\n` +
                    `× Limit: ${limitLeft}/${limitMax}\n\n` +
                    `System\n` +
                    `× Owner: @${owner}\n` +
                    `× Mode: ${sock.public ? 'public' : 'self'}\n` +
                        `× Users: ${totalUsers}\n` +
                        `× Uptime: ${getUptime(os.uptime())}\n\n` +
                        `${menuText}`
                )

            const mentionedJid = ownerJid ? [sender, ownerJid] : [sender]
            await sleep(3000)
            await sock.sendMessage(jid, {
                document: ppBuffer,
                mimetype: 'image/png',
                fileName: String(config.botName || 'menu'),
                fileLength: 999999,
                pageCount: 0,
                jpegThumbnail: ppBuffer,
                caption,
                contextInfo: {
                    mentionedJid,
                    forwardingScore: 999,
                    isForwarded: true,
                    forwardedNewsletterMessageInfo: {
                        newsletterName: `${getUptime(os.uptime())}`,
                        newsletterJid: config.channelJid,
                    },
                },
                viewOnce: true,
            }, { quoted: msg })

            await react('✅')
        } catch {
            await react('❌')
            await sock.sendMessage(msg.key.remoteJid, {
                text: 'Terjadi error saat mengirim menu, coba lagi nanti.',
            }, { quoted: msg })
        }
    },
}
