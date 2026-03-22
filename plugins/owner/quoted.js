export default {
    name: 'quoted',
    aliases: ['q'],
    description: 'Tampilkan JSON dari pesan quoted',
    ownerOnly: true,
    silentUnauthorized: true,
    execute: async ({ sock, msg, isQuoted, quotedMsg, react, useLimit }) => {
        const jid = msg.key.remoteJid

        if (!isQuoted || !quotedMsg) return

        await react('⏳')

        const jsonData = JSON.stringify(quotedMsg, null, 2)

        await sock.sendMessage(jid, {
            text: jsonData
        }, { quoted: msg })

        useLimit()
        await react('✅')
    }
}
