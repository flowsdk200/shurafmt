import responsesDb from '../../src/database/responses.js'

const formatJakartaDateTime = (value) => {
    if (!value) return '-'
    return new Intl.DateTimeFormat('id-ID', {
        timeZone: 'Asia/Jakarta',
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
    }).format(new Date(value)).replace(':', '.')
}

export default {
    name: 'listrespon',
    aliases: ['listrsp'],
    description: 'Lihat daftar auto respon',
    ownerOnly: true,
    async execute({ sock, msg, useLimit }) {
        const jid = msg.key.remoteJid
        const list = await responsesDb.listResponses()

        if (!list.length) {
            if (typeof useLimit === 'function') useLimit()
            return sock.sendMessage(jid, {
                text: 'belum ada respon yang disimpan.'
            }, { quoted: msg })
        }

        const rows = list.map((item, index) => {
            const createdAt = formatJakartaDateTime(item.createdAt)
            return ` ${index + 1}. ${item.key}\n • Type: ${item.type}\n • Dibuat: ${createdAt}`
        }).join('\n\n')

        if (typeof useLimit === 'function') useLimit()
        return sock.sendMessage(jid, {
            text: `DAFTAR RESPON (${list.length})\n\n${rows}`
        }, { quoted: msg })
    }
}
