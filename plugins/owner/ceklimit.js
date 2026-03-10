import { getTargetJid } from '../../src/utils/group.js'

export default {
    name: 'ceklimit',
    aliases: ['cl', 'checklimit', 'limit'],
    description: 'Cek limit user',
    execute: async ({ sock, msg, text, usersDb, sender, isOwner, isPremium, react, useLimit }) => {
        const jid = msg.key.remoteJid

        // Owner bisa cek limit user lain, user biasa hanya cek diri sendiri
        const targetJid = (isOwner && text.trim()) ? getTargetJid(msg, text) : sender
        const checkJid = targetJid || sender

        const checkIsOwner = usersDb.isOwner(checkJid)
        const checkIsPremium = usersDb.isPremium(checkJid)
        usersDb.checkAndResetLimit(checkJid, checkIsOwner, checkIsPremium)
        const limit = usersDb.getLimit(checkJid)
        const maxLimit = usersDb.getDisplayMaxLimit(checkJid, checkIsOwner, checkIsPremium)
        const role = checkIsOwner ? 'owner' : checkIsPremium ? 'premium' : 'free'
        const num = checkJid.split('@')[0]

        useLimit()
        await react('✅')

        return sock.sendMessage(jid, {
            text:
                `\`\`\`📊 Limit @${num}\n\n` +
                `• Status: ${role}\n` +
                `• Sisa limit: ${limit}/${maxLimit}\`\`\``,
            mentions: [checkJid]
        }, { quoted: msg })
    }
}
