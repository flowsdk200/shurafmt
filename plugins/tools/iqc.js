import axios from 'axios'

const cleanText = (value) => String(value || '').replace(/\s+/g, ' ').trim()

const getTimeHHmmJakarta = () => {
    const now = new Date()
    const parts = new Intl.DateTimeFormat('id-ID', {
        timeZone: 'Asia/Jakarta',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
    }).formatToParts(now)

    const hh = parts.find((p) => p.type === 'hour')?.value || '00'
    const mm = parts.find((p) => p.type === 'minute')?.value || '00'
    return `${hh}.${mm}`
}

const parseInput = (raw) => {
    const input = cleanText(raw)
    if (!input) {
        return { text: '', posisi: 'kiri', jam: getTimeHHmmJakarta() }
    }

    let text = input
    let posisi = 'kiri'
    let jam = getTimeHHmmJakarta()

    if (input.includes('|')) {
        const parts = input.split('|').map((p) => cleanText(p))
        text = parts[0] || ''
        if (parts[1]) posisi = parts[1]
        if (parts[2]) jam = parts[2]
    }

    return { text, posisi, jam }
}

export default {
    name: 'iqc',
    aliases: ['iphoneqc', 'iphonequote'],
    description: 'Buat iPhone quote canvas',
    execute: async ({ sock, msg, text, isQuoted, quotedText, quotedMsg, prefix, command, react, useLimit }) => {
        const jid = msg.key.remoteJid
        let input = cleanText(text)

        if (!input && isQuoted) {
            input = cleanText(quotedText || quotedMsg?.conversation || quotedMsg?.extendedTextMessage?.text || '')
        }

        if (!input) {
            return sock.sendMessage(jid, {
                text:
                    `Cara penggunaan:\n` +
                    `- ${prefix + command} halo\n` +
                    `- ${prefix + command} halo|kiri|23.00\n` +
                    `- ${prefix + command} halo|kanan|23.00\n\n` +
                    `Atau reply pesan lalu ketik ${prefix + command}`
            }, { quoted: msg })
        }

        const parsed = parseInput(input)
        if (!parsed.text) {
            return sock.sendMessage(jid, {
                text: '❌ Teks tidak boleh kosong.'
            }, { quoted: msg })
        }

        const url =
            `https://zelapioffciall.koyeb.app/canvas/iqc` +
            `?text=${encodeURIComponent(parsed.text)}` +
            `&posisi=${encodeURIComponent(parsed.posisi)}` +
            `&jam=${encodeURIComponent(parsed.jam)}`

        await react('⏳')

        try {
            await axios.get(url, {
                responseType: 'arraybuffer',
                timeout: 15000,
                validateStatus: () => true
            })

            await sock.sendMessage(jid, {
                image: { url }
            }, { quoted: msg })

            useLimit()
            await react('✅')
        } catch {
            await react('❌')
            await sock.sendMessage(jid, {
                text: '❌ Gagal membuat iPhone quote. Coba lagi nanti.'
            }, { quoted: msg })
        }
    }
}
