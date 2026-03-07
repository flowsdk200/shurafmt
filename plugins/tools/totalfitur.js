import fs from 'fs'
import path from 'path'
import { fileURLToPath, pathToFileURL } from 'url'
import os from 'os'
import { createRequire } from 'module'
import { MENU } from '../main/menu.js'

const require = createRequire(import.meta.url)
const { Jimp } = require('jimp')

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const PLUGINS_DIR = path.join(ROOT_DIR, 'plugins')

const getPluginFiles = (dir) => {
    if (!fs.existsSync(dir)) return []

    let files = []
    const items = fs.readdirSync(dir, { withFileTypes: true })

    for (const item of items) {
        const full = path.join(dir, item.name)
        if (item.isDirectory()) {
            files = files.concat(getPluginFiles(full))
            continue
        }
        if (item.isFile() && item.name.endsWith('.js')) {
            files.push(full)
        }
    }

    return files
}

const countActivePlugins = async () => {
    const files = getPluginFiles(PLUGINS_DIR)
    let total = 0

    for (const file of files) {
        try {
            const mod = await import(pathToFileURL(file).href)
            if (mod?.default?.name) total += 1
        } catch {
            total += 0
        }
    }

    return total
}

const resizePP = async (buf, size = 200) => {
    try {
        const img = await Jimp.fromBuffer(buf)
        img.resize({ w: size, h: size })
        return img.getBuffer('image/jpeg')
    } catch {
        return buf
    }
}

const getUptime = (uptimeSeconds) => {
    const total = Math.max(0, Math.floor(Number(uptimeSeconds) || 0))
    if (total < 60) return `${total} seconds`
    if (total < 3600) return `${Math.floor(total / 60)} minutes`
    if (total < 86400) return `${Math.floor(total / 3600)} hours`
    return `${Math.floor(total / 86400)} days`
}

const countMenuCommands = () => Object.values(MENU)
    .filter(Array.isArray)
    .reduce((acc, list) => acc + list.length, 0)

export default {
    name: 'totalfitur',
    aliases: ['countfitur'],
    description: 'Cek total fitur bot',
    execute: async ({ sock, msg, config, sender, react, useLimit }) => {
        const jid = msg.key.remoteJid

        await react('⏳')

        try {
            const totalMenu = countMenuCommands()
            const totalPlugin = await countActivePlugins()
            const ppBuffer = await resizePP(config.thumb)
            const ownerNum = config?.ownerNumbers?.[0]
            const ownerJid = ownerNum ? `${String(ownerNum).replace(/[^0-9]/g, '')}@s.whatsapp.net` : null
            const mentionedJid = ownerJid ? [sender, ownerJid] : [sender]

            const caption =
                `\`\`\`× Total fitur: ${totalMenu}\`\`\``

            await sock.sendMessage(jid, {
                document: ppBuffer,
                mimetype: 'image/png',
                fileName: String(config.botName || 'bot'),
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
                    }
                },
                viewOnce: true,
            }, { quoted: msg })

            useLimit()
            await react('✅')
        } catch (err) {
            await react('❌')
            await sock.sendMessage(jid, {
                text: `❌ Error: ${err.message}`
            }, { quoted: msg })
        }
    },
}
