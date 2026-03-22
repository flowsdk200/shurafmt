import { getTargetJid } from '../../src/utils/group.js'
import { normalizeJid } from '../../src/utils/jid.js'

const resolveTarget = (msg, text) => {
    const target = getTargetJid(msg, text)
    if (target) return target
    return ''
}

const resolveTargetFromContext = (contextInfo = {}) => {
    if (Array.isArray(contextInfo.mentionedJid) && contextInfo.mentionedJid.length > 0) {
        return normalizeJid(contextInfo.mentionedJid[0])
    }

    if (contextInfo.stanzaId && contextInfo.participant) {
        return normalizeJid(contextInfo.participant)
    }

    return ''
}

const getProfilePictureUrl = async (sock, targetJid) => {
    const url = await sock.profilePictureUrl(targetJid, 'image')
    if (!url) throw new Error('Foto profil tidak tersedia.')
    return url
}

export default {
    name: 'getpp',
    aliases: ['pp', 'getpic', 'profilepic'],
    description: 'Ambil foto profil user (@mention / reply / nomor)',
    execute: async ({ sock, msg, text, contextInfo, prefix, command, react, useLimit }) => {
        const jid = msg.key.remoteJid
        const targetJid = resolveTarget(msg, text) || resolveTargetFromContext(contextInfo)

        if (!targetJid) {
            return sock.sendMessage(jid, {
                text:
                    `Contoh penggunaan:\n` +
                    `- ${prefix + command} @user\n` +
                    `- ${prefix + command} 6281234567890\n` +
                    `- ${prefix + command} (reply pesan target)`
            }, { quoted: msg })
        }

        await react('⏳')

        try {
            const profileUrl = await getProfilePictureUrl(sock, targetJid)

            if (!profileUrl) {
                await react('❌')
                return sock.sendMessage(jid, {
                    text: '❌ User belum punya foto profil.'
                }, { quoted: msg })
            }

            await sock.sendMessage(jid, {
                image: { url: profileUrl },
                caption: `\`\`\`FOTO PROFIL @${targetJid.split('@')[0]}\`\`\``,
                mimetype: 'image/jpeg',
                mentions: [targetJid]
            }, { quoted: msg })

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
