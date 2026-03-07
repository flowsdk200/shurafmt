export default {
    name: 'setgoodbye',
    aliases: [],
    description: 'Ubah teks goodbye grup',
    groupOnly: true,
    adminOnly: true,
    execute: async ({ sock, msg, text, groupsDb, prefix, command, useLimit }) => {
        const jid = msg.key.remoteJid
        const input = String(text || '').trim()

        if (!input) {
            useLimit()
            return sock.sendMessage(jid, {
                text:
                    `Contoh penggunaan:\n` +
                    `- ${prefix + command} Sampai jumpa {user} dari {group}\n` +
                    `- ${prefix + command} reset\n\n` +
                    `Variabel:\n` +
                    `- {user}\n` +
                    `- {group}\n` +
                    `- {time}\n` +
                    `- {members}\n` +
                    `- {before}\n` +
                    `- {after}`
            }, { quoted: msg })
        }

        if (/^(reset|default)$/i.test(input)) {
            groupsDb.setSetting(jid, 'goodbyeText', '')
            useLimit()
            return sock.sendMessage(jid, {
                text: '✅ Teks goodbye berhasil direset ke default.'
            }, { quoted: msg })
        }

        groupsDb.setSetting(jid, 'goodbyeText', input)
        useLimit()
        return sock.sendMessage(jid, {
            text: `✅ Teks goodbye berhasil diubah.\n\nPreview:\n${input}`
        }, { quoted: msg })
    }
}
