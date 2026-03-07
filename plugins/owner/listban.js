function timeRemaining(expiryDate) {
    const diff = expiryDate - new Date()
    if (diff <= 0) return 'Expired'
    const days = Math.floor(diff / (1000 * 60 * 60 * 24))
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60))
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60))
    if (days > 0) return `${days}d ${hours}h`
    if (hours > 0) return `${hours}h ${minutes}m`
    return `${minutes}m`
}

export default {
    name: 'listban',
    aliases: ['listbanned', 'lb'],
    description: 'Lihat daftar user yang sedang diban',
    ownerOnly: true,
    execute: async ({ sock, msg, usersDb, useLimit }) => {
        const jid = msg.key.remoteJid
        const list = usersDb.getBanned()

        if (!list.length) {
            useLimit()
            return sock.sendMessage(jid, {
                text: 'belum ada user yang sedang diban.'
            }, { quoted: msg })
        }

        const mentions = list.map((u) => u.jid)
        const rows = list.map((u, i) => {
            const expiry = usersDb.getBanExpiry(u.jid)
            const expiryStr = expiry
                ? expiry.toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' })
                : 'Permanent'
            const remaining = expiry ? timeRemaining(expiry) : 'Permanent'
            const name = (u.name || 'user').trim()
            const mentionTag = `@${u.jid.split('@')[0]}`
            return ` ${i + 1}. ${name}\n Exp: ${expiryStr} (sisa: ${remaining})`
        }).join('\n\n')

        useLimit()
        return sock.sendMessage(jid, {
            text: `Daftar ban aktif (${list.length})\n\n${rows}`,
            mentions
        }, { quoted: msg })
    }
}
