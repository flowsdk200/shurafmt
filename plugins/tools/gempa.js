import axios from 'axios'

const BMKG_URL = 'https://data.bmkg.go.id/DataMKG/TEWS/autogempa.json'
const SHAKEMAP_BASE = 'https://data.bmkg.go.id/DataMKG/TEWS/'

const safeText = (value, fallback = '-') => {
    if (value === null || value === undefined) return fallback
    const text = String(value).trim()
    return text || fallback
}

const toDateTime = (tanggal = '', jam = '') => {
    const left = safeText(tanggal, '').replace(/\s+/g, ' ').trim()
    const time = safeText(jam, '').replace(/\s+/g, ' ').trim()
    if (!left && !time) return '-'
    return `${left}${time ? ` ${time}` : ''}`.trim()
}

const formatGempa = (gempa = {}) => {
    return (
        `• Tanggal: ${safeText(gempa.Tanggal)}\n` +
        `• Waktu: ${toDateTime(gempa.Tanggal, gempa.Jam)}\n` +
        `• Magnitudo: ${safeText(gempa.Magnitude)}\n` +
        `• Kedalaman: ${safeText(gempa.Kedalaman)}\n` +
        `• Lokasi: ${safeText(gempa.Wilayah)}\n` +
        `• Koordinat: ${safeText(gempa.Lintang)} ${safeText(gempa.Bujur)}\n` +
        `• Potensi: ${safeText(gempa.Potensi)}\n` +
        `• Dirasakan: ${safeText(gempa.Dirasakan)}`
    )
}

const fetchGempa = async () => {
    const { data } = await axios.get(BMKG_URL, {
        timeout: 30000,
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'application/json, text/plain, */*',
            'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7'
        },
        validateStatus: () => true
    })

    if (typeof data === 'string') {
        throw new Error('Respons BMKG tidak valid')
    }

    if (!data || !data.Infogempa || !data.Infogempa.gempa) {
        throw new Error('Data gempa tidak tersedia')
    }

    return data.Infogempa.gempa
}

export default {
    name: 'gempa',
    aliases: ['infogempa', 'cekgempa'],
    description: 'Cek info gempa terkini dari BMKG',
    execute: async ({ sock, msg, react, useLimit }) => {
        const jid = msg.key.remoteJid
        await react('⏳')

        try {
            const gempa = await fetchGempa()
            const caption = formatGempa(gempa)
            const shakemap = safeText(gempa.Shakemap, '')

            if (shakemap) {
                await sock.sendMessage(jid, {
                    image: { url: SHAKEMAP_BASE + shakemap },
                    caption
                }, { quoted: msg })
            } else {
                await sock.sendMessage(jid, { text: caption }, { quoted: msg })
            }

            useLimit()
            await react('✅')
        } catch (err) {
            await react('❌')
            await sock.sendMessage(jid, {
                text: `❌ Error: ${err.message}`
            }, { quoted: msg })
        }
    }
}
