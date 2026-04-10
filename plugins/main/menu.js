import { createRequire } from 'module'
import os from 'os'
const require = createRequire(import.meta.url)
const { Jimp } = require('jimp')


export const MENU = {
    General: ['ai', 'confess', 'gemini', 'ping', 'script', 'owner', 'kbbi', 'verif', 'ghs'],
    Download: ['aptoidedl', 'apptekadl', 'bilibilidl', 'capcutdl', 'donghuadl', 'facebook', 'fdroiddl', 'gdrive', 'gitclone', 'igreel', 'igpost', 'igstory', 'instagram', 'mediafire', 'pindl', 'play', 'redditdl', 'sfiledl', 'softmanydl', 'spotify', 'threads', 'tiktok', 'tumblr', 'twitter', 'videy', 'ytmp3', 'ytmp4'],
    Search: ['apkcombo', 'apkmirror', 'apkmody', 'apkpure', 'appstore', 'appteka', 'aptoide', 'bilibili', 'bing', 'bingimg', 'bluearchive', 'brave', 'cekfakta', 'cookpad', 'cookpadread', 'donghua', 'fdroid', 'github', 'google', 'gsmarena', 'komikindo', 'linkedin', 'mangatoon', 'mangatoonread', 'npm', 'pin', 'pixiv', 'playstore', 'sfile', 'shopee', 'softmany', 'soundcloud', 'spsearch', 'tokopedia', 'ttsearch', 'turnbackhoax', 'unsplash', 'wattpad', 'wattpadread', 'webtoons', 'webtoonread', 'wikimedia', 'wikipedia', 'yahoo', 'ytsearch'],
    Tools: ['brat', 'cekcuaca', 'emojimix', 'gempa', 'get', 'getpp', 'hd', 'hdvideo', 'idch', 'iqc', 'jadwalsholat', 'ocr', 'reactch', 'removebg', 'rvo', 'shorturl', 'smeme', 'sprl', 'ssweb', 'sticker', 'swm', 'tgsticker', 'tinycc', 'totalfitur', 'tourl', 'translate', 'uploadid', 'videyup'],
    Group: ['add', 'addwarn', 'afk', 'antibot', 'antihidetag', 'antilinkch', 'antilinkgc', 'antiluar', 'antispam', 'close', 'delete', 'delppgc', 'delwarn', 'demote', 'goodbye', 'hidetag', 'kick', 'listwarn', 'open', 'promote', 'setclose', 'setgoodbye', 'setopen', 'setppgc', 'setwelcome', 'tagall', 'welcome'],
    Owner: ['addban', 'addlimit', 'addowner', 'addprem', 'addrespon', 'autoread', 'ceklimit', 'delban', 'dellimit', 'delowner', 'delppbot', 'delprem', 'delrespon', 'listban', 'listgc', 'listowner', 'listprem', 'listrespon', 'onlygrup', 'onlyowner', 'onlypc', 'onlyprem', 'public', 'quoted', 'resetdb', 'self', 'setppbot'],
    News: ['aljazeera', 'antara', 'apnews', 'bbc', 'bbcworld', 'detik', 'foxnews', 'hackernews', 'harianjogja', 'idntimes', 'indozone', 'inews', 'jawapos', 'jogja', 'jpn', 'katadata', 'kompas', 'kontan', 'kumparan', 'liputan6', 'medcom', 'merdeka', 'okezone', 'republika', 'sindonews', 'suara', 'tempo', 'thetimes', 'tribun', 'tvone'],
    Convert: ['bass', 'blown', 'deep', 'earrape', 'fast', 'fat', 'nightcore', 'readqr', 'reverse', 'robot', 'slow', 'smooth', 'squirrel', 'toaudio', 'tobase64', 'toidr', 'toimg', 'topdf', 'toqr', 'toptv', 'tousd', 'tovn', 'tovideo'],
    Store: ['bagi', 'diskon', 'done', 'kali', 'kurang', 'persen', 'proses', 'tambah', 'total'],
}

