export default {
    name: 'owner',
    aliases: ['creator'],
    description: 'Kirim kontak owner',
    execute: async ({ sock, msg, config, react }) => {
        const jid = msg.key.remoteJid
        const number = String(config?.ownerNumbers?.[0] || '').replace(/[^0-9]/g, '')

        if (!number) {
            return sock.sendMessage(jid, { text: '❌ Nomor owner belum diatur.' }, { quoted: msg })
        }

        const ownerJid = `${number}@s.whatsapp.net`
        const displayName = 'riflowsxz'
        const vcard = [
            'BEGIN:VCARD',
            'VERSION:3.0',
            `FN:${displayName}`,
            `TEL;type=CELL;type=VOICE;waid=${number}:${number}`,
            'END:VCARD'
        ].join('\n')

        await react('✅')
        await sock.sendMessage(jid, {
            contacts: {
                displayName,
                contacts: [{ displayName, vcard }]
            },
            mentions: [ownerJid]
        }, { quoted: msg })
    }
}
