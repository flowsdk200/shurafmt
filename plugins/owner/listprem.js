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
    name: 'listprem',
    aliases: ['listpremium', 'listp', 'lp'],
    description: 'Lihat daftar pengguna premium aktif',
    ownerOnly: true,
    execute: async ({ sock, msg, usersDb, useLimit }) => {
        const jid = msg.key.remoteJid
        const list = usersDb.getPremium()

        if (!list.length) {
            useLimit()
            return sock.sendMessage(jid, {
                text: 'Belum ada pengguna premium aktif.'
            }, { quoted: msg })
        }

        const mentions = list.map((u) => u.jid)
        const rows = list.map((u, i) => {
            const expiry = new Date(u.premium)
            const expiryStr = expiry.toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' })
            const remaining = timeRemaining(expiry)
            const name = (u.name || 'user').trim()
            const mentionTag = `@${u.jid.split('@')[0]}`
            return ` ${i + 1}. ${name} (${mentionTag})\n Exp: ${expiryStr} (sisa: ${remaining})`
        }).join('\n\n')

        useLimit()
        return sock.sendMessage(jid, {
            text: `Daftar premium aktif (${list.length})\n\n${rows}`,
            mentions
        }, { quoted: msg })
    }
}
