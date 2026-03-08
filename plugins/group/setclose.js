const formatNow = () => {
    const now = new Date()
    const day = String(now.getDate()).padStart(2, '0')
    const month = now.toLocaleString('id-ID', { month: 'short', timeZone: 'Asia/Jakarta' })
    const year = now.toLocaleString('id-ID', { year: 'numeric', timeZone: 'Asia/Jakarta' })
    const time = now.toLocaleString('id-ID', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
        timeZone: 'Asia/Jakarta'
    }).replace(':', '.')
    return `${day} ${month} ${year}, ${time}`
}

const renderCloseText = (template, groupName) => String(template || '')
    .replaceAll('{group}', groupName || '-')
    .replaceAll('{time}', formatNow())

export default {
    name: 'setclose',
    aliases: [],
    description: 'Ubah teks close grup',
    groupOnly: true,
    adminOnly: true,
    execute: async ({ sock, msg, text, groupsDb, prefix, command, useLimit, groupMetadata }) => {
        const jid = msg.key.remoteJid
        const input = String(text || '').trim()

        if (!input) {
            useLimit()
            return sock.sendMessage(jid, {
                text:
                    `Contoh penggunaan:\n` +
                    `- ${prefix + command} Grup {group} resmi ditutup pada {time}\n` +
                    `- ${prefix + command} reset\n\n` +
                    `Variabel:\n` +
                    `- {group}\n` +
                    `- {time}`
            }, { quoted: msg })
        }

        if (/^(reset|default)$/i.test(input)) {
            groupsDb.setSetting(jid, 'closeText', '')
            useLimit()
            return sock.sendMessage(jid, {
                text: '✅ Teks close berhasil direset ke default.'
            }, { quoted: msg })
        }

        groupsDb.setSetting(jid, 'closeText', input)
        useLimit()
        return sock.sendMessage(jid, {
            text: `✅ Teks close berhasil diubah.\n\n\`PREVIEW SETCLOSE:\`\n${renderCloseText(input, groupMetadata?.subject || jid)}`
        }, { quoted: msg })
    }
}
