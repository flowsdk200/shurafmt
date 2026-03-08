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

const renderOpenText = (template, groupName) => String(template || '')
    .replaceAll('{group}', groupName || '-')
    .replaceAll('{time}', formatNow())

export default {
    name: 'setopen',
    aliases: [],
    description: 'Ubah teks open grup',
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
                    `- ${prefix + command} Grup {group} resmi dibuka pada {time}\n` +
                    `- ${prefix + command} reset\n\n` +
                    `Variabel:\n` +
                    `- {group}\n` +
                    `- {time}`
            }, { quoted: msg })
        }

        if (/^(reset|default)$/i.test(input)) {
            groupsDb.setSetting(jid, 'openText', '')
            useLimit()
            return sock.sendMessage(jid, {
                text: '✅ Teks open berhasil direset ke default.'
            }, { quoted: msg })
        }

        groupsDb.setSetting(jid, 'openText', input)
        useLimit()
        return sock.sendMessage(jid, {
            text: `✅ Teks open berhasil diubah.\n\n\`PREVIEW SETOPEN:\`\n${renderOpenText(input, groupMetadata?.subject || jid)}`
        }, { quoted: msg })
    }
}
