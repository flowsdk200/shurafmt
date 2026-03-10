import { getTargetJid } from '../../src/utils/group.js'

export default {
    name: 'dellimit',
    aliases: ['dl', 'resetlimit'],
    description: 'Kurangi atau reset limit user',
    ownerOnly: true,
    execute: async ({ sock, msg, text, prefix, command, usersDb, react, useLimit }) => {
        const jid = msg.key.remoteJid

        const cmd = String(command || '').toLowerCase()
        const isResetMode = cmd === 'resetlimit'

        if (isResetMode) {
            const raw = String(text || '').trim()

            await react('⏳')

            if (raw.toLowerCase() === 'all') {
                const users = usersDb.all()
                for (const u of users) {
                    usersDb.resetLimitToTier(u.jid)
                }

                useLimit()
                await react('✅')
                return sock.sendMessage(jid, {
                    text: `✅ Limit ${users.length} user berhasil direset.`
                }, { quoted: msg })
            }

            const targetJid = getTargetJid(msg, raw)
            if (!targetJid) {
                await react('❌')
                return sock.sendMessage(jid, {
                    text: `❌ Cara penggunaan:\n- ${prefix + command} all\n- ${prefix + command} @user\n- ${prefix + command} 6285226344606`
                }, { quoted: msg })
            }

            const updated = usersDb.resetLimitToTier(targetJid)

            useLimit()
            await react('✅')
            return sock.sendMessage(jid, {
                text: `✅ Limit @${targetJid.split('@')[0]} berhasil direset ke ${updated.limit}/${updated.limitMax}.`,
                mentions: [targetJid]
            }, { quoted: msg })
        }

        const match = text.match(/(\d+)\s*$/)
        const amount = match ? parseInt(match[1]) : null
        const targetText = amount !== null ? text.slice(0, text.lastIndexOf(match[0])).trim() : text.trim()
        const targetJid = getTargetJid(msg, targetText)

        if (!targetJid) {
            return sock.sendMessage(jid, {
                text: `❌ Cara penggunaan:\n- ${prefix + command} @user <jumlah> kurangi limit\n- ${prefix + command} @user reset ke 0\n\nContoh penggunaan:\n- ${prefix + command} 6285226344606 50\n- ${prefix + command} 6285226344606`
            }, { quoted: msg })
        }

        await react('⏳')

        if (amount !== null) {
            const updated = usersDb.reduceLimit(targetJid, amount)
            useLimit()
            await react('✅')
            return sock.sendMessage(jid, {
                text: `✅ Limit @${targetJid.split('@')[0]} dikurangi ${amount}. sekarang: ${updated.limit}/${updated.limitMax}`,
                mentions: [targetJid]
            }, { quoted: msg })
        } else {
            const updated = usersDb.setLimitState(targetJid, 0, 0)
            useLimit()
            await react('✅')
            return sock.sendMessage(jid, {
                text: `✅ Limit @${targetJid.split('@')[0]} direset ke ${updated.limit}/${updated.limitMax}.`,
                mentions: [targetJid]
            }, { quoted: msg })
        }
    }
}
