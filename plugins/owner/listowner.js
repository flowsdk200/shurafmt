export default {
    name: 'listowner',
    aliases: ['lo', 'owners'],
    description: 'Lihat daftar owner bot',
    ownerOnly: true,
    execute: async ({ sock, msg, usersDb, config, useLimit }) => {
        const jid = msg.key.remoteJid

        const dbOwners = usersDb.getOwners()
        const configNums = config.ownerNumbers

        // Gabung: config owners + db owners, deduplicate by number
        const seen = new Set()
        const all = []

        for (const num of configNums) {
            const ownerJid = `${num}@s.whatsapp.net`
            seen.add(num)
            const dbUser = usersDb.getUser(ownerJid)
            all.push({ jid: ownerJid, name: dbUser.name || num, fromConfig: true })
        }

        for (const u of dbOwners) {
            const num = u.jid.split('@')[0]
            if (!seen.has(num)) {
                seen.add(num)
                all.push({ jid: u.jid, name: u.name || num, fromConfig: false })
            }
        }

        const mentions = all.map(u => u.jid)
        const rows = all.map((u, i) => {
            const tag = `@${u.jid.split('@')[0]}`
            const label = u.fromConfig ? ' (config)' : ''
            return ` ${i + 1}. ${tag}${label}`
        }).join('\n')

        useLimit()
        return sock.sendMessage(jid, {
            text: `Daftar owner (${all.length})\n\n${rows}`,
            mentions
        }, { quoted: msg })
    }
}