const resizePP = async (buf, size = 200) => {
    const img = await Jimp.fromBuffer(buf)
    img.resize({ w: size, h: size })
    return img.getBuffer('image/jpeg')
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const styles = (text) => `\`\`\`${text}\`\`\``

const quotednye = (channelJid, ownerNumber, commandName = 'MENU') => ({
    key: {
        remoteJid: `${String(ownerNumber || '0').replace(/[^0-9]/g, '') || '0'}-1625305606@g.us`,
        participant: '0@s.whatsapp.net'
    },
    message: {
        newsletterAdminInviteMessage: {
            newsletterJid: channelJid || '120363210705976689@newsletter',
            newsletterName: '',
            caption: String(commandName || 'MENU').toUpperCase()
        }
    }
})

const getPP = async (sock, sender, thumb) => {
    try {
        const ppUrl = await sock.profilePictureUrl(sender, 'image').catch(() => '')
        if (ppUrl) {
            const response = await fetch(ppUrl)
            if (response.ok) {
                const arrayBuffer = await response.arrayBuffer()
                const buffer = Buffer.from(arrayBuffer)
                return await resizePP(buffer, 200)
            }
        }
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
    aliases: ['help', 'allmenu'],
    description: 'Tampilkan daftar semua perintah bot',
    execute: async ({ sock, msg, botJid, config, usersDb, pushName, sender, isOwner, isPremium, react }) => {
        try {
            await react('⏳')

            const jid = msg.key.remoteJid
            const p = config.prefixes[0]
            const owner = config.ownerNumbers[0] || '?'
            const ownerJid = config.ownerNumbers[0] ? `${config.ownerNumbers[0]}@s.whatsapp.net` : null
            const userIsOwner = isOwner || usersDb.isOwner(sender)
            const userIsPremium = userIsOwner ? false : (isPremium || usersDb.isPremium(sender))
            const status = userIsOwner ? 'owner' : userIsPremium ? 'premium' : 'free'
            const senderNum = sender.split('@')[0]
            const limitLeft = usersDb.getLimit(sender)
            const limitMax = usersDb.getDisplayMaxLimit(sender, userIsOwner, userIsPremium)
            const totalUsers = usersDb.count()
            const wkwk = quotednye(config.channelJid, owner, 'menu')
            const ppBuffer = await getPP(sock, sender, config.thumb)

            const menuText = Object.entries(MENU)
                .map(([kategori, cmds]) => `\`\`\`${kategori} (${cmds.length})\`\`\`\n\`\`\`${cmds.map((c) => `▦ ${p}${c}`).join('\n')}\`\`\``)
                .join('\n\n')

            const syuu =
                    `\`\`\`Users\`\`\`\n` +
                    `\`\`\`▦ Name: ${String(pushName || 'user')}\n` +
                    `▦ ID: @${senderNum}\n` +
                    `▦ Status: ${status}\n` +
                    `▦ Limit: ${limitLeft}/${limitMax}\`\`\`\n\n` +
                    `\`\`\`System\`\`\`\n` +
                    `\`\`\`▦ Owner: @${owner}\n` +
                    `▦ Mode: ${sock.public ? 'public' : 'self'}\n` +
                        `▦ Users: ${totalUsers}\n` +
                        `▦ Uptime: ${getUptime(os.uptime())}\`\`\`\n\n\n` +
                        `${menuText}`

            const hoho = {
                caption: syuu,
                document: ppBuffer,
                mimetype: 'image/png',
                fileLength: 999999,
                fileSize: 999999,
                fileName: `${pushName.toLowerCase()}`,
                jpegThumbnail: ppBuffer,
                footer: `© ${config.botName}`,
                interactiveButtons: [{
                    name: 'cta_url',
                    buttonParamsJson: JSON.stringify({
                        display_text: 'SCRIPT',
                        url: 'https://whatsapp.com/channel/0029Vb8IWc3FSAsy4xaX991n',
                        merchant_url: 'https://whatsapp.com/channel/0029Vb8IWc3FSAsy4xaX991n'
                    })
                }, {
                    name: 'cta_url',
                    buttonParamsJson: JSON.stringify({
                        display_text: 'DEVELOPER',
                        url: 'https://wa.me/6285226344606',
                        merchant_url: 'https://wa.me/6285226344606'
                    })
                }],
                contextInfo: {
                    mentionedJid: [ownerJid, sender].filter(Boolean),
                    forwardingScore: 999,
                    isForwarded: true,
                    forwardedNewsletterMessageInfo: {
                        newsletterJid: config.channelJid,
                        newsletterName: `${config.botName} wabot - v1.0.0`,
                    },
                    externalAdReply: {
                        title: `${config.botName} wabot - v1.0.0`,
                        body: `system uptime: ${getUptime(os.uptime())}`,
                        thumbnail: config.thumb,
                        sourceUrl: config.channelLink,
                        mediaType: 1,
                        renderLargerThumbnail: true,
                    },
                },
                viewOnce: true,
            }
            await sleep(3000)
            await sock.sendMessage(jid, hoho, { quoted: wkwk })
            await react('✅')
        } catch (error) {
            console.error('Error sending menu:', error)
            await sock.sendMessage(msg.key.remoteJid, {
                text: 'Terjadi error saat mengirim menu, coba lagi nanti.',
            }, { quoted: msg })
        }
    },
}
